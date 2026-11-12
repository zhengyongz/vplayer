// electron/smb.cjs
// SMB（局域网共享）浏览 + 流式读取。
// 说明：smb2 库（node-smb2 0.2.11）公开 API 只支持整文件 readFile，无法做视频流式播放，
//       但它内部暴露了 SMB2Forge.request（open/read/close/query_directory），read 支持 Offset/Length，
//       query_directory 返回文件类型与大小。本模块复用其协议实现，自行封装：
//         - connect：用 readdir 触发握手连接 + 验证，带超时与明确错误
//         - list：query_directory 解析出 类型/大小/名字 的目录列表
//         - streamRead：open → read(offset,length) → close，供流媒体服务器按 Range 拉取
// 凭据经 safeStorage 加密落盘（仅本机可解）。
const { app, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerSource } = require('./stream-server.cjs')

const SMB2Client = require('smb2')
const Forge = require('smb2/lib/tools/smb2-forge')
const bigint = require('smb2/lib/tools/bigint')

const REGISTRY = path.join(app.getPath('userData'), 'smb-credentials.json')
const CONNECT_TIMEOUT = 8000

// FILE_ATTRIBUTE_DIRECTORY
const ATTR_DIR = 0x10
// SMB2 单次 read 上限（SMB2 规范最大 0x10000 即 64KB 内常用；这里用 0x10000 保守）
const MAX_READ = 0x10000

let session = null // { client, host, share }

// ---------- 凭据落盘（safeStorage 加密） ----------
function saveCredentials(creds) {
  try {
    const enc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(JSON.stringify(creds))
      : Buffer.from(JSON.stringify(creds), 'utf8')
    fs.mkdirSync(path.dirname(REGISTRY), { recursive: true })
    fs.writeFileSync(REGISTRY, enc)
  } catch (e) { /* 落盘失败不影响本次会话 */ }
}
function loadCredentials() {
  try {
    if (!fs.existsSync(REGISTRY)) return null
    const buf = fs.readFileSync(REGISTRY)
    const dec = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
    return JSON.parse(dec)
  } catch (e) { return null }
}

// ---------- 错误映射（给用户可读的原因） ----------
function mapError(err) {
  const msg = String((err && (err.message || err)) || '')
  const code = err && err.code
  if (/LOGON_FAILURE|STATUS_LOGON|ACCESS_DENIED|STATUS_ACCESS_DENIED/i.test(msg + ' ' + (code || ''))) {
    return '登录失败：账号或密码错误，或该用户无权限'
  }
  if (/STATUS_BAD_NETWORK_NAME|SHARE|share|UNKNOWN_SHARE|NO_SUCH_FILE/i.test(msg + ' ' + (code || ''))) {
    return '共享名无效：请检查服务器上的共享名'
  }
  if (/EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|SOCKET|connect/i.test(msg + ' ' + (code || ''))) {
    return '无法连接服务器：请检查 IP/端口或网络是否可达'
  }
  if (/timed? ?out/i.test(msg + ' ' + (code || ''))) return '连接超时，请稍后重试'
  return '连接失败：' + msg.slice(0, 120)
}

// ---------- 路径/主机清洗 ----------
function cleanHost(h) {
  return String(h || '').replace(/^\\\\/, '').replace(/\/+$/, '').trim()
}
function cleanShare(s) {
  return String(s || '').replace(/^[\\/]+/, '').replace(/[\\/]+$/, '').trim()
}
function cleanPath(p) {
  // SMB 内部用 / 分隔；根为 '/'
  const s = String(p || '')
  if (s === '/' || s === '') return '/'
  return s.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')
}

// ---------- 连接（用 query 根目录触发 + 验证） ----------
async function connect({ host, share, port, user, password, domain, save }) {
  const h = cleanHost(host)
  const sh = cleanShare(share)
  if (!h) return { ok: false, error: '缺少服务器地址' }
  if (!sh) return { ok: false, error: '缺少共享名' }
  try { if (session) await disconnect() } catch { session = null }

  let client
  try {
    client = new SMB2Client({
      share: `\\\\${h}\\${sh}`,
      port: Number(port) || 445,
      username: user || 'guest',
      password: password || '',
      domain: domain || '',
    })
  } catch (e) {
    return { ok: false, error: friendlyError(e) }
  }

  const root = await withTimeout(client, '/')
  if (!root.ok) return root

  session = { client, share: sh }
  if (save) saveCredentials({ host: h, share: sh, user: user || 'guest', password: password || '', domain: domain || '' })
  return { ok: true, items: root.items }
}

// 用 readdir('/') 触发连接并验证；带超时
function withTimeout(client, dirPath) {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: '连接超时：服务器响应过慢或未开机' }) } }, CONNECT_TIMEOUT)
    client.readdir(dirPath, (err, names) => {
      if (done) return
      done = true; clearTimeout(timer)
      if (err) resolve({ ok: false, error: friendlyError(err) })
      else resolve({ ok: true, items: names })
    })
  })
}

// 把底层错误转成用户可读的原因
function friendlyError(err) {
  const msg = String((err && (err.message || err)) || '')
  const code = err && err.code
  if (/LOGON|ACCESS_DENIED|access denied|SESSION/i.test(msg + ' ' + (code || ''))) return '登录失败：账号或密码错误，或无权限'
  if (/BAD_NETWORK_NAME|UNKNOWN_SHARE|NO_SUCH|SHARE|no such/i.test(msg + ' ' + (code || ''))) return '共享无效：请确认共享名正确'
  if (/HOSTUNREACH|NETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(msg + ' ' + (code || ''))) return '无法连接服务器：IP 不可达或端口未开'
  if (/time ?out/i.test(msg)) return '连接超时'
  return String(msg).slice(0, 140)
}

// ---------- 浏览（query_directory 解析类型/大小） ----------
function listDir(client, dirPath) {
  const p = cleanPath(dirPath)
  return new Promise((resolve, reject) => {
    Forge.request('open_folder', { path: p }, client, (err, file) => {
      if (err) return reject(err)
      collectAll(file, client, [], (err2, files) => {
        Forge.request('close', file, client, () => {
          if (err2) return reject(err2)
          resolve(files.map(parseEntry))
        })
      })
    })
  })
}
function collectAll(file, client, all, cb) {
  Forge.request('query_directory', file, client, (err, files) => {
    const merged = all.concat(files || [])
    if (err && String(err.code || err.message || '').includes('STATUS_NO_MORE_FILES')) {
      return cb(null, merged)
    }
    if (err) return cb(err)
    collectAll(file, client, merged, cb)
  })
}
function parseEntry(f) {
  return {
    name: f.Filename,
    isDirectory: !!(f.FileAttributes & ATTR_DIR),
    size: readU64(f.EndofFile),
    path: null, // 调用方补
  }
}
function readU64(buf) {
  if (!buf || !buf.length) return 0
  let lo = 0, hi = 0
  for (let i = 0; i < Math.min(4, buf.length); i++) lo |= buf[i] << (8 * i)
  for (let i = 4; i < Math.min(8, buf.length); i++) hi |= buf[i] << (8 * (i - 4))
  return lo + hi * 0x100000000
}

// ---------- 流式 Range 读取（open→read→close，每次请求 64KB） ----------
function streamRead(client, remotePath, offset, length, cb) {
  Forge.request('open', { path: cleanPath(remotePath) }, client, (err, file) => {
    if (err) return cb(err)
    readAll(client, file, offset, length, cb)
  })
}
function readAll(client, file, offset, remaining, cb) {
  if (remaining <= 0) return cb(null, Buffer.alloc(0))
  const want = Math.min(remaining, MAX_READ)
  const off = makeOffset(offset)
  Forge.request('read', { FileId: file.FileId, Length: want, Offset: off }, client, (err, data) => {
    if (err) return Forge.request('close', file, client, () => cb(err))
    if (!data || data.length === 0) return Forge.request('close', file, client, () => cb(new Error('读取到文件末尾')))
    offset += data.length
    remaining -= data.length
    if (remaining > 0 && data.length < want) {
      return Forge.request('close', file, client, () => cb(null, data))
    }
    if (remaining > 0) {
      // 继续读
      return readAll(client, file, offset, remaining, (err2, more) => {
        Forge.request('close', file, client, () => cb(err2, err2 ? undefined : Buffer.concat([data, more])))
      })
    }
    Forge.request('close', file, client, () => cb(null, data))
  })
}
function makeOffset(n) {
  const b = Buffer.alloc(8)
  b.writeUInt32LE(n % 0x100000000, 0)
  b.writeUInt32LE(Math.floor(n / 0x100000000), 4)
  return b
}

// ---------- 注册 SMB 文件为流媒体源 ----------
function smbStreamSource(remotePath) {
  const source = {
    id: null,
    read: (offset, length, cb) => {
      if (!session) return cb(new Error('SMB 未连接'))
      streamRead(session.client, remotePath, offset, length, cb)
    },
    stat: (cb) => {
      if (!session) return cb(new Error('SMB 未连接'))
      Forge.request('open', { path: cleanPath(remotePath) }, session.client, (err, file) => {
        if (err) return cb(err)
        Forge.request('close', file, session.client, () => {
          cb(null, readU64(file.EndofFile))
        })
      })
    },
  }
  return source
}

function registerSmb() {
  ipcMain.handle('smb:connect', async (_e, opts) => {
    const r = await connect(opts || {})
    return r
  })
  ipcMain.handle('smb:disconnect', async () => {
    await disconnect()
    return { ok: true }
  })
  ipcMain.handle('smb:is-connected', () => ({
    ok: !!session,
    share: session ? session.share : null,
  }))
  ipcMain.handle('smb:list', async (_e, p) => {
    try {
      if (!session) return { ok: false, error: '未连接 SMB 服务器' }
      const items = await listDir(session.client, p)
      const base = cleanPath(p)
      const withPath = items.map((it) => ({ ...it, path: (base === '/' ? '' : base) + '/' + it.name }))
      return { ok: true, items: withPath }
    } catch (e) {
      return { ok: false, error: friendlyError(e) }
    }
  })
  ipcMain.handle('smb:register-video', async (_e, remotePath) => {
    try {
      if (!session) return { ok: false, error: '未连接 SMB 服务器' }
      const src = smbStreamSource(remotePath)
      const ext = path.extname(remotePath).toLowerCase()
      const { id, url } = registerSource({ read: src.read, stat: src.stat, name: remotePath, ext })
      src.id = id
      return { ok: true, id, url }
    } catch (e) {
      return { ok: false, error: friendlyError(e) }
    }
  })
}

async function disconnect() {
  if (session && session.client) {
    try { session.client.close(() => {}) } catch (e) { /* ignore */ }
  }
  session = null
}

module.exports = { registerSmb, connect, listDir, disconnect, loadCredentials, streamRead }