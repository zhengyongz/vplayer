import React, { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../context/PlayerContext'

// 打开网址对话框（用原生 <dialog> 保持极简；无 <dialog> 环境降级为自定义事件）
export default function UrlDialog() {
  const { t, openUrl } = usePlayer()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const dialogRef = useRef(null)

  useEffect(() => {
    const onOpen = () => dialogRef.current && dialogRef.current.showModal && dialogRef.current.showModal()
    document.addEventListener('vplayer:open-url-dialog', onOpen)
    return () => document.removeEventListener('vplayer:open-url-dialog', onOpen)
  }, [])

  function submit() {
    const trimmed = url.trim()
    if (!/^https?:\/\//i.test(trimmed)) { setError(t('urlInvalid')); return }
    setError('')
    openUrl(trimmed)
    if (dialogRef.current && dialogRef.current.close) dialogRef.current.close()
    setUrl('')
  }

  return (
    <dialog id="url-dialog" ref={dialogRef}
      className="w-[420px] max-w-[90vw] rounded-xl border border-neutral-700 bg-neutral-800 p-5 text-neutral-100 backdrop:bg-black/60">
      <h2 className="mb-3 text-base font-semibold">{t('openUrl')}</h2>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={t('urlPlaceholder')}
        className="w-full rounded-md border border-neutral-600 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
        autoFocus
      />
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => { dialogRef.current && dialogRef.current.close(); setError('') }}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700">{t('urlCancel')}</button>
        <button onClick={submit} className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500">{t('urlGo')}</button>
      </div>
    </dialog>
  )
}