// src/context/PlayerContext.jsx — 全局播放状态：来源路由（原生/转码）、最近播放、语言、升级/编解码状态
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { t as translate } from '../i18n'
import { extOf } from '../utils/source'

const PlayerContext = createContext(null)
const RECENT_KEY = 'vplayer:recent'
const LANG_KEY = 'vplayer:lang'

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || [] } catch { return [] }
}
function loadLang() {
  try { return localStorage.getItem(LANG_KEY) || (navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en') } catch { return 'zh' }
}

export function PlayerProvider({ children }) {
  const [lang, setLangState] = useState(loadLang)
  const [media, setMedia] = useState(null) // { type, title, url, inputPath, route }
  const [mode, setMode] = useState('idle') // idle|loading|playing|paused|transcoding|error
  const [errorInfo, setErrorInfo] = useState(null)
  const [recent, setRecent] = useState(loadRecent)
  const [files, setFiles] = useState(null) // 本地播放列表 [{path,title}]
  const [codecStatus, setCodecStatus] = useState(null)
  const [transcode, setTranscode] = useState(null) // { id, seconds, installing }
  const [update, setUpdate] = useState(null)
  const mediaToken = useRef(0)

  const setLang = useCallback((l) => { setLangState(l); localStorage.setItem(LANG_KEY, l) }, [])

  const pushRecent = useCallback((entry) => {
    setRecent((prev) => {
      const next = [entry, ...prev.filter((p) => p.path !== entry.path || p.url !== entry.url)].slice(0, 12)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

const routeFor = useCallback((title) => {
    const ext = extOf(title)
    // .mkv/.avi/.wmv/.flv/.ts 等容器 Chromium 一律不播，标记为"待转码"；其余交给原生
    return { '.mkv': 'transcode-pending', '.avi': 'transcode-pending', '.wmv': 'transcode-pending', '.flv': 'transcode-pending',
      '.ts': 'transcode-pending', '.m2ts': 'transcode-pending', '.mpg': 'transcode-pending', '.mpeg': 'transcode-pending',
      '.rmvb': 'transcode-pending', '.3gp': 'transcode-pending' }[ext] || 'native'
  }, [])

  // ---------- 打开本地文件（支持多选 → 播放列表） ----------
  const playFile = useCallback(async (filePath) => {
    const r = await window.vplayer.registerFileSource(filePath)
    if (!r.ok) { setMode('error'); setErrorInfo({ message: r.error }); return }
    const title = filePath.split(/[\\/]/).pop()
    const item = { type: 'file', title, url: r.url, inputPath: filePath, route: routeFor(title) }
    setMedia(item); setMode('loading'); mediaToken.current += 1
    pushRecent({ key: filePath, title, kind: 'local' })
    return item
  }, [pushRecent, routeFor])

  const openFiles = useCallback(async (paths) => {
    if (!paths || !paths.length) return
    setFiles(paths.map((p) => ({ path: p, title: p.split(/[\\/]/).pop() })))
    await playFile(paths[0])
    return
  }, [playFile])

  const prevFile = useCallback(() => {
    setFiles((prevFiles) => {
      if (!prevFiles || prevFiles.length < 2 || !media) return prevFiles
      const idx = prevFiles.findIndex((f) => f.path === media.inputPath)
      const target = prevFiles[(idx - 1 + prevFiles.length) % prevFiles.length]
      playFile(target.path)
      return prevFiles
    })
  }, [media, playFile])

  const nextFile = useCallback(() => {
    setFiles((prevFiles) => {
      if (!prevFiles || prevFiles.length < 2 || !media) return prevFiles
      const idx = prevFiles.findIndex((f) => f.path === media.inputPath)
      const target = prevFiles[(idx + 1) % prevFiles.length]
      playFile(target.path)
      return prevFiles
    })
  }, [media, playFile])

  // ---------- 打开网址 ----------
  const openUrl = useCallback((url) => {
    const item = { type: 'url', title: url, url, inputPath: url, route: 'url' }
    setMedia(item); setMode('loading'); mediaToken.current += 1
    pushRecent({ key: url, title: url, kind: 'url' })
    return item
  }, [pushRecent])

  // ---------- 打开 SMB 文件 ----------
  const openSmb = useCallback(async (smbItem) => {
    const r = await window.vplayer.smbRegisterVideo(smbItem.path)
    if (!r.ok) { setMode('error'); setErrorInfo({ message: r.error }); return null }
    const item = { type: 'smb', title: smbItem.name, url: r.url, inputPath: r.url, smbPath: smbItem.path, route: routeFor(smbItem.name) }
    setMedia(item); setMode('loading'); mediaToken.current += 1
    pushRecent({ key: smbItem.path, title: smbItem.name, kind: 'smb' })
    return item
  }, [pushRecent, routeFor])

  // 播放器 <video> 应加载的 src（token 用于强制 reload）
  const playbackSrc = useMemo(() => (media ? { src: media.url, token: mediaToken.current } : null), [media, mediaToken])

  // 原生解码失败 → 标记为待转码（Player effect 走转码路径；组件未装则提示安装）
  const onNativeError = useCallback((mediaRef) => {
    if (!mediaRef || mediaRef.route === 'transcode-pending' || mediaRef.route === 'transcode') return
    setMedia((prev) => ({ ...prev, route: 'transcode-pending' }))
    mediaToken.current += 1
  }, [])

  // 转码：以组件是否就绪分流（输入可为本地路径或 SMB 的 http 流）
  const startTranscode = useCallback(async (mediaRef) => {
    if (!mediaRef) return
    const st = codecStatus || (await window.vplayer.getCodecStatus())
    if (!st || !st.installed) {
      setMode('error'); setErrorInfo({ message: translate(lang, 'errorUseCodec'), offer: 'codec', media: mediaRef })
      return
    }
    setMode('transcoding'); setTranscode({ id: null, seconds: 0, installing: false })
    const r = await window.vplayer.transcodeSource(mediaRef.inputPath)
    if (!r.ok) { setMode('error'); setErrorInfo({ message: r.error, media: mediaRef }); return }
    setTranscode({ id: r.id, seconds: 0, installing: false })
    setMedia((prev) => ({ ...prev, url: r.url, route: 'transcode', inputPath: mediaRef.inputPath }))
    mediaToken.current += 1
  }, [codecStatus, lang])

  // 编解码组件状态 + 进度订阅
  useEffect(() => {
    window.vplayer.getCodecStatus().then(setCodecStatus)
    const off = window.vplayer.onCodecStatus((s) => {
      if (s.type === 'transcode-progress') setTranscode((prev) => prev ? { ...prev, seconds: s.seconds } : prev)
      else if (s.type === 'transcode-end') {
        setTranscode((prev) => prev ? { ...prev, done: true, code: s.code } : prev)
        // 转码结束：如果仍在播放旧流则刷新
        mediaToken.current += 1
      }
    })
    return off
  }, [])

  const installCodec = useCallback(async () => {
    setTranscode((prev) => ({ ...prev, installing: true }))
    const r = await window.vplayer.installCodec()
    const st = await window.vplayer.getCodecStatus()
    setCodecStatus(st)
    setTranscode((prev) => ({ ...prev, installing: false }))
    // 安装完成后自动续播待转码项
    if (r.ok && st.installed && errorInfo && errorInfo.media) startTranscode(errorInfo.media)
    return r
  }, [errorInfo, startTranscode])

  const uninstallCodec = useCallback(async () => {
    await window.vplayer.uninstallCodec()
    setCodecStatus(await window.vplayer.getCodecStatus())
  }, [])

  // 升级状态订阅
  useEffect(() => {
    const off = window.vplayer.onUpdateStatus((s) => setUpdate(s))
    return off
  }, [])

  const value = useMemo(() => ({
    lang, setLang, t: (k) => translate(lang, k),
    media, mode, setMode, errorInfo, setErrorInfo,
recent, files, openFiles, openUrl, openSmb, pushRecent, prevFile, nextFile, playFile,
    playbackSrc, onPlay: () => setMode('playing'), onPause: () => setMode('paused'), onNativeError,
    codecStatus, installCodec, uninstallCodec, startTranscode,
    transcode, update, setUpdate,
}),
  [lang, media, mode, errorInfo, recent, files, openFiles, openUrl, openSmb, pushRecent, prevFile, nextFile, playFile, playbackSrc, onNativeError, codecStatus, installCodec, uninstallCodec, startTranscode, transcode, update])

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  return useContext(PlayerContext)
}