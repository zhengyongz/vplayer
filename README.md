---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '87687e79-0b49-4c94-a418-9931ed01e3f6'
  PropagateID: '87687e79-0b49-4c94-a418-9931ed01e3f6'
  ReservedCode1: '057be41d-0b79-40e4-8caf-ef5db565251e'
  ReservedCode2: '057be41d-0b79-40e4-8caf-ef5db565251e'
---

# 极简视频播放器 (VPlayer)

> [English](README.en-US.md) | 中文
>
> 本自述为中文维护版；英文说明见 [README.en-US.md](./README.en-US.md)。

一个极简的 Electron 桌面视频播放器，**本地播放与处理均在本机完成，不上传任何服务器**。支持本地文件、网址、局域网 SMB 共享三种来源，中英双语界面，带**差量升级**。

## 功能特性

### 播放来源

| 来源 | 方式 |
|------|------|
| 本地文件 | 拖拽 / 点击打开 / 文件关联双击（MP4/MKV/WebM/AVI/MOV/M4V/WMV/FLV/TS 等） |
| 网址 | 粘贴 http/https 视频地址（含 m3u8/HLS，取决于源站 CORS） |
| 局域网 SMB | 内置浏览共享 → 点视频即播（凭据 safeStorage 加密保存，可选） |

### 格式与编解码

- **原生优先**：MP4 (H.264/AAC)、WebM (VP8/VP9/AV1)、MOV、OGG 由 Chromium 直接播放，**零依赖**。
- **可选编解码组件**：MKV/AVI/WMV/FLV/TS 等 Chromium 不支持的容器，首次播放时按需下载 ffmpeg 组件（约 80MB，一次）进行**转码渐进播放**；SMB 上的此类文件同样支持（ffmpeg 直读本地 http 流）。

### 其他特性

- 极简播放器 UI：播放/暂停、进度拖拽、音量/静音、倍速、全屏、上一/下一、播放列表、最近播放。
- 中英双语一键切换并记住（首次按系统语言）。
- 单实例运行，二次打开文件传给已有窗口。
- 拖拽文件到窗口直接播放。

### 差量升级

| 平台 | 方式 |
|------|------|
| Windows | electron-updater **blockmap 差量**——只下载与上一版不同的部分 |
| Linux | 镜像加速全量 + sha256 校验（deb 无官方差量通道） |
| macOS | 未签名，引导手动下载 DMG |

大陆网络自动镜像轮询加速（官方→ghfast.top→gh-proxy.com→ghproxy.net）。

## 技术栈

- Electron 33 + React 18 + Vite 6 + Tailwind 3 + electron-builder 25
- smb2（纯 JS SMB 客户端）
- 本地 HTTP Range 流媒体服务器（统一本地/SMB/转码三源）

## 安装与使用

### Linux (deb)

```bash
sudo dpkg -i vplayer_0.1.0_amd64.deb
vplayer   # 或从应用菜单启动
```

### Windows (NSIS)

下载 `VPlayer-x.x.x-Setup.exe` 双击安装即可。

### macOS (dmg)

从 [Release 页面](https://github.com/zhengyongz/vplayer/releases/latest) 下载对应架构的 dmg 拖入「应用程序」。未签名应用首次打开请右键 → 打开确认一次；若提示已损坏，执行 `xattr -cr /Applications/VPlayer.app`。

### 从源码构建

```bash
npm install
npm run electron:dev      # 开发
npm run build             # 构建前端
# Linux: npx electron-builder --linux deb && node build/pack-codec.cjs
# Windows: npx electron-builder --win nsis && node build/pack-codec.cjs
```

**三平台自动构建**：推 `v*` tag 触发 GitHub Actions 产出 macOS（dmg/zip×双架构）、Windows（exe+blockmap）、Linux（deb）及各平台编解码组件 zip，挂到 Release。

## 项目结构

```
vplayer/
├── electron/
│   ├── main.cjs              # 主进程（单实例/文件关联/IPC）
│   ├── preload.cjs           # contextIsolation 桥接
│   ├── stream-server.cjs     # 本地 HTTP Range 流媒体服务器
│   ├── smb.cjs               # SMB 浏览 + 流式读取
│   ├── codec-component.cjs   # 可选 ffmpeg 编解码组件管理 + 转码
│   └── updater.cjs           # 差量升级
├── build/                    # 图标、afterPack、after-install、pack-codec
├── src/
│   ├── context/PlayerContext.jsx  # 播放状态路由（原生/转码）
│   ├── i18n/index.js              # 中英字典（零依赖）
│   ├── utils/{source,format}.js   # 路由与格式化
│   └── components/                # Header/Player/OpenPanel/SmbBrowser/…
├── scripts/                  # smoke/verify/handoff/status
├── docs/                     # STATE/TASKS/操作手册/smoke
└── .github/workflows/        # release.yml / ci.yml
```

## 开发者指南

参与开发前请读这几份文档：

| 文档 | 内容 |
|------|------|
| [docs/操作手册.md](./docs/操作手册.md) | 一页纸操作手册（4 个常用命令） |
| [docs/TASKS.md](./docs/TASKS.md) | 问题清单（唯一事实源，带状态） |
| [docs/STATE.md](./docs/STATE.md) | 决策台账（改动前必读） |
| [docs/smoke/README.md](./docs/smoke/README.md) | 冒烟测试套件说明 |

```bash
npm run handoff    # 生成交接指令包
npm run smoke      # 冒烟测试（改动后必跑）
npm run status     # 查看问题清单
npm run verify     # 发版前体检
```

## 安全说明

- 所有播放与转码完全本地；无后端服务器、无账号体系、无数据收集。
- 凭据用系统 safeStorage 加密存储（仅本机可解）。
- 升级/组件安装由主进程记账，渲染层无法指定任意路径。

## 许可证

[MIT License](./LICENSE)

> AI生成