# VPlayer 开发记录（DEVLOG.md）

> 版本技术说明与开发流水。最新在顶部。

## v0.1.0 · 2026-11-12 · 立项首版

**形态**：极简视频播放器（Electron 33 + React 18 + Vite 6 + Tailwind 3）。

**能力**：
- 三源播放：本地文件 / 网址 (http/https) / 局域网 SMB（smb2 纯 JS + 本地 HTTP Range 流式）。
- 原生优先：MP4/WebM/MOV/Ogg 由 Chromium 直接播放，零依赖。
- 可选编解码组件（ffmpeg）：MKV/AVI/WMV/FLV/TS 等按需安装后转码为 fMP4 渐进播放；主包保持轻量。
- 中英双语 i18n（零依赖手写字典）。
- 差量升级：Windows electron-updater blockmap（真差量）；Linux deb 镜像全量+sha256；macOS 手动。
- 播放列表（本地多文件）、最近播放、全屏/倍速/音量/静音。

**架构**：见 `docs/STATE.md`（D-001~D-008）。
**冒烟**：28 项全过（L1 静态 + L2 逻辑 + L4 Electron 集成）。

**待验**（V-001~V-003）：三平台真机、转码流畅度、SMB 真实服务器。

## 参考

- 开发流程沿用 DocLite：`npm run handoff` 交接、`npm run smoke` 验证、`npm run verify` 体检、发版前交第三方审查。