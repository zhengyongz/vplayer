// electron/updater.cjs
// 轻量自动升级模块：GitHub Releases 检查 + 流式下载 + 进度推送（零第三方依赖）
// 差量升级：
//   - Windows：electron-updater（blockmap 分块对比，仅传变化部分）——真正的"差量"；
//   - Linux deb：镜像加速全量（deb 无官方差量通道，用 sha256 校验 + 大小交叉核对防篡改）；
//   - macOS：无签名时自动更新被 Gatekeeper 阻止，一期仅引导手动下载 DMG。
// 安全设计（按 DocLite 审查沉淀）：下载路径、安装命令、剪贴板全部由主进程记账（lastDownloaded），
// 所有升级 IPC 不接受渲染层传入的文件路径/命令文本。
const { app, net, ipcMain, clipboard, shell, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { execFile } = require('child_process')

const REPO = 'zhengyongz/vplayer'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE_URL = `https://github.com/${REPO}/releases/latest`
const SUB_DIR = 'VPlayer'
const CACHE_TTL = 60_000
const IDLE_TIMEOUT = 30_000
const SIZE_CAP_RATIO = 1.1

// ---------- 镜像加速配置（大陆网络） ----------
const DOWNLOAD_SOURCES = [
  { name: '官方直连', prefix: '' },
  { name: '镜像 ghfast.top', prefix: 'https://ghfast.top/' },
  { name: '镜像 gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { name: '镜像 ghproxy.net', prefix: 'https://ghproxy.net/' },
]
const SLOW_WINDOW_MS = 10_000
const SLOW_MIN_BYTES = 2 * 1024 * 1024

function buildCandidateSources(assetUrl) {
  return DOWNLOAD_SOURCES.map((s) => ({ name: s.name, url: s.prefix + assetUrl }))
}

let cachedState = null
let downloading = false
let lastDownloaded = null

function currentWin() {
  return BrowserWindow.getAllWindows()[0] || null
}

// ---------- 语义化版本比较 ----------
function compareVersions(a, b) {
  const parse = (v) => {
    const s = String(v || '').replace(/^v/i, '')
    const m = /^(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(s)
    return { nums: (m ? m[1] : s).split('.').map((n) => parseInt(n, 10) || 0), pre: m ? m[2] : null }
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const da = pa.nums[i] || 0
    const db = pb.nums[i] || 0
    if (da !== db) return da > db ? 1 : -1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre == null) return 1
  if (pb.pre == null) return -1
  return 0
}

// ---------- 按平台选择安装包资产 ----------
function pickAsset(assets, platform) {
  if (!Array.isArray(assets)) return null
  if (platform === 'win32') return assets.find((a) => /-Setup\.exe$/i.test(a.name)) || null
  if (platform === 'linux') return assets.find((a) => /^vplayer_\d+\.\d+\.\d+_amd64\.deb$/.test(a.name)) || null
  if (platform === 'darwin') {
    return assets.find((a) => /^VPlayer-.*-arm64-mac\.zip$/.test(a.name))
      || assets.find((a) => /^VPlayer-.*-mac\.zip$/.test(a.name) && !/-arm64/.test(a.name))
      || null
  }
  return null
}

// ---------- net.request 封装：GET 小响应（带空闲超时） ----------
function requestUrl(url, headers = {}, { maxBytes = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)
    let idleTimer = setTimeout(() => { req.destroy(); reject(new Error('网络超时')) }, IDLE_TIMEOUT)
    const armIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { req.destroy(); reject(new Error('网络超时')) }, IDLE_TIMEOUT)
    }
    const chunks = []
    let received = 0
    req.on('response', (res) => {
      res.on('data', (c) => {
        armIdle()
        received += c.length
        if (maxBytes > 0 && received > maxBytes) { req.destroy(); reject(new Error('响应超出预期大小')); return }
        chunks.push(c)
      })
      res.on('end', () => {
        clearTimeout(idleTimer)
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(Buffer.concat(chunks))
        else if (res.statusCode === 403 || res.statusCode === 429) reject(new Error('检查过于频繁，请稍后再试'))
        else reject(new Error(`GitHub 响应异常（HTTP ${res.statusCode}）`))
      })
      res.on('error', (e) => { clearTimeout(idleTimer); reject(e) })
    })
    req.on('error', (e) => { clearTimeout(idleTimer); reject(e) })
    req.end()
  })
}

// ---------- 检查更新 ----------
async function check({ force = false } = {}) {
  if (!force && cachedState && Date.now() - cachedState.ts < CACHE_TTL) return cachedState.result
  const currentVersion = app.getVersion()
  const result = { ok: false, currentVersion, error: null, hasUpdate: false, releasePageUrl: RELEASE_PAGE_URL }
  try {
    const body = await requestUrl(API_URL, {
      'User-Agent': `VPlayer/${currentVersion} (auto-updater)`,
      Accept: 'application/vnd.github+json',
    })
    const data = JSON.parse(body.toString('utf8'))
    if (!data || !data.tag_name) throw new Error('GitHub 返回数据异常')
    const latestVersion = String(data.tag_name).replace(/^v/i, '')
    const mainAsset = pickAsset(data.assets || [], process.platform)
    const shaAsset = mainAsset && (data.assets || []).find((a) => a.name === `${mainAsset.name}.sha256`)

    result.ok = true
    result.hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    result.latestVersion = latestVersion
    result.publishedAt = data.published_at || ''
    result.releaseName = data.name || data.tag_name
    result.releaseNotes = data.body || ''
    result.platform = process.platform
    result.releaseAssets = (data.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
    result.asset = mainAsset
      ? { name: mainAsset.name, size: mainAsset.size, url: mainAsset.browser_download_url, sha256Url: shaAsset ? shaAsset.browser_download_url : null }
      : null
    if (process.platform === 'darwin' && result.hasUpdate) result.manualDownload = true
    cachedState = { ts: Date.now(), result }
  } catch (err) {
    console.error('[updater] 检查更新失败:', err.message)
    result.error = err.message || '获取失败'
  }
  return result
}

// ---------- 单源下载（分块 + 背压 + 空闲超时 + 慢速检测 + 大小上限） ----------
function downloadFromUrl(source, target, { size, sizeCap, hash, onProgress }) {
  return new Promise((resolve, reject) => {
    const req = net.request(source.url)
    req.setHeader('User-Agent', `VPlayer/${app.getVersion()} (auto-updater)`)
    let received = 0
    let idleTimer = setTimeout(() => { req.destroy(); reject(new Error('下载超时（30 秒无数据）')) }, IDLE_TIMEOUT)
    const armIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { req.destroy(); reject(new Error('下载超时（30 秒无数据）')) }, IDLE_TIMEOUT)
    }
    let slowTimer = null
    const armSlow = () => {
      if (slowTimer) return
      slowTimer = setTimeout(() => {
        if (received < SLOW_MIN_BYTES) { req.destroy(); reject(new Error(`当前源速度过慢（${(received / 1024 / 1024).toFixed(1)}MB/${SLOW_WINDOW_MS / 1000}s）`)) }
      }, SLOW_WINDOW_MS)
    }
    const clearTimers = () => { clearTimeout(idleTimer); if (slowTimer) clearTimeout(slowTimer) }

    req.on('response', (res) => {
      if (res.statusCode !== 200) { req.destroy(); reject(new Error(`下载失败（HTTP ${res.statusCode}）`)); return }
      const cl = res.headers['content-length']
      const total = Number(Array.isArray(cl) ? cl[0] : cl) || size || 0
      if (size > 0 && total > 0 && Math.abs(total - size) > size * 0.1) { req.destroy(); reject(new Error('服务器返回大小与预期不符')); return }
      const ws = fs.createWriteStream(target)
      res.on('data', (chunk) => {
        armIdle(); armSlow()
        received += chunk.length
        if (received > sizeCap) { req.destroy(); reject(new Error('下载文件超出预期大小')); return }
        hash.update(chunk)
        if (!ws.write(chunk)) { res.pause(); ws.once('drain', () => res.resume()) }
        onProgress(received, total)
      })
      res.on('end', () => {
        clearTimers()
        ws.end((err) => err ? reject(new Error('写入文件失败: ' + err.message)) : resolve({ received, total }))
      })
      res.on('error', (e) => { clearTimers(); reject(e) })
      ws.on('error', (e) => { clearTimers(); reject(new Error('写入文件失败: ' + e.message)) })
    })
    req.on('error', (e) => { clearTimers(); reject(e) })
    req.end()
  })
}

// ---------- 差量下载引擎（Windows，electron-updater blockmap） ----------
const STABLE_DOWNLOAD_BASE = `https://github.com/${REPO}/releases/latest/download/`
function buildFeedSources() {
  return DOWNLOAD_SOURCES.map((s) => ({ name: s.name, url: s.prefix + STABLE_DOWNLOAD_BASE }))
}
function createDiffLogger() {
  const tag = '[electron-updater]'
  return {
    info: (m) => { if (process.env.VPLAYER_UPDATER_VERBOSE === '1') console.log(tag, m) },
    warn: (m) => console.warn(tag, m),
    error: (m) => console.error(tag, m),
    debug: () => {},
  }
}
async function seedDiffBaseFile(updater, downloadedFile) {
  try {
    const helper = updater.downloadedUpdateHelper
    if (!helper || !helper.cacheDir) return
    await fs.promises.mkdir(helper.cacheDir, { recursive: true })
    await fs.promises.copyFile(downloadedFile, path.join(helper.cacheDir, 'installer.exe'))
  } catch (e) {
    console.warn('[updater] 差量基准播种失败（下次将回退全量）:', e.message)
  }
}
async function downloadDifferential({ onProgress, onSource, feedSources } = {}) {
  const { NsisUpdater } = require('electron-updater')
  const state = cachedState && cachedState.result
  const apiAssetSize = state && state.asset ? state.asset.size : 0
  const sources = feedSources || buildFeedSources()
  const failures = []
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const note = i > 0 ? `已自动切换（上一源：${sources[i - 1].name}）` : undefined
    if (onSource) onSource(source.name, note)
    const u = new NsisUpdater()
    u.logger = createDiffLogger()
    u.autoDownload = false
    u.autoInstallOnAppQuit = false
    if (!app.isPackaged) u.forceDevUpdateConfig = true
    let progressMax = { received: 0, total: 0 }
    try {
      u.setFeedURL({ provider: 'generic', url: source.url, useMultipleRangeRequest: false })
      u.on('download-progress', (p) => { progressMax = { received: p.transferred, total: p.total }; if (onProgress) onProgress(p.transferred, p.total, source.name, note) })
      const checkResult = await u.checkForUpdates()
      const info = checkResult && checkResult.updateInfo
      if (!info || !info.version) throw new Error('feed 无版本信息')
      if (compareVersions(info.version, app.getVersion()) <= 0) throw new Error(`feed 版本不高于当前（${info.version}）`)
      const expectedSize = (Array.isArray(info.files) && info.files[0] && info.files[0].size) || info.size || 0
      if (apiAssetSize > 0 && expectedSize > 0 && Math.abs(expectedSize - apiAssetSize) > apiAssetSize * 0.1) {
        throw new Error(`feed 大小与官方清单不符（${expectedSize} vs ${apiAssetSize}）`)
      }
      const result = await u.downloadUpdate()
      const filePath = Array.isArray(result) ? result[0] : result
      if (!filePath || !fs.existsSync(filePath)) throw new Error('下载产物缺失')
      await seedDiffBaseFile(u, filePath)
      let mode = 'full'
      if (progressMax.total > 0 && expectedSize > 0 && progressMax.total < expectedSize * 0.5) mode = 'differential'
      const received = progressMax.total > 0 ? progressMax.received : expectedSize
      const total = progressMax.total > 0 ? progressMax.total : expectedSize
      u.removeAllListeners()
      return { filePath, source: source.name, mode, received, total }
    } catch (err) {
      u.removeAllListeners()
      failures.push(`${source.name}：${err.message}`)
      console.warn(`[updater] 差量源失败（${source.name}）:`, err.message)
    }
  }
  throw new Error(`差量引擎全部源失败：${failures.map((f) => `\n· ${f}`).join('')}`)
}

// ---------- 流式下载安装包（镜像轮询 + sha256 校验） ----------
async function download(assetOverride) {
  const state = cachedState && cachedState.result
  const asset = assetOverride || (state && state.asset)
  if (downloading) throw new Error('下载已在进行中')
  if (!asset) throw new Error('未找到可用安装包，请先检查更新')
  downloading = true
  const send = (status) => {
    const win = currentWin()
    if (win && !win.isDestroyed()) win.webContents.send('updater:status', status)
  }
  let lastSend = 0

  if (process.platform === 'darwin' && !assetOverride) {
    try { await shell.openExternal(RELEASE_PAGE_URL) } catch { /* ignore */ }
    downloading = false
    throw new Error('macOS 暂不支持自动更新：已打开下载页面，请手动下载 DMG 安装（Apple Silicon 选 -arm64，Intel 选 -x64）')
  }

  const dir = path.join(app.getPath('downloads'), SUB_DIR)
  const target = path.join(dir, path.basename(asset.name))
  try {
    if (process.platform === 'win32' && !assetOverride) {
      try {
        const r = await downloadDifferential({
          onSource: (sourceName, note) => send({ type: 'downloading', received: 0, total: 0, source: sourceName, note }),
          onProgress: (received, total, sourceName, note) => {
            const now = Date.now()
            if (now - lastSend > 200) { lastSend = now; send({ type: 'downloading', received, total, source: sourceName, note }) }
          },
        })
        const label = r.mode === 'differential' ? `${r.source}·差量` : r.source
        const note = r.mode === 'differential' ? '差量更新：仅下载与上一版不同的部分' : undefined
        lastDownloaded = r.filePath
        send({ type: 'downloaded', received: r.received, total: r.total, filePath: r.filePath, source: label, note })
        return r.filePath
      } catch (err) {
        console.warn('[updater] 差量引擎不可用，回退传统镜像全量下载:', err.message)
      }
    }

    await fs.promises.mkdir(dir, { recursive: true })
    const pattern = process.platform === 'win32' ? /-Setup\.exe$/i : /^vplayer_\d+\.\d+\.\d+_amd64\.deb$/
    const oldFiles = await fs.promises.readdir(dir).catch(() => [])
    await Promise.all(oldFiles.filter((f) => pattern.test(f) && f !== path.basename(asset.name)).map((f) => fs.promises.unlink(path.join(dir, f)).catch(() => {})))

    let expectedSha = null
    if (asset.sha256Url) {
      for (const s of buildCandidateSources(asset.sha256Url)) {
        try {
          const buf = await requestUrl(s.url, { 'User-Agent': `VPlayer/${app.getVersion()} (auto-updater)` }, { maxBytes: 4096 })
          const m = buf.toString('utf8').trim().split(/\s+/)[0].toLowerCase()
          if (/^[0-9a-f]{64}$/.test(m)) { expectedSha = m; break }
        } catch (e) { console.warn(`[updater] sha256 获取失败（${s.name}）:`, e.message) }
      }
    }
    const sizeCap = Math.ceil((asset.size || 500 * 1024 * 1024) * SIZE_CAP_RATIO)
    const sources = buildCandidateSources(asset.url)
    const failures = []
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const hash = crypto.createHash('sha256')
      let received = 0
      const note = i > 0 ? `已自动切换（上一源：${sources[i - 1].name}）` : undefined
      send({ type: 'downloading', received: 0, total: asset.size || 0, source: source.name, note })
      try {
        const result = await downloadFromUrl(source.url, target, {
          size: asset.size, sizeCap, hash,
          onProgress: (r, t) => { received = r; const now = Date.now(); if (now - lastSend > 200) { lastSend = now; send({ type: 'downloading', received: r, total: t, source: source.name, note }) } },
        })
        received = result.received
        const stat = await fs.promises.stat(target)
        if (result.total > 0 && stat.size !== result.total) throw new Error('文件下载不完整，请重试')
        if (expectedSha && hash.digest('hex') !== expectedSha) throw new Error('文件校验失败（sha256 不匹配，疑似镜像被篡改）')
        lastDownloaded = target
        send({ type: 'downloaded', received, total: result.total, filePath: target, source: source.name })
        return target
      } catch (err) {
        await fs.promises.unlink(target).catch(() => {})
        failures.push(`${source.name}：${err.message}`)
        console.warn(`[updater] 下载源失败（${source.name}）:`, err.message)
      }
    }
    throw new Error(`所有下载源均失败：${failures.map((f) => `\n· ${f}`).join('')}`)
  } catch (err) {
    fs.promises.unlink(target).catch(() => {})
    send({ type: 'error', message: err.message || '下载失败' })
    throw err
  } finally {
    downloading = false
  }
}

function registerUpdater() {
  ipcMain.handle('updater:check', async () => {
    const r = await check()
    const win = currentWin()
    if (win && !win.isDestroyed()) win.webContents.send('updater:status', { type: 'check-result', ...r })
    return r
  })
  ipcMain.handle('updater:download', async () => { try { const filePath = await download(); return { ok: true, filePath } } catch (err) { return { ok: false, error: err.message } } })
  ipcMain.handle('updater:copy-install-cmd', () => {
    if (!lastDownloaded || !fs.existsSync(lastDownloaded)) return false
    clipboard.writeText(`sudo dpkg -i "${lastDownloaded}"`)
    return true
  })
  ipcMain.handle('updater:open-installer', async () => {
    if (!lastDownloaded || !fs.existsSync(lastDownloaded)) return false
    if (process.platform === 'linux') { shell.showItemInFolder(lastDownloaded); return true }
    await shell.openPath(lastDownloaded)
    return true
  })
  ipcMain.handle('updater:install', () => {
    if (process.platform !== 'linux') return Promise.resolve({ ok: false, error: '当前平台不支持一键安装' })
    if (!lastDownloaded || !fs.existsSync(lastDownloaded)) return Promise.resolve({ ok: false, error: '未找到已下载的安装包，请先下载更新' })
    return new Promise((resolve) => {
      execFile('pkexec', ['dpkg', '-i', lastDownloaded], (err, _stdout, stderr) => {
        if (!err) { resolve({ ok: true }); return }
        if (err.code === 'ENOENT') resolve({ ok: false, error: '系统缺少 pkexec（PolicyKit），请改用下方命令手动安装' })
        else if (err.code === 126 || err.code === 127) resolve({ ok: false, cancelled: true, error: err.code === 127 ? '无法调用 dpkg，请改用下方命令手动安装' : '已取消安装' })
        else { const detail = String(stderr || '').split('\n').filter(Boolean).slice(-2).join(' ') || `退出码 ${err.code}`; resolve({ ok: false, error: '安装失败：' + detail }) }
      })
    })
  })
  ipcMain.handle('updater:relaunch', () => { app.relaunch(); app.exit(0); return true })
  setTimeout(async () => {
    const r = await check({ force: true })
    const win = currentWin()
    if (r.ok && r.hasUpdate && win && !win.isDestroyed()) win.webContents.send('updater:status', { type: 'available', ...r })
  }, 3000)
}

module.exports = { registerUpdater, compareVersions, check, download, pickAsset, buildCandidateSources, buildFeedSources, downloadDifferential, seedDiffBaseFile, DOWNLOAD_SOURCES, downloadFromUrl, requestUrl }