import React, { useState } from 'react'
import { usePlayer } from '../context/PlayerContext'
import UrlDialog from './UrlDialog'
import SettingsPopover from './SettingsPopover'

export default function Header({ onOpenSmb }) {
  const { t, lang, setLang, openFiles } = usePlayer()
  const [settingsOpen, setSettingsOpen] = useState(false)

  async function pickLocal() {
    const paths = await window.vplayer.openDialog()
    if (paths && paths.length) openFiles(paths)
  }

  return (
    <header className="flex h-14 items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-4">
      <div className="mr-2 flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" className="text-sky-400">
          <path d="M4 6v12l8-6L4 6z" fill="currentColor" />
          <rect x="18" y="6" width="3" height="12" rx="1" fill="currentColor" opacity="0.85" />
        </svg>
        <span className="font-semibold tracking-wide text-neutral-100">{t('appName')}</span>
      </div>

      <button onClick={pickLocal} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700">
        ▶ {t('openLocal')}
      </button>
      <button onClick={openUrlDialog} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700">
        🔗 {t('openUrl')}
      </button>
      <button onClick={onOpenSmb} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-700">
        🗂 {t('openSmb')}
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800" title="切换语言 / Language">
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
        <button onClick={() => setSettingsOpen((v) => !v)}
          className="rounded-md px-2.5 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800" title={t('settings')}>
          ⚙
        </button>
      </div>
      <UrlDialog />
      <SettingsPopover open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  )
}

function openUrlDialog() {
  const el = document.getElementById('url-dialog')
  if (el && typeof el.showModal === 'function') el.showModal()
  else {
    const evt = new CustomEvent('vplayer:open-url-dialog')
    document.dispatchEvent(evt)
  }
}