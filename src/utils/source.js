// src/utils/source.js —— 来源路由：哪些格式原生可播、哪些需转码、扩展名判断
// Chromium 原生可解码：H.264/AAC (mp4/mov/m4v)、VP8/VP9/AV1+Opus (webm)、Theora (ogg/ogv)
export const NATIVE_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.ogg', '.ogv'])
// 常见但 Chromium 原生不支持的容器（需要 ffmpeg 转码）
export const TRANSCODE_EXT = new Set(['.mkv', '.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mpg', '.mpeg', '.rmvb', '.3gp'])
// 纯音频（可用 <audio> 或 <video> 播放，这里统一进 video 也可行）
export const AUDIO_EXT = new Set(['.mp3', '.aac', '.flac', '.wav', '.ogg', '.m4a'])

export function extOf(name) {
  const s = String(name || '').toLowerCase()
  const i = s.lastIndexOf('.')
  return i >= 0 ? s.slice(i) : ''
}

export function needsTranscode(name) {
  const ext = extOf(name)
  if (TRANSCODE_EXT.has(ext)) return true
  // 虽为原生容器扩展名，但可能内嵌 AC3/EAC3 等 Chromium 不支持的音轨——返回 unknown，
  // 让"原生播放失败→转码兜底"流程接管
  return false
}

export function isNativeExt(ext) {
  return NATIVE_EXT.has(ext)
}

export function isVideoExt(ext) {
  return NATIVE_EXT.has(ext) || TRANSCODE_EXT.has(ext)
}

// 判断 SMB 目录项是否为可播放视频
export function isPlayableVideo(name) {
  const ext = extOf(name)
  return isVideoExt(ext)
}