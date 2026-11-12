import React, { useCallback, useEffect, useRef, useState } from 'react'
import { usePlayer } from '../context/PlayerContext'
import { formatTime } from '../utils/format'

// 极简播放器：<video> + 自定义控制条；原生/网址/转码三路 src 由 context 的 route 驱动
export default function Player() {
  const { media, mode, playbackSrc, t, onPlay, onPause, onNativeError, startTranscode, prevFile, nextFile, files, playFile } = usePlayer()
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const controlsTimer = useRef(null)

  // 路由驱动：挂载/切换 <video> src
  useEffect(() => {
    const v = videoRef.current
    if (!v || !media) return
    if (media.route === 'native' || media.route === 'url' || media.route === 'transcode') {
      v.src = media.url
      v.load()
      const p = v.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } else if (media.route === 'transcode-pending') {
      startTranscode(media)
    }
  }, [media, playbackSrc && playbackSrc.token, startTranscode])

  // 转码流在文件增长中可能提前触发 error：短暂重试直到转码结束
  useEffect(() => {
    if (media && media.route === 'transcode' && mode === 'error') {
      const timer = setTimeout(() => {
        const v = videoRef.current
        if (v) { v.load(); const p = v.play(); if (p && p.catch) p.catch(() => {}) }
      }, 900)
      return () => clearTimeout(timer)
    }
  }, [media, mode])

  const showControlsBriefly = useCallback(() => {
    setShowControls(true)
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    controlsTimer.current = setTimeout(() => setShowControls(false), 2600)
  }, [])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}) }
    else v.pause()
  }

  function seek(e) {
    const v = videoRef.current
    if (!v || !dur) return
    v.currentTime = Number(e.target.value)
    setCur(v.currentTime)
  }

  function toggleFullscreen() {
    const el = videoRef.current
    if (!el) return
    if (!document.fullscreenElement) el.requestFullscreen().then(() => setFullscreen(true)).catch(() => {})
    else document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {})
  }

  function onRate(r) { setRate(r); if (videoRef.current) videoRef.current.playbackRate = r }

  const canPrev = files && files.length > 1
  const canNext = canPrev

  return (
    <div className="relative h-full w-full bg-black"
      onMouseMove={showControlsBriefly}
      onMouseLeave={() => setShowControls(false)}
      onClick={() => togglePlay()}>

      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        onClick={togglePlay}
        onPlay={() => { setPlaying(true); onPlay() }}
        onPause={() => { setPlaying(false); onPause() }}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onError={() => { if (media && media.route === 'native') onNativeError(media) }}
        onVolumeChange={(e) => { setMuted(e.currentTarget.muted); setVolume(e.currentTarget.volume) }}
      />

      {/* 顶部标题 */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-4 py-3 text-sm text-white transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <span className="truncate font-medium">{media && media.title}</span>
        {canPrev && (
          <span className="flex items-center gap-1 text-neutral-300">
            <button className="pointer-events-auto rounded p-1 hover:bg-white/20" title={t('prev')} onClick={(e) => { e.stopPropagation(); prevFile() }}>⏮</button>
            <button className="pointer-events-auto rounded p-1 hover:bg-white/20" title={t('next')} onClick={(e) => { e.stopPropagation(); nextFile() }}>⏭</button>
          </span>
        )}
        <span className="ml-auto text-xs text-neutral-300">{t('playing')}</span>
      </div>

      {/* 中央播放/暂停 */}
      <button
        className={`absolute inset-0 z-10 flex items-center justify-center text-white/90 transition-opacity ${showControls && !playing ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={(e) => { e.stopPropagation(); togglePlay() }}>
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-3xl backdrop-blur">▶</span>
      </button>

      {/* 底部控制条 */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}
        onClick={(e) => e.stopPropagation()}>

        <input type="range" min={0} max={dur || 0} step={0.1} value={cur}
          onChange={seek} className="vp-controls h-1 w-full cursor-pointer" />

        <div className="mt-2 flex items-center gap-3 text-sm text-white">
          <button onClick={togglePlay} className="rounded p-1 hover:bg-white/20">{playing ? '⏸' : '▶'}</button>
          <button onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setMuted(v.muted) } }} className="rounded p-1 hover:bg-white/20" title={t(muted ? 'unmute' : 'mute')}>
            {muted ? '🔇' : volume === 0 ? '🔇' : '🔊'}
          </button>
          <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
            onChange={(e) => { const v = videoRef.current; if (v) { v.volume = Number(e.target.value); v.muted = Number(e.target.value) === 0; setVolume(Number(e.target.value)) } }}
            className="vp-controls w-16" />
          <span className="tabular-nums text-neutral-200">{formatTime(cur)} / {formatTime(dur)}</span>

          <div className="ml-auto flex items-center gap-2">
            <select value={rate} onChange={(e) => onRate(Number(e.target.value))} className="rounded bg-black/30 px-1 py-0.5 text-xs text-white" title={t('speed')}>
              {[0.5, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}x</option>)}
            </select>
            <button onClick={toggleFullscreen} className="rounded p-1 hover:bg-white/20" title={t(fullscreen ? 'exitFullscreen' : 'fullscreen')}>
              {fullscreen ? '⤡' : '⤢'}
            </button>
          </div>
        </div>
      </div>

      {/* 播放列表抽屉（本地多文件） */}
      {files && files.length > 1 && (
        <div className="absolute right-0 top-1/2 z-30 hidden w-52 -translate-y-1/2 flex-col rounded-l-lg border border-neutral-700 bg-neutral-900/90 backdrop-blur md:flex">
          <div className="border-b border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300">{t('openLocal')}</div>
          <div className="max-h-72 overflow-y-auto">
            {files.map((f, i) => (
              <button key={f.path + i} onClick={() => playFile(f.path)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${media && media.inputPath === f.path ? 'bg-sky-600/20 text-sky-300' : 'text-neutral-300 hover:bg-neutral-800'}`}>
                <span>▶</span>
                <span className="truncate">{f.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}