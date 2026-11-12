# VPlayer v0.1.0 审查请求（交第三方智能体 workbuddy 审查）

> 生成时间：2026-11-12
> 审查对象：当前工作树（`/home/zhengyz/文档/Vplayer`，尚未 git init/提交）
> 审查重点：安全（IPC / 组件安装 / SMB 凭据 / 升级）、流媒体正确性、跨平台一致性

## 一、交付内容概览

极简视频播放器 v0.1.0，Electron 33 + React 18 + Vite 6 + Tailwind 3。能力：
- **三源播放**：本地文件 / 网址(http/https) / 局域网 SMB（`smb2` 纯 JS + 本地 HTTP Range 流媒体服务器）。
- **原生优先**：MP4/WebM/MOV/Ogg 由 Chromium 直播，零依赖。
- **可选编解码组件**（ffmpeg）：MKV/AVI/WMV/FLV/TS 按需安装转码为 fMP4 渐进播放。
- **中英双语**（零依赖 i18n）。
- **差量升级**：Windows electron-updater blockmap 差量；Linux deb 镜像全量+sha256；macOS 手动。
- 播放列表、最近播放、倍速/全屏/音量等。

## 二、关键模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 主进程 | electron/main.cjs | 单实例/文件关联/外链白名单/IPC |
| 流媒体服务器 | electron/stream-server.cjs | 本地 HTTP Range；统一 file/SMB/转码三源 |
| SMB | electron/smb.cjs | smb2 浏览 + 持久 fd Range 读取 + safeStorage 凭据 |
| 编解码组件 | electron/codec-component.cjs | ffmpeg 组件安装/卸载/转码会话（zip 解包+CRC32+白名单） |
| 差量升级 | electron/updater.cjs | 检查/差量下载/镜像轮询/sha256/安装 |
| 渲染层 | src/context/PlayerContext.jsx 等 | 播放路由（原生/待转码/转码流）、UI |

## 三、重点复核项（请逐条给结论）

1. **安全：IPC 是否接受渲染层传入的任意路径/命令？**
   升级（updater.cjs）与组件安装（codec-component.cjs）是否全部由主进程记账，渲染层无法指定目标路径/命令文本？

2. **流媒体服务器（stream-server.cjs）是否只监听 127.0.0.1，Range 处理是否正确（206/416、Content-Range、越界防护、增长文件 stat 为 0 时的降级）？**

3. **编解码组件 zip 解包（codec-component.cjs 的 unzipComponent）：白名单、CRC32、inflate 输出上限、体积上限、路径越界是否到位？转码会话的临时文件（TMP_DIR）是否会被长期残留？**

4. **SMB 凭据（smb.cjs）：safeStorage 不可用时的明文落盘兜底是否可接受？持久 fd 的回收逻辑是否安全？**

5. **差量升级（updater.cjs）：Windows electron-updater 差量的 sha512 校验、镜像的大小交叉核对；Linux deb 的 sha256 校验是否存在绕过？**

6. **转码渐进播放：ffmpeg 输出 fMP4 由 stream-server 以"增长中"文件供 <video>，首次 Range 在 0 字节时的处理（stat 返回 0 会不会导致播放器死循环重试？）**

7. **跨平台：文件关联扩展名清单、macOS 标题栏/窗口、Windows/Linux 的 --no-sandbox 处理是否一致？**

## 四、本机已验证

- 冒烟 `npm run smoke`：28/28 通过（L1 静态 + L2 逻辑 + L4 Electron 集成，渲染层无未捕获错误）。
- Linux deb 打包成功（`release/vplayer_0.1.0_amd64.deb`，68.9MB），打包版应用可正常启动。
- 编解码组件打包成功（`VPlayer-codec-0.1.0-linux.zip`，28.6MB，含 sha256）。
- 转码链路端到端验证：ffmpeg 生成 MKV → 转 fMP4 可正常解码。

## 五、已知限制 / 待验证（不阻塞本机构建）

| 编号 | 说明 |
|------|------|
| V-001 | 三平台真机未验证（本机仅 Linux）；Windows 差量/macOS 手动需真机确认 |
| V-002 | 转码渐进播放的"实时流畅度"未在真实 UI 中实测（转码本身已验证可用） |
| V-003 | SMB 真实共享（Windows 主机）流式播放与 Range 未实测 |
| V-101 | URL(m3u8/HLS) 播放取决于源站 CORS，未实测 |
| R-101~R-105 | 见 docs/TASKS.md（播放列表窄屏、组件安装进度条、SMB 续播等） |

## 六、交付物

- 源码（当前工作树）
- 文档：docs/STATE.md（8 条决策）、docs/TASKS.md（12 条问题）、docs/操作手册.md、docs/smoke/README.md、README.md / README.en-US.md、DEVLOG.md
- CI：.github/workflows/release.yml（三平台 + 每平台 codec 组件）、ci.yml
- 构建产物：release/vplayer_0.1.0_amd64.deb、release/VPlayer-codec-0.1.0-linux.zip(.sha256)

> 说明：项目尚未 git init/提交。请重点复核上述 7 项后给出结论与修复建议。