import React, { useEffect, useState } from 'react'
import { usePlayer } from '../context/PlayerContext'

// 升级状态 Toast：检查到新版本 / 下载 / 下载完成引导安装 / 错误
export default function UpdateToast() {
  const { update, t, setUpdate } = usePlayer()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => { setDismissed(false) }, [update && update.latestVersion])

  if (!update || dismissed) return null

  if (update.type === 'check-result' || update.type === 'available') {
    if (update.hasUpdate) {
      return (
        <Bar>
          <span>{t('updateAvailable')}：v{update.latestVersion}</span>
          <button className="btn-primary" onClick={() => window.vplayer.startDownload()}>{t('updateDownload')}</button>
          <button className="btn-neutral" onClick={() => window.vplayer.openExternal('https://github.com/zhengyongz/vplayer/releases/latest')}>{t('updateManual')}</button>
          <button className="btn-close" onClick={() => setDismissed(true)}>✕</button>
        </Bar>
      )
    }
    return null
  }

  if (update.type === 'downloading') {
    const total = update.total || 0
    const received = update.received || 0
    const pct = total > 0 ? Math.round((received / total) * 100) : 0
    return (
      <Bar>
        <span>{t('updateDownloading')} {pct}%{update.source ? ' · ' + update.source : ''}{update.note ? ' · ' + update.note : ''}</span>
        <button className="btn-close" onClick={() => setDismissed(true)}>✕</button>
      </Bar>
    )
  }

  if (update.type === 'downloaded') {
    return (
      <Bar>
        <span>{t('updateDownloaded')}{update.note ? ' · ' + update.note : ''}</span>
        <button className="btn-primary" onClick={() => { window.vplayer.installUpdate(); setDismissed(true) }}>{t('updateInstall')}</button>
        <button className="btn-neutral" onClick={() => window.vplayer.openInstaller()}>{t('updateOpenInstaller')}</button>
        <button className="btn-neutral" onClick={() => window.vplayer.copyInstallCmd()}>{t('updateLinuxCmd')}</button>
        <button className="btn-close" onClick={() => setDismissed(true)}>✕</button>
      </Bar>
    )
  }

  if (update.type === 'error') {
    return (
      <Bar>
        <span>{t('updateCheckFail')}：{update.message || ''}</span>
        <button className="btn-close" onClick={() => setDismissed(true)}>✕</button>
      </Bar>
    )
  }

  return null
}

function Bar({ children }) {
  return (
    <div className="absolute inset-x-0 bottom-3 z-40 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-800/95 px-4 py-2 text-sm text-neutral-100 shadow-xl backdrop-blur">
      {children}
    </div>
  )
}