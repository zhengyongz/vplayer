import React from 'react'
import { usePlayer } from '../context/PlayerContext'

// 浮层：加载中 / 转码中 / 错误（含编解码组件安装引导）
export default function Overlay() {
  const { mode, media, errorInfo, transcode, codecStatus, installCodec, uninstallCodec, startTranscode, t } = usePlayer()

  if (!media) return null

  // 转码中
  if (mode === 'transcoding' || (media.route === 'transcode' && mode === 'loading')) {
    const secs = transcode ? transcode.seconds : 0
    const installing = transcode && transcode.installing
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur">
        {installing ? (
          <>
            <Spinner />
            <p className="text-sm text-neutral-200">{t('codecInstalling')}</p>
          </>
        ) : (
          <>
            <Spinner />
            <p className="text-sm text-neutral-200">{t('transcoding')}…</p>
            <p className="text-xs tabular-nums text-neutral-400">{secs}s</p>
          </>
        )}
      </div>
    )
  }

  // 错误
  if (mode === 'error' && errorInfo) {
    const offerCodec = errorInfo.offer === 'codec'
    return (
      <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/50 px-6 text-center">
        <div className="text-4xl">😕</div>
        <p className="max-w-md text-sm text-neutral-200">{errorInfo.message}</p>
        {offerCodec && (
          <div className="flex flex-col items-center gap-2">
            {codecStatus && codecStatus.installed ? (
              <button onClick={() => startTranscode(errorInfo.media)}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500">
                {t('transcodeRetry')}
              </button>
            ) : (
              <button onClick={installCodec}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500">
                {t('installCodec')}
              </button>
            )}
            {codecStatus && codecStatus.installed && (
              <p className="text-xs text-neutral-400">{t('codecInstalled')}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  // 加载中
  if (mode === 'loading') {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30">
        <Spinner />
      </div>
    )
  }

  return null
}

function Spinner() {
  return (
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-500 border-t-sky-400" />
  )
}