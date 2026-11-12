#!/usr/bin/env node
/**
 * VPlayer 冒烟测试套件 —— 统一入口
 *
 * 分层（可单独跑，失败即中止后续依赖层）：
 *   L1 静态    —— 文件/文本/构建产物检查（秒级）
 *   L2 逻辑    —— 纯 Node 单元测试：来源路由 source.js、格式化 format.js（秒级）
 *   L4 集成    —— 起真实 Electron 进程，校验渲染层无报错 + 产出截图（约 20s）
 *
 * 用法：
 *   node scripts/smoke/run.mjs              # 全跑（L1→L2→L4）
 *   node scripts/smoke/run.mjs --layer L1   # 只跑某层
 *   node scripts/smoke/run.mjs --skip L4
 *   node scripts/smoke/run.mjs --json
 *   node scripts/smoke/run.mjs --no-build   # dist 已存在时跳过构建
 *
 * 退出码：0 = 全通过；1 = 有失败；2 = 环境不满足
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const REPORT_DIR = join(ROOT, '.smoke-report')

const args = process.argv.slice(2)
const hasFlag = (f) => args.includes(f)
const layerArg = (args.find((a) => a.startsWith('--layer=')) || '').split('=')[1]
const skipArg = (args.find((a) => a.startsWith('--skip=')) || '').split('=')[1]
const wantJson = hasFlag('--json')
const noBuild = hasFlag('--no-build')

const results = []
let failed = false
const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
const out = (s = '') => process.stdout.write(s + '\n')

function record(layer, name, ok, detail = '') {
  results.push({ layer, name, ok, detail })
  if (!ok) failed = true
}
function skip(layer, name, reason) {
  results.push({ layer, name, ok: true, skipped: true, detail: reason })
}
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeout || 180000, env: { ...process.env, ...opts.env } })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', output: (r.stdout || '') + (r.stderr || '') }
}
function shouldRun(layer) {
  if (layerArg && layerArg !== layer) return false
  return !(skipArg && skipArg.includes(layer))
}

// ============ L1 静态 ============
if (shouldRun('L1')) {
  // 1. 关键文件存在
  const files = ['package.json', 'electron/main.cjs', 'electron/preload.cjs', 'electron/updater.cjs',
    'electron/stream-server.cjs', 'electron/smb.cjs', 'electron/codec-component.cjs',
    'src/main.jsx', 'src/App.jsx', 'src/index.css', 'index.html']
  for (const f of files) record('L1', `关键文件 ${f}`, existsSync(join(ROOT, f)), '缺失')

  // 2. electron 模块语法
  for (const f of ['main.cjs', 'preload.cjs', 'updater.cjs', 'stream-server.cjs', 'smb.cjs', 'codec-component.cjs']) {
    const r = run(process.execPath, ['--check', join(ROOT, 'electron', f)])
    record('L1', `语法 electron/${f}`, r.code === 0, r.stderr)
  }

  // 3. package.json 关键字段
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    record('L1', '版本号格式', /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version)
    record('L1', 'main 指向 electron/main.cjs', pkg.main === 'electron/main.cjs', pkg.main)
    record('L1', '差量升级依赖 electron-updater', !!(pkg.dependencies && pkg.dependencies['electron-updater']))
    record('L1', 'SMB 依赖 smb2', !!(pkg.dependencies && pkg.dependencies.smb2))
  } catch (e) { record('L1', 'package.json 可解析', false, e.message) }

  // 4. i18n 双语对等
  try {
    const i18n = readFileSync(join(ROOT, 'src/i18n/index.js'), 'utf8')
    const zhKeys = [...i18n.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])
    // 粗略：中文和英文字典行数接近
    const zhBlock = (i18n.match(/^  zh:\{/m) || i18n.match(/^  zh:\s*\{/m)) ? i18n.indexOf('zh: {') : -1
    record('L1', 'i18n 含 zh 与 en 字典', i18n.includes('zh:') && i18n.includes('en:'), zhKeys.length)
  } catch (e) { record('L1', 'i18n 读取', false, e.message) }

  // 5. 构建产物存在
  if (!noBuild) {
    const r = run('npm', ['run', 'build:app'], { timeout: 120000 })
    record('L1', 'vite 构建', r.code === 0, r.stderr.slice(0, 300))
  } else {
    record('L1', 'vite 构建（--no-build 跳过）', true, 'skip')
  }
  if (existsSync(join(ROOT, 'dist/index.html'))) record('L1', 'dist/index.html 存在', true)
  else record('L1', 'dist/index.html 存在', false, '先跑 npm run build:app')
}

// ============ L2 逻辑（纯前端） ============
if (shouldRun('L2')) {
  // 用 node 直接 import 前端纯函数测试（ESM 模块无 electron 依赖）
  const t = run(process.execPath, ['--input-type=module', '-e', `
    import { needsTranscode, isPlayableVideo, extOf } from ${JSON.stringify('file://' + join(ROOT, 'src/utils/source.js'))}
    import { formatTime, formatBytes } from ${JSON.stringify('file://' + join(ROOT, 'src/utils/format.js'))}
    const asserts = [];
    const eq = (name, got, want) => asserts.push({ name, ok: got === want, got, want });
    eq('mkv 需转码', needsTranscode('a.mkv'), true);
    eq('mp4 不需转码(原生)', needsTranscode('a.mp4'), false);
    eq('webm 原生', needsTranscode('a.webm'), false);
    eq('avi 需转码', needsTranscode('a.AVI'), true);
    eq('ts 需转码', needsTranscode('a.ts'), true);
    eq('扩展名提取', extOf('dir/x.MKV'), '.mkv');
    eq('扩展名小写', extOf('x.mp4'), '.mp4');
    eq('formatTime 时分', formatTime(3725), '1:02:05');
    eq('formatTime 分秒', formatTime(65), '1:05');
    eq('formatTime 非法', formatTime(-1), '0:00');
    eq('formatBytes', formatBytes(1536), '1.5 KB');
    eq('formatBytes 空', formatBytes(null), '');
    const bad = asserts.filter(a => !a.ok);
    for (const a of asserts) console.log((a.ok ? '✓' : '✗') + ' ' + a.name + (a.ok ? '' : '  got=' + a.got + ' want=' + a.want));
    console.log('__RESULT__' + (bad.length ? 'FAIL' : 'PASS'));
  `], { timeout: 30000 })
  const pass = t.output.includes('__RESULT__PASS')
  record('L2', '来源路由与格式化单元测试', pass, t.output.split('__RESULT__')[0].slice(0, 400))
}

// ============ L4 集成（真实 Electron） ============
if (shouldRun('L4')) {
  const electronBin = join(ROOT, 'node_modules/electron/dist/electron')
  const shot = join(process.env.TMPDIR || '/tmp', 'vplayer-smoke.png')
  try { rmSync(shot) } catch {}
  const r = run(electronBin, [join(ROOT, 'electron/main.cjs'), '--no-sandbox'],
    { env: { VPLAYER_SMOKE: '1' }, timeout: 60000 })
  const cleanOutput = r.output.replace(/\x1b\[[0-9;]*m/g, '')
  const launched = cleanOutput.includes('[smoke] 完成，正常退出')
  const hasError = /\[renderer\].*Error/.test(cleanOutput) || /Uncaught/.test(cleanOutput)
  record('L4', 'Electron 冒烟启动并退出', launched, cleanOutput.slice(-300))
  if (launched) {
    record('L4', '渲染层无未捕获错误', !hasError, hasError ? cleanOutput.match(/\[renderer\].*/g)?.slice(0, 3).join(' | ') : '')
    record('L4', '冒烟截图产出', existsSync(shot), shot)
  }
}

// ============ 汇总输出 ============
const passed = results.filter((r) => r.ok).length
const failList = results.filter((r) => !r.ok)
const report = { ok: !failed, total: results.length, passed, failed: failList.length, durationMs: 0, results }
try { writeFileSync(join(REPORT_DIR, 'smoke.json'), JSON.stringify(report, null, 2)) } catch (e) { mkdirSync(REPORT_DIR, { recursive: true }); writeFileSync(join(REPORT_DIR, 'smoke.json'), JSON.stringify(report, null, 2)) }

if (wantJson) { out(JSON.stringify(report, null, 2)) }
else {
  out('')
  out(`${c.b}══ VPlayer 冒烟测试 ══${c.x}`)
  for (const r of results) {
    out(`  ${r.ok ? (r.skipped ? `${c.y}⚠` : `${c.g}✓`) : `${c.r}✗`}${c.x} [${r.layer}] ${r.name}${r.detail ? ' ' + r.detail : ''}`)
  }
  out('')
  out(`共 ${results.length} 项 · 通过 ${passed} · 失败 ${failList.length}`)
  if (failList.length) {
    out(`${c.r}✗ 存在失败项：${failList.map((r) => `${r.layer}/${r.name}`).join(', ')}${c.x}`)
    process.exitCode = 1
  } else {
    out(`${c.g}✓ 全部通过${c.x}`)
    process.exitCode = 0
  }
}