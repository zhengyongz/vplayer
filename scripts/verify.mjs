#!/usr/bin/env node
// VPlayer 一键体检：问题清单 + 决策台账 + 冒烟报告 + 版本号一致性
// 退出码：0 = 可发版；1 = 有阻塞项
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = join(ROOT, 'docs/TASKS.md')
const STATE = join(ROOT, 'docs/STATE.md')
const SMOKE = join(ROOT, '.smoke-report/smoke.json')

const args = process.argv.slice(2)
const wantJson = args.includes('--json')
const noSmoke = args.includes('--no-smoke')
const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', x: '\x1b[0m' }
const out = (s = '') => process.stdout.write(s + '\n')

const OPEN = new Set(['待修', '进行中', '待验'])
const report = { ok: false, checks: {}, blockers: [], warnings: [] }

// 1. 问题清单
if (!existsSync(TASKS)) report.blockers.push('缺少 docs/TASKS.md')
else {
  const text = readFileSync(TASKS, 'utf8')
  const rows = []
  let section = ''
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { section = line.slice(3).trim(); continue }
    if (section.includes('汇总')) continue
    const m = line.match(/^\|\s*([RBTV])-(\d+)\s*\|/)
    if (!m) continue
    const cells = line.split('|').map((s) => s.trim())
    const prio = section.includes('高优先') ? '🔴' : section.includes('中优先') ? '🟡' : '⚪'
    const idx = cells.findIndex((x) => OPEN.has(x))
    rows.push({ id: `${m[1]}-${m[2]}`, prio, status: idx >= 0 ? cells[idx] : '?', title: cells[2] || cells[1] || '' })
  }
  const open = rows.filter((r) => OPEN.has(r.status))
  const high = open.filter((r) => r.prio === '🔴')
  report.checks.tasks = { total: rows.length, open: open.length, highOpen: high.length, highOpenIds: high.map((r) => r.id) }
  if (high.length) report.blockers.push(`🔴 高优先级未闭环：${high.map((r) => r.id).join(', ')}`)
}

// 2. 决策台账
if (!existsSync(STATE)) report.blockers.push('缺少 docs/STATE.md')
else {
  const st = readFileSync(STATE, 'utf8')
  report.checks.state = { decisions: (st.match(/^### D-\d+/gm) || []).length, pendings: (st.match(/^\| Q-\d+/gm) || []).length }
}

// 3. 冒烟
if (!noSmoke) {
  if (!existsSync(SMOKE)) {
    spawnSync('npm', ['run', 'smoke', '--silent'], { cwd: ROOT, encoding: 'utf8', timeout: 600000 })
  }
  if (existsSync(SMOKE)) {
    const s = JSON.parse(readFileSync(SMOKE, 'utf8'))
    report.checks.smoke = { ok: s.ok, passed: s.passed, failed: s.failed, total: s.total }
    if (!s.ok) report.blockers.push(`冒烟 ${s.failed} 项失败`)
  } else report.blockers.push('冒烟未能产出报告')
} else report.checks.smoke = { skipped: true }

// 4. 版本
try {
  const v = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  report.checks.version = { version: v }
} catch { /* 忽略 */ }

report.ok = report.blockers.length === 0
if (wantJson) out(JSON.stringify(report, null, 2))
else {
  out(`\n${c.g}══ VPlayer 发版体检 ══${c.x}\n`)
  if (report.checks.tasks) out(`问题清单  ${report.checks.tasks.total} 条 · 未闭环 ${report.checks.tasks.open}${report.checks.tasks.highOpen ? ` · ${c.r}🔴 ${report.checks.tasks.highOpen}${c.x}` : ''}`)
  if (report.checks.state) out(`决策台账  ${report.checks.state.decisions} 条 · 待拍板 ${report.checks.state.pendings}`)
  if (report.checks.version) out(`版本号    v${report.checks.version.version}`)
  if (report.checks.smoke) out(report.checks.smoke.skipped ? '冒烟测试  跳过' : `冒烟测试  ${report.checks.smoke.passed}/${report.checks.smoke.total}`)
  out('')
  for (const b of report.blockers) out(`${c.r}✗ ${b}${c.x}`)
  for (const w of report.warnings) out(`${c.y}⚠ ${w}${c.x}`)
  out(report.ok ? `${c.g}✓ 无阻塞项，可进入发版流程${c.x}` : `${c.r}✗ 存在阻塞项${c.x}`)
  out('')
}
process.exit(report.ok ? 0 : 1)