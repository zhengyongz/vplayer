// src/utils/format.js — 时长/体积格式化
export function formatTime(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? h + ':' : ''}${mm}:${String(ss).padStart(2, '0')}`
}

export function formatBytes(bytes) {
  if (bytes == null || !isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

// 文件名去扩展名
export function stemOf(name) {
  const base = String(name || '')
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(0, i) : base
}