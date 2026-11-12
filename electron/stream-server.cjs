// electron/stream-server.cjs
// 本地 HTTP 流媒体服务器：把「本地文件 / SMB 文件 / 转码渐进流」统一抽象为带 Range 的 HTTP 源，
// 供渲染层 <video> 播放与拖拽 seek。运行在 127.0.0.1 随机端口，仅本机可访问。
// 设计：每个 source 是一个 { read(offset, length, cb), stat() } 对象；服务器按 Range 头分片读取。
const http = require('http')
const { app, ipcMain } = require('electron')
const fs = require('fs')
const crypto = require('crypto')

const sources = new Map() // id -> { read, stat, name, kind }
let server = null
let basePort = 0

// 随机端口：从 17200 起尝试空闲端口（避免与常见服务冲突）
async function startServer() {
  if (server) return basePort
  for (let port = 17200; port < 17300; port++) {
    try {
      await new Promise((resolve, reject) => {
        const srv = http.createServer(handler)
        srv.on('error', reject)
        srv.listen(port, '127.0.0.1', () => resolve(srv))
      }).then((srv) => { server = srv })
      basePort = port
      return basePort
    } catch (e) {
      // 端口被占，试下一个
    }
  }
  throw new Error('无法启动本地流媒体服务器（端口耗尽）')
}

// 处理 Range 请求：/stream/<id>?ext=.mp4
function handler(req, res) {
  const u = new URL(req.url, `http://127.0.0.1:${basePort}`)
  const parts = u.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'stream' || parts.length < 2) {
    res.writeHead(404).end()
    return
  }
  const id = parts[1]
  const source = sources.get(id)
  if (!source) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
    return
  }

  const range = req.headers.range

  source.stat((err, size) => {
    if (err || size == null) {
      if (err && /growing/.test(String(err && err.message || ''))) {
        // 转码渐进流尚未就绪：返回 200 空 body，客户端稍后重试
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'none',
        }).end()
        return
      }
      respondError(res, 500, '无法读取媒体')
      return
    }

    const mime = mimeForExt(u.searchParams.get('ext'))
    if (!range) {
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': size,
        'Accept-Ranges': 'bytes',
      })
      source.read(0, size, (err2, data) => {
        if (err2) { res.destroy(); return }
        res.end(data)
      })
      return
    }

    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (!m) {
      res.writeHead(416).end()
      return
    }
    let start = m[1] ? parseInt(m[1], 10) : 0
    let end = m[2] ? parseInt(m[2], 10) : size - 1
    if (end >= size) end = size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return
    }
    const length = end - start + 1
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': length,
      'Accept-Ranges': 'bytes',
    })
    source.read(start, length, (err2, data) => {
      if (err2) { res.destroy(); return }
      res.end(data)
    })
  })
}

function mimeForExt(ext) {
  const map = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.ts': 'video/mp2t', '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg', '.m2ts': 'video/mp2t',
  }
  return map[ext] || 'video/mp4'
}

function respondError(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain' }).end(msg)
}

function newId() {
  return crypto.randomBytes(8).toString('hex')
}

function registerSource({ read, stat, name, ext }) {
  const id = newId()
  sources.set(id, { read, stat, name, ext })
  return { id, url: `http://127.0.0.1:${basePort}/stream/${id}?ext=${encodeURIComponent(ext || '.mp4')}` }
}

function unregisterSource(id) {
  sources.delete(id)
}

// ---------- 本地文件 source ----------
function fileSource(filePath) {
  return {
    read: (offset, length, cb) => {
      const s = fs.createReadStream(filePath, { start: offset, end: offset + length - 1 })
      const chunks = []
      s.on('data', (c) => chunks.push(c))
      s.on('end', () => cb(null, Buffer.concat(chunks)))
      s.on('error', cb)
    },
    stat: (cb) => fs.stat(filePath, (err, st) => cb(err, err ? 0 : st.size)),
  }
}

// 统计信息
function sourceStats() {
  return { count: sources.size, ids: [...sources.keys()] }
}

function registerStreamServer() {
  ipcMain.handle('stream:register-file', async (_e, filePath) => {
    try {
      const port = await startServer()
      if (typeof filePath !== 'string' || !filePath) return { ok: false, error: '无效路径' }
      const ext = require('path').extname(filePath).toLowerCase()
      const src = fileSource(filePath)
      const { id, url } = registerSource(src, ext)
      return { ok: true, id, url }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('stream:unregister', (_e, id) => {
    unregisterSource(id)
    return { ok: true }
  })
}

module.exports = { registerStreamServer, registerSource, unregisterSource, startServer, fileSource, sourceStats }