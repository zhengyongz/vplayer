#!/usr/bin/env node
// VPlayer 交接指令包生成器（沿用 DocLite 流程约定）
// npm run handoff                → 列出待办
// npm run handoff R-001          → 为指定问题生成
// npm run handoff -- --all       → 全部未闭环
// npm run handoff -- --task "…"  → 自定义任务
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = join(ROOT, 'docs/TASKS.md')
const STATE = join(ROOT, 'docs/STATE.md')
const args = process.argv.slice(2)
const wantAll = args.includes('--all')
const taskIdx = args.indexOf('--task')
const custom = taskIdx >= 0 ? args[taskIdx + 1] : null
const ids = args.filter((a) => /^[RBTV]-\d+$/.test(a))
const out = (s = '') => process.stdout.write(s + '\n')
const c = { g: '\x1b[32m', x: '\x1b[0m' }

const OPEN = new Set(['待修', '进行中', '待验'])
function parseTasks() {
  if (!existsSync(TASKS)) return []
  const rows = []
  let section = ''
  for (const line of readFileSync(TASKS, 'utf8').split('\n')) {
    if (line.startsWith('## ')) { section = line.slice(3).trim(); continue }
    if (section.includes('汇总')) continue
    const m = line.match(/^\|\s*([RBTV])-(\d+)\s*\|/)
    if (!m) continue
    const cells = line.split('|').map((s) => s.trim())
    const idx = cells.findIndex((x) => OPEN.has(x))
    if (idx < 0) continue
    const prio = section.includes('高优先') ? '🔴' : section.includes('中优先') ? '🟡' : '⚪'
    rows.push({ id: `${m[1]}-${m[2]}`, prio, status: cells[idx], title: cells[2] || cells[1] || '', where: cells[3] || '' })
  }
  return rows
}
const openTasks = parseTasks()

if (!ids.length && !custom && !wantAll) {
  out('')
  out(`${c.g}══ VPlayer 待办清单 ══${c.x}（共 ${openTasks.length} 项未闭环）`)
  for (const t of openTasks) out(`  ${t.id.padEnd(7)} ${t.prio} ${t.status.padEnd(3)} ${t.title.slice(0, 52)}`)
  out(`\n用法：npm run handoff R-001 / --all / --task "…"`)
  process.exit(0)
}

const picked = wantAll ? openTasks : openTasks.filter((t) => ids.includes(t.id))
const L = []
L.push('# VPlayer 交接指令包')
L.push('')
L.push('> 由 `npm run handoff` 自动生成。请先读完本文件再动手，不要反问项目背景。')
L.push('')
L.push('## 项目')
L.push('')
L.push('- 路径：`/home/zhengyz/文档/Vplayer`')
L.push('- 技术栈：Electron 33 + React 18 + Vite 6 + Tailwind 3 + electron-builder 25')
L.push('- 形态：极简视频播放器，本地/网址/局域网 SMB 三源，中英双语，差量升级；编解码组件可选')
L.push('- 版本：见 `package.json` 的 `version`')
L.push('')
L.push('## 本轮任务')
L.push('')
if (custom) L.push(custom)
else {
  L.push('修复以下问题（按优先级，全部修完或说明为何不改）：')
  for (const t of picked) { L.push(`- **${t.id}**（${t.prio} ${t.status}）${t.title}`); if (t.where) L.push(`  - 位置：${t.where}`) }
}
L.push('')
L.push('## 必读上下文（按顺序读完再动手）')
L.push('')
L.push('1. `docs/STATE.md` — 历史决策与理由，不要推翻；需改则追加新决策（标注「废止 D-xxx」）。')
L.push('2. `docs/TASKS.md` — 问题清单，修完把状态改 `待验`→`已修`。')
L.push('3. `docs/smoke/README.md` — 冒烟套件说明。')
L.push('4. `README.md` 与 `DEVLOG.md`（若有）— 技术说明。')
L.push('')
L.push('## 约束')
L.push('')
L.push('- 改完必须 `npm run smoke` 全部通过（允许 ⚠，不允许 ✗）。')
L.push('- 用户可见文案走 `src/i18n/index.js` 的 `t()`，不硬编码中英文。')
L.push('- 不要改动 `docs/STATE.md` 历史条目（可追加）、`docs/reviews/` 归档原文。')
L.push('- 保持本地化与轻量（零/少依赖）。')
L.push('')
L.push('## 验收标准')
L.push('')
L.push('- [ ] `npm run smoke` 无 ✗ 失败')
L.push('- [ ] `npm run status` 中本轮条目状态已更新')
L.push('- [ ] commit 末尾附 `Closes: <ID列表>`')
L.push('')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
L.push(`当前版本 v${pkg.version} · 未闭环 ${openTasks.length} 项`)
const packet = L.join('\n')
out(packet)