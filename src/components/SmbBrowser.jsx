import React, { useCallback, useEffect, useState } from 'react'
import { usePlayer } from '../context/PlayerContext'

// SMB 浏览器：连接 → 列共享根 → 浏览目录 → 点视频播放
export default function SmbBrowser({ onClose }) {
  const { t, openSmb } = usePlayer()
  const [host, setHost] = useState('')
  const [share, setShare] = useState('')
  const [user, setUser] = useState('guest')
  const [password, setPassword] = useState('')
  const [save, setSave] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [cwd, setCwd] = useState('/')
  const [stack, setStack] = useState([]) // 目录栈
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

const connect = useCallback(async () => {
    setError('')
    setConnecting(true)
    const r = await window.vplayer.smbConnect({
      host, share, port: 445, user, password, domain: '', save,
    })
    setConnecting(false)
    if (r.ok) {
      setConnected(true); setCwd('/'); setStack([])
      await list('/')
    } else {
      setError(t('smbConnectFail') + '：' + r.error)
    }
  }, [host, share, user, password, save, t])

  const list = useCallback(async (pathStr) => {
    setLoading(true); setError('')
    const r = await window.vplayer.smbList(pathStr)
    setLoading(false)
    if (r.ok) { setItems(r.items); setCwd(pathStr) }
    else setError(r.error)
  }, [])

  async function enterDir(item) {
    setStack((prev) => [...prev, cwd])
    await list(item.path)
  }
async function enter(item) {
    setStack((prev) => [...prev, cwd])
    await list(item.path)
  }
  async function back() {
    const prev = stack[stack.length - 1]
    setStack((s) => s.slice(0, -1))
    await list(prev || '/')
  }

  async function play(item) {
    const ok = await openSmb(item)
    if (ok) onClose()
  }

  const videos = items.filter((i) => !i.isDirectory && /\.(mp4|mkv|webm|avi|mov|m4v|wmv|flv|ts|mpg|mpeg)$/i.test(i.name))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="flex h-[560px] w-[560px] max-w-[94vw] flex-col rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>

        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold">{t('smbTitle')}</h2>
          <button onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-800">✕</button>
        </div>

        {!connected ? (
          /* 连接表单 */
          <div className="flex-1 overflow-y-auto p-5">
            <Field label={t('smbHost')}>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={t('smbHostPlaceholder')}
                className="inp" />
            </Field>
            <Field label={t('smbShare')}>
              <input value={share} onChange={(e) => setShare(e.target.value)} placeholder="videos / media / …"
                className="inp" />
            </Field>
            <Field label={t('smbUser')}>
              <input value={user} onChange={(e) => setUser(e.target.value)} className="inp" />
            </Field>
            <Field label={t('smbPassword')}>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="inp" />
            </Field>
            <label className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
              {t('smbSave')}
            </label>
            {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
            <div className="mt-5 flex justify-end">
              <button onClick={connect} disabled={connecting || !host || !share}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40">
                {connecting ? t('smbConnect') + '…' : t('smbConnect')}
              </button>
            </div>
          </div>
        ) : (
          /* 文件浏览 */
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-xs text-neutral-400">
              <button onClick={back} disabled={stack.length === 0}
                className="rounded px-2 py-1 hover:bg-neutral-800 disabled:opacity-30">← {t('smbBack')}</button>
              <button onClick={() => { window.vplayer.smbDisconnect(); setConnected(false); setItems([]); setCwd('/'); setStack([]) }}
                className="rounded px-2 py-1 text-neutral-300 hover:bg-neutral-800">{t('smbDisconnect')}</button>
              <span className="ml-2 truncate text-neutral-500">{cwd}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center text-neutral-500">…</div>
              ) : items.length === 0 ? (
                <div className="flex h-full items-center justify-center text-neutral-500">{t('smbEmpty')}</div>
              ) : (
                <ul className="divide-y divide-neutral-800">
                  {items.map((item) => (
                    <li key={item.path}>
                      <button
                        onClick={() => item.isDirectory ? enter(item) : play(item)}
                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-neutral-800">
                        <span>{item.isDirectory ? '📁' : isVideo(item.name) ? '🎬' : '📄'}</span>
                        <span className="flex-1 truncate">{item.name}</span>
                        {!item.isDirectory && item.size > 0 && (
                          <span className="text-xs text-neutral-500">{fmt(item.size)}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

function fmt(b) {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB'
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB'
  return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}
function isVideo(n) {
  return /\.(mp4|mkv|webm|avi|mov|m4v|wmv|flv|ts|mpg|mpeg)$/i.test(n)
}