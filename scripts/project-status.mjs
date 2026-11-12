#!/usr/bin/env node
// VPlayer 项目状态：读 docs/TASKS.md 汇总看板 + 决策台账，展示未闭环项
// npm run status        → 表格
// npm run status --json → JSON
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = join(ROOT, 'docs/TASKS.md')
const STATE = join(ROOT, 'docs/STATE.md')
const args = process.argv.slice(2)
const json = args.includes('--json')
const out = (s = '') => process.stdout.write(s + '\n')

const OPEN = new Set(['待修', '进行中', '待验'])
function parse() {
  if (!existsSync(TASKS)) return []
  const rows = []
  let section = ''
  for (const line of readFileSync(TASKS, 'utf8').split('\n')) {
    if (line.startsWith('## ')) { section = line.slice(3).trim(); continue }
    if (section.includes('汇总')) continue
    const m = line.match(/^\|\s*([RBTV])-(\d+)\s*\|/)
    if (!m) continue
    const cells = line.split('|').map((s) => s.trim())
    const prio = section.includes('高优先') ? '🔴' : section.includes('中优先') ? '🟡' : '⚪'
    rows.push({ id: `${m[1]}-${m[2]}`, prio, status: cells.find((x) => OPEN.has(x) || ['已修', '已搁置', '已知限制'].includes(x)) || '?', title: cells[2] || cells[1] || '' })
  }
  return rows
}
const rows = parse()
const open = rows.filter((r) => OPEN.has(r.status))
const closed = rows.filter((r) => !OPEN.has(r.status))

const stats = { total: rows.length, open: open.length, closed: closed.length, high: open.filter((r) => r.prio === '🔴').length }
if (json) { out(JSON.stringify({ stats, rows }, null, 2)); process.exit(0) }

out('')
out('══ VPlayer 项目状态 ══')
out(`问题清单 共 ${stats.total} 条 · 未闭环 ${stats.open}（🔴 ${stats.high}）· 已闭环 ${stats.closed}`)
out('')
if (open.length) {
  out('未闭环：')
  for (const r of open) out(`  ${r.id.padEnd(7)} ${r.prio} ${r.status.padEnd(4)} ${r.title.slice(0, 60)}`)
} else out('✓ 全部闭环')
if (existsSync(STATE)) {
  const st = readFileSync(STATE, 'utf8')
  out(`\n决策台账 ${(st.match(/^### D-\d+/gm) || []).length} 条 · 待拍板 ${(st.match(/^\| Q-\d+/gm) || []).length} 项`)
}
out('')