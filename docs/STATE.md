# VPlayer 决策台账（STATE.md）

> 记录 VPlayer 的架构决策与理由。**改动前必读**，不要推翻历史条目；需调整时追加新决策并标注「废止 D-xxx」。

## 一、架构与技术栈

### D-001 · 2026-11-12 · Electron 33 + React 18 + Vite 6 + Tailwind 3
沿用 DocLite 同栈（已被验证的成熟组合），electron-builder 25 打包三平台。主进程 CommonJS（.cjs），渲染层 ESM。

### D-002 · 2026-11-12 · 播放路由：原生优先 + 可选转码兜底
Chromium `<video>` 原生可播 H.264/AAC (mp4/mov/m4v)、VP8/VP9/AV1 (webm)、Opus (ogg)。**主流格式里 MP4/WebM 直接原生播放，零依赖**；MKV/AVI/WMV/FLV/TS 等容器 Chromium 一律不播，走 ffmpeg 转码。路由由扩展名判定（`src/utils/source.js`），原生失败（如 mp4 内嵌 AC3 音轨）也回落转码。

### D-003 · 2026-11-12 · 本地 HTTP 流媒体服务器（Range）统一三源
本地文件、SMB 远程文件、转码渐进流三种来源，统一抽象成带 Range 的 HTTP 源（`electron/stream-server.cjs`），供 `<video>` 播放与拖拽 seek。理由：SMB 无 file://、转码流是增长文件，Range 是唯一通用接口；仅监听 127.0.0.1 随机端口。

### D-004 · 2026-11-12 · 编解码组件为可选按需安装（沿用 DocLite 组件机制）
主包保持轻量（~几 MB），ffmpeg 二进制（~80MB）作为**可选组件**，首次播放 MKV 等时应用内下载安装到 `userData/codec`。主进程全程处理：定位资产→镜像下载→sha256 校验→最小 zip 解包（CRC32+白名单+体积上限）→原子写盘。跨平台组件包按平台命名 `VPlayer-codec-<v>-<platform>.zip`。

### D-005 · 2026-11-12 · SMB 用纯 JS `smb2` 客户端（复用其底层 Forge 做流式）
`smb2`（node-smb2 0.2.11）公开 API 只支持整文件 readFile，无法做视频流式播放；但它内部暴露 `SMB2Forge.request`（open/read/close/query_directory），`read` 支持 Offset/Length、`query_directory` 返回文件类型与大小。本模块**复用其协议实现**自行封装：connect（readdir 触发握手 + 8s 超时 + 明确错误）、list（query_directory 解析类型/大小）、streamRead（open→read(offset,length)→close 按 Range 拉取），从而对 SMB 视频做流式播放。凭据经 `safeStorage` 加密落盘。

### D-006 · 2026-11-12 · 差量升级策略（按平台）
- **Windows**：`electron-updater` blockmap 分块对比——只下载与上一版不同的部分，是真正差量。
- **Linux deb**：镜像加速全量 + sha256 校验（deb 无官方差量通道）。
- **macOS**：无 Developer ID 签名时自动更新被 Gatekeeper 阻止，一期仅引导手动下载 DMG。
镜像源：官方→ghfast.top→gh-proxy.com→ghproxy.net 轮询（大陆网络加速）。

### D-007 · 2026-11-12 · 中英双语零依赖 i18n
手写 `src/i18n/index.js` 字典（zh/en），`t(key)` 查询，避免引入 i18next。所有用户可见文案走 t()。

### D-008 · 2026-11-12 · 安全基线（沿用 DocLite 审查沉淀）
contextIsolation + sandbox + 无 nodeIntegration；IPC 不接受渲染层传入的路径/命令（升级/组件由主进程记账）；外链仅放行 http/https；CSP 收紧 media/img/connect-src。

## 二、关键实现说明

### 转码渐进播放
ffmpeg 输出 fMP4（`frag_keyframe+empty_moov`），写临时文件并以"增长中"方式由 stream-server 供 `<video>` 渐进播放；`-progress` 解析秒数推进度。SMB 转码：把 SMB 源注册为本地 http 流，ffmpeg 直接读该 http URL 作为输入，避免整文件下载。

### 播放列表
本地多选形成播放列表，`files` 状态 + 上/下切换（prevFile/nextFile）；播放列表抽屉在 md+ 屏显示。

## 待拍板事项（Q 区）

| Q | 问题 | 影响 | 建议 |
|---|------|------|------|
| Q-001 | Linux deb 是否也做差量（自研 blockmap 对齐） | 升级体积 | 一期全量，二期评估 |
| Q-002 | macOS 是否购买 Developer ID 开启自动更新 | 差量在 mac 的可用性 | 有预算再评估 |
| Q-003 | 是否需要字幕/音轨切换 | 播放体验 | 二期功能 |

## 历史决策归档

### D-009 · 2026-11-14 · NTLM 认证用纯 JS 补丁（OpenSSL3 兼容）
Node 24 + OpenSSL 3 默认禁用 legacy 的 **MD4** 与 **DES**，而 smb2 依赖的 ntlm 库两者都用 → 连接时 `session_setup` 崩溃、UI 卡死。修复：给 ntlm 打补丁（`patches/ntlm+0.1.3.patch`，经 patch-package 固化，postinstall 自动应用）：NT hash 用 `js-md4` 纯 JS（`JS_MD4_NO_NODE_JS` 强制 JS 模式）、NTLM 响应用自写纯 JS DES（FIPS 46-3，官方 vector 验证）、LM 发全零、domain 兜底空串。**跨平台、不依赖运行时 legacy flags**。约束：开发时勿直接改 node_modules（用 patch-package 维护补丁）。

（v0.1.0 首版，暂无废止条目）