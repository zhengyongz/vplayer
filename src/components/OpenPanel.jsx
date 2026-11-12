import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayer } from '../context/PlayerContext'

// 空状态首页：三个来源 + 拖拽 + 最近播放
export default function OpenPanel({ onOpenSmb }) {
  const { t, lang, openFiles, openUrl, recent, pushRecent } = usePlayer()
  const [dragging, setDragging] = useState(false)

  const drop = useCallback(async (e) => {
    e.preventDefault()
    setDragging(false)
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return
    const paths = [...e.dataTransfer.files].map((f) => f.path)
    openFiles(paths)
  }, [openFiles])

  async function pickLocal() {
    const paths = await window.vplayer.openDialog()
    if (paths && paths.length) openFiles(paths)
  }

  function playRecent(item) {
    if (item.kind === 'local' && item.path) openFiles([item.path])
    else if (item.kind === 'url' && item.url) openUrl(item.url)
    else if (item.kind === 'smb' && item.path) { /* SMB 需重连会话，暂提示 */ }
  }

  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-8 bg-neutral-900 ${dragging ? 'ring-2 ring-inset ring-sky-400' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}>

      <div className="text-center">
        <div className="mb-2 text-4xl">🎬</div>
        <h1 className="text-xl font-semibold text-neutral-100">{t('dropHint')}</h1>
        <p className="mt-1 text-sm text-neutral-400">{t('dragTitle')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <SourceBtn icon="▶" label={t('openLocal')} onClick={pickLocal} accent />
        <SourceBtn icon="🔗" label={t('openUrl')} onClick={openUrlBtn} />
        <SourceBtn icon="🗂" label={t('openSmb')} onClick={onOpenSmb} />
      </div>

      {recent && recent.length > 0 && (
        <div className="w-80 max-w-[90%]">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">{t('recent')}</div>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.key || r.title}>
                <button onClick={() => playRecent(r)}
                  className="flex w-full items-center gap-2 rounded-md bg-neutral-800/60 px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-800">
                  <span className="text-xs">{r.kind === 'url' ? '🔗' : r.kind === 'smb' ? '🗂' : '▶'}</span>
                  <span className="truncate">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SourceBtn({ icon, label, onClick, accent }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium transition
        ${accent ? 'bg-sky-600 text-white hover:bg-sky-500' : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'}`}>
      {icon} {label}
    </button>
  )
}

function openUrlBtn() {
  const el = document.getElementById('url-dialog')
  if (el && typeof el.showModal === 'function') el.showModal()
  else document.dispatchEvent(new CustomEvent('vplayer:open-url-dialog'))
}