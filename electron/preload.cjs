// preload：在 contextIsolation 下向 renderer 暴露最小 API（文件/网址/SMB 播放 + 差量升级 + 编解码组件）
// 安全说明：升级与组件相关 IPC 均不接受渲染层传入路径/命令（由主进程记账），详见各模块
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('vplayer', {
  // 平台标识（渲染层 UI 分流：darwin/win32/linux）
  platform: process.platform,

  // ---------- 文件打开 ----------
  // 拉取启动参数中待打开的视频文件路径（返回 { path, name } 或 null）
  getOpenFile: () => ipcRenderer.invoke('vplayer:get-open-file'),
  onOpenFileChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('vplayer:open-file-changed', listener)
    return () => ipcRenderer.removeListener('vplayer:open-file-changed', listener)
  },
  // 系统文件选择器（返回路径数组）
  openDialog: () => ipcRenderer.invoke('vplayer:open-dialog'),
  // 用系统浏览器打开 http/https 外链
  openExternal: (url) => ipcRenderer.invoke('vplayer:open-external', url),

  // ---------- 流媒体服务器（本地文件 / SMB / 转码 统一走本地 HTTP Range） ----------
  // 注册本地视频为流媒体源，返回 { id, url }
  registerFileSource: (filePath) => ipcRenderer.invoke('stream:register-file', filePath),
  unregisterSource: (id) => ipcRenderer.invoke('stream:unregister', id),

  // ---------- SMB ----------
  // 连接 SMB 服务器（返回 { ok, error }；凭据经 safeStorage 加密存储）
  smbConnect: (opts) => ipcRenderer.invoke('smb:connect', opts),
  smbDisconnect: () => ipcRenderer.invoke('smb:disconnect'),
  // 列出共享根 / 目录内容（返回 [{ name, isDir, size }]）
  smbList: (pathStr) => ipcRenderer.invoke('smb:list', pathStr),
  // 注册 SMB 视频为流媒体源（返回 { id, url }）
  smbRegisterVideo: (pathStr, opts) => ipcRenderer.invoke('smb:register-video', pathStr, opts),
  smbIsConnected: () => ipcRenderer.invoke('smb:is-connected'),

  // ---------- 可选编解码组件（ffmpeg 转码） ----------
  getCodecStatus: () => ipcRenderer.invoke('codec:get-status'),
  installCodec: () => ipcRenderer.invoke('codec:install'),
  uninstallCodec: () => ipcRenderer.invoke('codec:uninstall'),
  // 创建转码会话：返回 { id, url }，转码进度/完成/错误经 onCodecStatus 推送
  transcodeSource: (sourcePath) => ipcRenderer.invoke('codec:transcode', sourcePath),
  cancelTranscode: (id) => ipcRenderer.invoke('codec:cancel', id),
  onCodecStatus: (cb) => {
    const listener = (_e, status) => cb(status)
    ipcRenderer.on('codec:status', listener)
    return () => ipcRenderer.removeListener('codec:status', listener)
  },

  // ---------- 差量升级 ----------
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  startDownload: () => ipcRenderer.invoke('updater:download'),
  copyInstallCmd: () => ipcRenderer.invoke('updater:copy-install-cmd'),
  openInstaller: () => ipcRenderer.invoke('updater:open-installer'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  relaunchApp: () => ipcRenderer.invoke('updater:relaunch'),
  onUpdateStatus: (cb) => {
    const listener = (_e, status) => cb(status)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  },
})