import React, { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../context/PlayerContext'

// 设置浮层：检查更新 / 编解码组件管理 / 关于版本
export default function SettingsPopover({ open, onClose }) {
  const { t, codecStatus, installCodec, uninstallCodec, setUpdate } = usePlayer()
  const [version, setVersion] = useState('')
  const ref = useRef(null)

  useEffect(() => { window.vplayer.getVersion().then(setVersion) }, [])
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose])

  async function doCheck() {
    const r = await window.vplayer.checkUpdate()
    setUpdate({ type: 'check-result', ...r })
    onClose()
  }

  if (!open) return null

  return (
    <div ref={ref} className="absolute right-3 top-14 z-50 w-64 rounded-xl border border-neutral-700 bg-neutral-800 p-3 text-sm text-neutral-200 shadow-2xl">
      <div className="mb-2 px-1 text-xs uppercase tracking-wide text-neutral-500">{t('settings')}</div>

      <button className="row-btn" onClick={doCheck}>🔄 {t('checkUpdate')}</button>

      {codecStatus && (
        codecStatus.installed ? (
          <button className="row-btn" onClick={uninstallCodec}>🗑 {t('uninstallCodec')} <span className="ml-auto text-xs text-emerald-400">✓ v{codecStatus.version}</span></button>
        ) : (
          <button className="row-btn" onClick={installCodec}>⬇ {t('installCodec')} <span className="ml-auto text-xs text-neutral-500">–</span></button>
        )
      )}

      <div className="mt-2 border-t border-neutral-700 px-1 pt-2 text-xs text-neutral-400">
        {t('about')}：{t('appName')} v{version || '…'}
      </div>
    </div>
  )
}