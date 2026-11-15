#!/usr/bin/env node
/**
 * VPlayer SMB 分步诊断脚本（临时排查用）
 * 用法：node scripts/smb-diag.cjs <服务器IP> <共享名> <用户名> <密码>
 * 逐步执行 SMB 握手，定位错误出在哪一步。密码仅本进程使用，不上传。
 */
const SMB2Client = require('smb2')
const Forge = require('smb2/lib/tools/smb2-forge')

const [host, share, user, password] = process.argv.slice(2)
if (!host || !share) { console.log('用法: node scripts/smb-diag.cjs <IP> <共享名> <用户> <密码>'); process.exit(1) }

function step(name, fn) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    fn((err) => {
      const dt = ((Date.now() - t0) / 1000).toFixed(2)
      if (err) {
        const code = err && (err.code || err.status || '')
        console.log(`✗ ${name.padEnd(20)} (${dt}s) ${String(err.message || err).slice(0, 160)}${code ? ` [${code}]` : ''}`)
        resolve(false)
      } else { console.log(`✓ ${name.padEnd(20)} (${dt}s)`); resolve(true) }
    })
  })
}

let client
try {
  client = new SMB2Client({ share: `\\\\${host}\\${share}`, username: user || 'guest', password: password || '', domain: '' })
} catch (e) { console.log('[构造失败] ' + e.message); process.exit(1) }

console.log(`连接 ${host}/${share}，用户: ${user || 'guest'}`)

client.socket.on('error', (e) => console.log(`[socket] 网络错误: ${e.code || e.message}`))
client.socket.on('connect', async () => {
  const ok1 = await step('① negotiate', (cb) => Forge.request('negotiate', {}, client, cb))
  if (!ok1) return finish()
  const ok2 = await step('② session_setup(step1)', (cb) => Forge.request('session_setup_step1', {}, client, cb))
  if (!ok2) return finish()
  const ok3 = await step('③ session_setup(step2/认证)', (cb) => Forge.request('session_setup_step2', {}, client, cb))
  if (!ok3) return finish()
  const ok4 = await step('④ tree_connect(共享)', (cb) => Forge.request('tree_connect', {}, client, cb))
  if (!ok4) return finish()

  // 列根目录
  await step('⑤ 打开根目录 open_folder', (s) => Forge.request('open_folder', { path: '/' }, client, s))
  // 空路径兜底
  await step('⑤b open_folder(空路径)', (s) => Forge.request('open_folder', { path: '' }, client, s))
  finish()
})
client.socket.connect(Number(client.port), client.ip)
setTimeout(() => { console.log('[超时] 20 秒未完成'); process.exit(1) }, 20000)

function finish() { console.log('--- 诊断结束 ---'); process.exit(0) }