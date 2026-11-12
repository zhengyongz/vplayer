const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerUpdater } = require('./updater.cjs')
const { registerStreamServer } = require('./stream-server.cjs')
const { registerSmb } = require('./smb.cjs')
const { registerCodecComponent } = require('./codec-component.cjs')

// GPU 兼容性开关（--no-sandbox 由 CLI 传入：electron:dev 脚本与 .desktop executableArgs，
// 用于 Ubuntu 24.04 AppArmor 拦截 user namespace 的环境；正式 deb 由 postinst 处理 chrome-sandbox SUID）
app.commandLine.appendSwitch('disable-gpu-sandbox')

// ---------- 文件关联：双击/打开方式传入的视频文件路径 ----------
const SUPPORTED_EXT = [
  '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v',
  '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.m2ts', '.ogv',
]
function extractFilePathFromArgv(argv) {
  for (const arg of argv) {
    if (arg.startsWith('-')) continue
    if (arg.endsWith('.js') || arg.endsWith('.cjs')) continue
    const lower = arg.toLowerCase()
    if (SUPPORTED_EXT.some((ext) => lower.endsWith(ext))) return arg
  }
  return null
}

let pendingFilePath = null
const initialFile = extractFilePathFromArgv(process.argv)
if (initialFile) pendingFilePath = initialFile

// 单实例：后续双击文件时把路径传给已有实例，避免开两个窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const f = extractFilePathFromArgv(argv)
    if (f) {
      pendingFilePath = f
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
        notifyRenderer()
      }
    }
  })
}

let mainWindow = null
function notifyRenderer() {
  if (!mainWindow || mainWindow.isDestroyed() || pendingFilePath == null) return
  mainWindow.webContents.send('vplayer:open-file-changed')
}

// macOS open-file 事件（模块顶层注册：macOS 双击文件启动时该事件早于 whenReady 触发）
app.on('open-file', (e, filePath) => {
  e.preventDefault()
  const lower = filePath.toLowerCase()
  if (SUPPORTED_EXT.some((ext) => lower.endsWith(ext))) {
    pendingFilePath = filePath
    if (mainWindow) notifyRenderer()
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: '极简视频播放器',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    // macOS 平台风格：标题栏并入界面（保留红绿灯按钮）
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#111111',
    } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  // 安全加固：拦截新窗口，用外部浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 安全加固：阻止页面内导航到外部 URL
  win.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  Menu.setApplicationMenu(null)

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

// IPC：当前应用版本号
ipcMain.handle('app:get-version', () => app.getVersion())

// IPC：用系统默认浏览器打开外链（仅放行 http/https）
ipcMain.handle('vplayer:open-external', (_e, url) => {
  const u = typeof url === 'string' ? url : ''
  if (/^https?:\/\//i.test(u)) {
    shell.openExternal(u)
    return true
  }
  return false
})

// IPC：renderer 拉取待打开文件路径（消费后清空）
ipcMain.handle('vplayer:get-open-file', () => {
  if (pendingFilePath == null) return null
  const p = pendingFilePath
  pendingFilePath = null
  return { path: p, name: path.basename(p) }
})

// IPC：用系统文件选择器打开视频文件（返回选中路径数组）
ipcMain.handle('vplayer:open-dialog', async () => {
  const { dialog } = require('electron')
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '视频文件', extensions: SUPPORTED_EXT.map((e) => e.slice(1)) },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  return canceled ? [] : filePaths
})

app.whenReady().then(() => {
  mainWindow = createWindow()

  if (pendingFilePath) notifyRenderer()

  // 本地 HTTP 流媒体服务器（本地文件 + SMB Range 读取 + 转码渐进流）
  registerStreamServer()
  // SMB 浏览与流式读取
  registerSmb()
  // 可选编解码组件（ffmpeg 转码）：状态检测/应用内安装/卸载/转码会话
  registerCodecComponent()
  // 差量升级模块：注册 IPC（检查/下载/打开安装包）+ 启动 3 秒后静默检查
  registerUpdater()

  // 冒烟测试模式（VPLAYER_SMOKE=1，仅源码环境）
  if (process.env.VPLAYER_SMOKE === '1' && !app.isPackaged) {
    mainWindow.webContents.on('console-message', (_e, _level, message) => {
      console.log('[renderer]', message)
    })
    setTimeout(async () => {
      const work = mainWindow.webContents
      try {
        const img = await work.capturePage()
        const out = path.join(app.getPath('temp'), 'vplayer-smoke.png')
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, img.toPNG())
        console.log('[smoke] 截图已保存:', out)
      } catch (e) {
        console.log('[smoke] 截图失败:', e.message)
      }
      console.log('[smoke] 完成，正常退出')
      app.quit()
    }, 6000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

module.exports = { SUPPORTED_EXT }