# VPlayer 开发记录（DEVLOG.md）

> 版本技术说明与开发流水。最新在顶部。

## v0.1.2 · 2026-11-15 · SMB 浏览 INVALID_PARAMETER 修复

**问题**：v0.1.1 认证通过后，列目录报 `STATUS_INVALID_PARAMETER (0xC000000D)`（用户真实服务器复现）。诊断（自制 `scripts/smb-diag.cjs` 分步握手）定位至 ④ tree_connect 全过、⑤ CREATE(open_folder) 拒绝。

**根因**：smb2 库的 CREATE 消息把 `CreateContextsOffset` 写成 `0x7A+名长`（非零），但 `CreateContextsLength` 恒为 0——规范要求无 create contexts 时 offset 必须为 0，Samba/严格实现对非零 offset+零长度直接回 `INVALID_PARAMETER`。tree_connect 等其余消息无此字段，故仅 CREATE 失败。

**定位方法**：变量实验脚本逐项覆盖（A 原版复现 ✗ → B 仅改 `CreateContextsOffset=0` → ✓✓ 列目录成功；C/D/F 变体确认其余参数无碍）。

**修复**：`patches/smb2+0.2.11.patch`（patch-package 固化）——4 个 CREATE 消息（open_folder/open/create/create_folder）的 `CreateContextsOffset` 改为 0。

**验证**（用户真实服务器 192.168.0.3，用户账号）：
- 分步握手 ①②③④⑤ 全 ✓；e2e 列共享根 9 项（正确 [D]/[F] 与大小，中文目录名正常）；
- 头 16 字节读取 `这是你的新*`（中文 ucs2 正确）；Offset=48 Range 读取 ✓（视频 seek 同机制）。

新增 `scripts/smb-diag.cjs`（SMB 分步握手诊断，供今后排查复用）。

## v0.1.1 · 2026-11-14 · SMB 连接修复

**问题**：Linux 上（Node 24 + OpenSSL 3）SMB 连接卡在"连接中"无反馈。真实服务器经 GVfs 可达。

**根因（三层）**：
1. 旧代码用 smb2 库不存在的 `connect()` 方法 → 抛错被吞 → 卡死。已改为正确构造（`share:'\\IP\共享名'`）+ `readdir` 触发握手。
2. smb2 库的 NTLM 认证依赖 OpenSSL 的 **MD4 与 DES**，而 OpenSSL 3 默认禁用 legacy 算法 → `session_setup` 崩溃，握手中断。
3. `domain` 未传有效值，ntlm 对 `undefined` 调 `.toUpperCase()` 崩溃。

**修复**（`patches/ntlm+0.1.3.patch`，经 patch-package 固化，postinstall 自动应用）：
- NT hash（MD4）：改用 `js-md4` 纯 JS 实现（强制 `JS_MD4_NO_NODE_JS` 开关，绕开原生 md4）。
- NTLM 响应（DES-ECB）：自写纯 JS DES（FIPS 46-3，经官方 test vector 85E813540F0AB405 验证），替代 `crypto.createCipheriv('DES-ECB')`。
- LM hash：直接发全零（现代 SMB 只验证 NT 响应）。
- `domain` 兜底为空串。
- smb.cjs 的 connect/withTimeout 全面 try-catch，保证连接必有反馈（成功列目录或明确报错），不再卡死。

**验证**：对用户真实服务器（192.168.0.3，家庭共享）握手成功（0.2s），guest 访问被拒（`STATUS_ACCESS_DENIED`，认证层通过、权限层拒绝 guest）——证明 NTLM 认证链路已通；用正确账号即可列目录/播放。

**注意**：OpenSSL3 下原生 MD4/DES 默认禁用（`error:0308010C ... unsupported`），纯 JS 方案跨平台稳定，不依赖运行时 legacy flags。

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