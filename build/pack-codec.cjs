// build/pack-codec.cjs
// 可选编解码组件打包（electron:build 后接续执行，Linux 上同时产出 deb）：
//   1) VPlayer-codec-<版本>-<平台>.zip        — 应用内安装用（主进程下载→解包→用户级目录）
//   2) VPlayer-codec-<版本>-<平台>.zip.sha256 — 完整性校验（下载后核对，防篡改）
//
// ffmpeg 二进制来源（按序）：
//   a) 环境变量 VPLAYER_FFMPEG 指向的二进制
//   b) node_modules/ffmpeg-static/ffmpeg（CI：npm i -D ffmpeg-static 后即有此二进制）
//   c) 系统 PATH 上的 ffmpeg（仅本地开发兜底；跨平台打包请用 a/b）
//
// 跨平台注意：ffmpeg 二进制是平台相关的，因此 zip 命名带 <平台> 后缀，
// 组件安装器（codec-component.cjs）按当前平台精确匹配资产。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { zipSync } = require('fflate')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version
const PLATFORM = process.platform // darwin | win32 | linux
const OUT = path.join(ROOT, 'release')

// ---------- 定位 ffmpeg ----------
function resolveFfmpeg() {
  if (process.env.VPLAYER_FFMPEG && fs.existsSync(process.env.VPLAYER_FFMPEG)) return process.env.VPLAYER_FFMPEG
  const candidates = [
    path.join(ROOT, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function main() {
  const ffmpeg = resolveFfmpeg()
  if (!ffmpeg) {
    console.error('[pack-codec] 未找到 ffmpeg 二进制。请先在 CI 安装 ffmpeg-static：npm i -D ffmpeg-static，或用 VPLAYER_FFMPEG 指定路径。')
    process.exit(1)
  }
  const binBuf = fs.readFileSync(ffmpeg)
  const binSha = crypto.createHash('sha256').update(binBuf).digest('hex')
  const manifest = {
    name: 'vplayer-codec',
    version: VERSION,
    minAppVersion: VERSION,
    platform: PLATFORM,
    sha256: binSha,
    binary: 'ffmpeg',
  }

  const FIXED_MTIME = new Date('1980-01-01T00:00:00Z')
  const zipBuf = Buffer.from(zipSync({
    'ffmpeg': [new Uint8Array(binBuf), { mtime: FIXED_MTIME }],
    'manifest.json': [new Uint8Array(Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')), { mtime: FIXED_MTIME }],
  }, { level: 9, mtime: FIXED_MTIME }))

  const zipName = `VPlayer-codec-${VERSION}-${PLATFORM}.zip`
  const zipPath = path.join(OUT, zipName)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(zipPath, zipBuf)
  const sha = crypto.createHash('sha256').update(zipBuf).digest('hex')
  fs.writeFileSync(path.join(OUT, `${zipName}.sha256`), `${sha}  ${zipName}\n`)
  console.log(`[pack-codec] ${zipName}（${(zipBuf.length / 1024 / 1024).toFixed(1)}MB，含 ffmpeg v${detectVersion(binBuf) || '?'}）`)
  console.log(`[pack-codec] sha256: ${sha.slice(0, 16)}…`)
}

// 简单探测 ffmpeg 版本（仅用于日志展示，非必须）
function detectVersion(buf) {
  try {
    const head = buf.subarray(0, 65536).toString('utf8')
    const m = head.match(/ffmpeg version (\S+)/)
    return m ? m[1] : null
  } catch { return null }
}

main()