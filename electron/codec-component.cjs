// electron/codec-component.cjs
// 可选"编解码组件"管理 + 转码会话。主包只含 Chromium 原生可播格式（H.264 MP4 / WebM / Ogg / MOV）；
// MKV/AVI/WMV/FLV 及 AC3/EAC3 音轨等 Chromium 解不了的，需此组件（内含 ffmpeg）转码为渐进式 MP4 再播。
//
// 三来源（版本高者优先，逻辑与 DocLite converters 一致）：
//   1) dev：系统 PATH 上的 ffmpeg（仅源码运行；打包环境不依赖）
//   2) 系统级：<resourcesPath>/codec
//   3) 用户级：<userData>/codec（应用内 zip 安装，免提权）
//
// 应用内安装（全程主进程）：定位资产（按平台 + 版本上限）→ 镜像轮询下载 zip → sha256 强制校验
// → 最小 zip 解包（白名单 + 体积上限 + inflate 上限 + CRC32）→ manifest 校验 → 原子写盘。
//
// 转码会话：ffmpeg -i <src> 转成 fMP4 渐进流（frag_keyframe+empty_moov），写临时文件并用
// 流媒体服务器以"增长文件"方式供 <video> 渐进播放；stderr 的 time= 解析出进度经 codec:status 推送。
const { app, ipcMain, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const { createHash, createCipher } = require('crypto')
const { spawn } = require('child_process')
const { registerSource, unregisterSource } = require('./stream-server.cjs')
const { buildCandidateSources, downloadFromUrl, requestUrl, check: checkUpdate, compareVersions } = require('./updater.cjs')

const MANIFEST = 'manifest.json'
const BINARY = 'ffmpeg'
const PLATFORM = process.platform // 'darwin'|'win32'|'linux'
const ZIP_NAME_RE = new RegExp(`^VPlayer-codec-(\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?)-${PLATFORM}\\.zip$`)
const MAX_FILE_BYTES = 300 * 1024 * 1024 // ffmpeg 二进制上限（约 80MB）
const MAX_TOTAL_BYTES = 400 * 1024 * 1024
const MAX_ENTRIES = 30
const INSTALL_DOWNLOAD_MAX = 350 * 1024 * 1024
const ALLOWED_FILES = new Set([BINARY, MANIFEST])
const TMP_DIR = path.join(app.getPath('temp'), 'vplayer-transcode')

let installing = false

// ---------- CRC32（zip 完整性，自带查表） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function isAllowedName(name) {
  const clean = String(name).replace(/\\/g, '/')
  if (!clean || clean.includes('..') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return false
  return ALLOWED_FILES.has(clean)
}

// 最小 zip 解包（同 DocLite converters：store/deflate + 防御性校验）
function unzipComponent(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('组件包格式无效')
  let eocd = -1
  const searchStart = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('组件包格式无效（无法定位中央目录）')
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0) throw new Error('组件包内容为空')
  if (count > MAX_ENTRIES) throw new Error('组件包条目数超出上限')
  if (cdOffset + cdSize > buf.length || cdOffset < 22) throw new Error('组件包中央目录越界')

  const files = {}
  let total = 0
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('组件包中央目录损坏')
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    if (p + 46 + nameLen > buf.length) throw new Error('组件包文件名字段越界')
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue
    if (!isAllowedName(name)) throw new Error(`组件包含不允许的文件：${name}`)
    if (uncompSize > MAX_FILE_BYTES) throw new Error(`组件文件过大：${name}`)
    total += uncompSize
    if (total > MAX_TOTAL_BYTES) throw new Error('组件解压总体积超出上限')

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('组件包本地文件头损坏')
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    if (dataStart + compSize > buf.length) throw new Error('组件包数据区越界')
    const comp = buf.subarray(dataStart, dataStart + compSize)

    let data
    if (method === 0) {
      data = Buffer.from(comp)
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(comp, { maxOutputLength: MAX_FILE_BYTES })
      } catch (e) {
        throw new Error(`组件文件解压失败：${name}（${e.message}）`)
      }
    } else {
      throw new Error(`不支持的压缩方式（${method}）：${name}`)
    }
    if (data.length !== uncompSize) throw new Error(`组件文件大小不符：${name}`)
    if (crc32(data) !== crc) throw new Error(`组件文件完整性校验失败：${name}`)
    files[name.replace(/\\/g, '/')] = data
  }
  if (!files[BINARY]) throw new Error('组件包缺少 ffmpeg')
  return files
}

function validateManifest(files, versionFallback) {
  const raw = files[MANIFEST]
  if (!raw) throw new Error('组件包缺少 manifest.json')
  let manifest
  try { manifest = JSON.parse(raw.toString('utf8')) } catch { throw new Error('manifest 格式无效') }
  const version = String(manifest.version || versionFallback || '')
  if (!ZIP_NAME_RE.test(`VPlayer-codec-${version}-${PLATFORM}.zip`)) {
    throw new Error(`组件版本号不合法：${version}`)
  }
  if (manifest.minAppVersion && compareVersions(String(manifest.minAppVersion), app.getVersion()) > 0) {
    throw new Error(`组件需要主程序 ${manifest.minAppVersion} 及以上，请先升级应用`)
  }
  if (manifest.sha256) {
    const actual = createHash('sha256').update(files[BINARY]).digest('hex')
    if (actual !== String(manifest.sha256).toLowerCase()) throw new Error('组件 ffmpeg 哈希校验失败')
  }
  return { name: manifest.name || 'vplayer-codec', version, minAppVersion: manifest.minAppVersion || null }
}

function componentDirs() {
  const dirs = []
  // dev：系统 PATH 上的 ffmpeg（仅源码运行，打包环境不依赖）
  if (!app.isPackaged) {
    dirs.push({ label: 'dev', dir: null, pathCommand: 'ffmpeg' })
  }
  dirs.push({ label: 'system', dir: path.join(process.resourcesPath, 'codec') })
  dirs.push({ label: 'user', dir: path.join(app.getPath('userData'), 'codec') })
  return dirs
}

function binaryPathFor({ label, dir, pathCommand }) {
  if (label === 'dev') {
    return { label, binary: pathCommand }
  }
  const binary = path.join(dir, BINARY) + (PLATFORM === 'win32' ? '.exe' : '')
  return { label, binary }
}

async function readComponentInfo(cand) {
  try {
    const { label, binary } = binaryPathFor(cand)
    if (label === 'dev') {
      // 系统 PATH 上的 ffmpeg：execFile 探测版本
      const { execFileSync } = require('child_process')
      const out = execFileSync(binary, ['-version'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString()
      const m = /ffmpeg version (\S+)/.exec(out)
      return { label, version: m ? m[1] : 'system', binary, source: label }
    }
    await fs.promises.access(binary, fs.constants.R_OK)
    let version = '0.0.0'
    try {
      const m = JSON.parse(await fs.promises.readFile(path.join(cand.dir, MANIFEST), 'utf8'))
      if (m && typeof m.version === 'string' && ZIP_NAME_RE.test(`VPlayer-codec-${m.version}-${PLATFORM}.zip`)) {
        version = m.version
      }
    } catch { /* 保持默认 */ }
    return { label, version, binary, source: label }
  } catch {
    return null
  }
}

async function getCodecStatus() {
  const found = []
  const order = componentDirs()
  for (const cand of order) {
    const info = await readComponentInfo(cand)
    if (info) found.push(info)
  }
  if (found.length === 0) {
    return { installed: false, version: null, source: null, binary: null }
  }
  found.sort((a, b) => {
    const c = compareVersions(b.version, a.version)
    if (c !== 0) return c
    return order.findIndex((d) => d.label === a.label) - order.findIndex((d) => d.label === b.label)
  })
  const best = found[0]
  return { installed: true, version: best.version, source: best.source, binary: best.binary }
}

async function writeComponentFiles(files, destDir) {
  const names = Object.keys(files || {})
  if (names.length === 0) throw new Error('组件包内容为空')
  const tmpDir = destDir + '.installing'
  const tmpResolved = path.resolve(tmpDir)
  let total = 0
  for (const name of names) {
    const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '')
    if (!isAllowedName(name)) throw new Error(`组件包含不允许的文件：${name}`)
    const target = path.join(tmpDir, clean)
    if (!path.resolve(target).startsWith(tmpResolved + path.sep)) throw new Error(`组件路径越界：${name}`)
    const bytes = files[name]
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`组件文件过大：${name}`)
    total += bytes.length
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, bytes)
    if (PLATFORM !== 'win32') await fs.promises.chmod(target, 0o755)
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('组件总体积超出上限')
  await fs.promises.rm(destDir, { recursive: true, force: true })
  await fs.promises.rename(tmpDir, destDir)
}

async function locateComponentAsset() {
  const upd = await checkUpdate({ force: true })
  if (!upd.ok) throw new Error(upd.error || '未获取到更新信息，请稍后再试')
  const assets = upd.releaseAssets || []
  const current = app.getVersion()
  const candidates = assets
    .map((a) => ({ asset: a, m: ZIP_NAME_RE.exec(a.name) }))
    .filter((x) => x.m)
    .filter((x) => compareVersions(x.m[1], current) <= 0)
    .sort((x, y) => compareVersions(y.m[1], x.m[1]))
  if (candidates.length === 0) {
    throw new Error(`当前平台（${PLATFORM}）暂无匹配的编解码组件包，请稍后再试或升级应用`)
  }
  const zip = {
    name: candidates[0].asset.name, version: candidates[0].m[1],
    size: candidates[0].asset.size, url: candidates[0].asset.url,
  }
  const shaAsset = assets.find((a) => a.name === `${zip.name}.sha256`)
  if (!shaAsset) throw new Error('组件包缺少校验文件（.sha256），已中止安装')
  for (const s of buildCandidateSources(shaAsset.url)) {
    try {
      const buf = await requestUrl(s.url, { 'User-Agent': `VPlayer/${current} (codec-installer)` }, { maxBytes: 4096 })
      const h = buf.toString('utf8').trim().split(/\s+/)[0].toLowerCase()
      if (/^[0-9a-f]{64}$/.test(h)) { zip.sha256 = h; break }
    } catch { /* 试下一源 */ }
  }
  if (!zip.sha256) throw new Error('组件包校验文件获取失败，已中止安装')
  return zip
}

async function installCodec() {
  if (installing) return { ok: false, error: '组件安装正在进行中，请稍候' }
  installing = true
  const tmpZip = path.join(app.getPath('userData'), `codec-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`)
  try {
    const zip = await locateComponentAsset()
    const sources = buildCandidateSources(zip.url)
    const failures = []
    let downloadedOk = false
    for (const source of sources) {
      const hash = createHash('sha256')
      try {
        const st = await downloadFromUrl(source, tmpZip, {
          size: zip.size,
          sizeCap: Math.min(Math.ceil((zip.size || 0) * 1.1), INSTALL_DOWNLOAD_MAX),
          hash,
        })
        if (hash.digest('hex') !== zip.sha256) throw new Error('组件包校验失败（sha256 不匹配）')
        if (st.total > 0 && st.received !== st.total) throw new Error('组件包下载不完整')
        downloadedOk = true
        break
      } catch (e) {
        await fs.promises.unlink(tmpZip).catch(() => {})
        failures.push(`${source.name}：${e.message}`)
      }
    }
    if (!downloadedOk) throw new Error(`组件包下载失败：${failures.join('；')}`)

    const buf = await fs.promises.readFile(tmpZip)
    const files = unzipComponent(buf)
    const manifest = validateManifest(files, zip.version)
    const destDir = componentDirs().find((d) => d.label === 'user').dir
    await writeComponentFiles(files, destDir)
    const status = await getCodecStatus()
    return { ok: true, version: manifest.version, status }
  } catch (e) {
    return { ok: false, error: e.message || '安装失败' }
  } finally {
    await fs.promises.unlink(tmpZip).catch(() => {})
    installing = false
  }
}

// ---------- 转码会话 ----------
const sessions = new Map() // id -> { proc, out, sourceId }

function progressLine(line, session) {
  const kv = {}
  for (const part of line.trim().split(' ')) {
    const i = part.indexOf('=')
    if (i > 0) kv[part.slice(0, i)] = part.slice(i + 1)
  }
  return kv
}

function createTranscode(ffmpegBin, inputPath) {
  const id = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  fs.mkdirSync(TMP_DIR, { recursive: true })
  const out = path.join(TMP_DIR, `${id}.mp4`)
  const proc = spawn(ffmpegBin, [
    '-y', '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', '-progress', 'pipe:1',
    out,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  const session = { proc, out, sourceId: null, inputPath }
  sessions.set(id, session)
  proc.stderr.on('data', () => {}) // 丢弃 stderr（避免积压）
  let lastProgress = 0
  let lineBuf = ''
  proc.stdout.on('data', (chunk) => {
    lineBuf += chunk.toString()
    const lines = lineBuf.split('\n')
    lineBuf = lines.pop()
    for (const line of lines) {
      const kv = progressLine(line)
      if (kv.out_time_us) {
        const sec = Math.floor(parseInt(kv.out_time_us, 10) / 1e6)
        if (sec !== lastProgress) {
          lastProgress = sec
          broadcast({ type: 'transcode-progress', id, seconds: sec })
        }
      }
    }
  })
  proc.on('close', (code) => {
    broadcast({ type: 'transcode-end', id, code })
    sessions.delete(id)
  })

  return { id, out, proc }
}

function currentWin() {
  return BrowserWindow.getAllWindows()[0] || null
}
function broadcast(status) {
  const win = current()
  if (win && !win.isDestroyed()) win.webContents.send('codec:status', status)
}

function registerCodecComponent() {
  ipcMain.handle('codec:get-status', () => getCodecStatus())

  ipcMain.handle('codec:install', () => installCodec())

  ipcMain.handle('codec:uninstall', async () => {
    const userDir = componentDirs().find((d) => d.label === 'user').dir
    try {
      await fs.promises.rm(userDir, { recursive: true, force: true })
      await fs.promises.rm(userDir + '.installing', { recursive: true, force: true })
      const status = await getCodecStatus()
      return { ok: true, status }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('codec:transcode', async (_e, inputPath) => {
    try {
      const status = await getCodecStatus()
      if (!status.installed) return { ok: false, error: '未安装编解码组件' }
const { id, out } = createTranscode(status.binary, inputPath)
      const src = {
        read: (o, l, cb) => {
          const chunks = []
          fs.createReadStream(out, { start: o, end: o + l - 1 })
            .on('data', (d) => chunks.push(d))
            .on('end', () => cb(null, Buffer.concat(chunks)))
            .on('error', cb)
        },
        stat: (cb) => fs.stat(out, (err, st) => cb(err, err ? 0 : st.size)),
        name: 'transcode', ext: '.mp4',
      }
      const { id: sourceId, url } = registerSource(src)
      sessions.get(id).sourceId = sourceId
      return { ok: true, id, url }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('codec:cancel', (_e, id) => {
    const s = sessions.get(id)
    if (s) { try { s.proc.kill('SIGTERM') } catch { /* ignore */ } }
    return { ok: true }
  })
}

module.exports = { registerCodecComponent, getCodecStatus, unzipComponent, validateManifest, crc32, isAllowedName, installCodec }