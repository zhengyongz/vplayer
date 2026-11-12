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

# VPlayer — Minimal Video Player

> English | [中文](README.md)
>
> This is the English-maintained README; Chinese docs in [README.md](./README.md).

A minimal Electron desktop video player. **All playback and processing happens locally — nothing is uploaded to any server.** Play from local files, URLs, or LAN SMB shares. Bilingual UI, with **delta updates**.

## Features

### Sources

| Source | How |
|--------|-----|
| Local files | Drag & drop / open dialog / file-association double-click (MP4/MKV/WebM/AVI/MOV/M4V/WMV/FLV/TS, etc.) |
| URL | Paste an http/https video URL (incl. m3u8/HLS, subject to origin CORS) |
| LAN SMB | Built-in share browser → click to play (credentials stored encrypted via safeStorage) |

### Formats & codecs

- **Native first**: MP4 (H.264/AAC), WebM (VP8/VP9/AV1), MOV, OGG play directly in Chromium — **zero dependency**.
- **Optional codec component**: containers Chromium can't decode (MKV/AVI/WMV/FLV/TS…) are handled by an on-demand ffmpeg component (~80 MB, once) with **progressive transcoding**. SMB files of these types are supported too (ffmpeg reads the local HTTP stream).

### Player

Minimal controls: play/pause, seek, volume/mute, speed, fullscreen, prev/next, playlist, recent.

### Delta updates

| Platform | Method |
|----------|--------|
| Windows | electron-updater **blockmap delta** — only changed bytes |
| Linux | mirrored full deb + sha256 |
| macOS | unsigned; guided manual DMG download |

Auto mirror fallback for mainland-China networks (official → ghfast.top → gh-proxy.com → ghproxy.net).

## Tech stack

- Electron 33 + React 18 + Vite 6 + Tailwind 3 + electron-builder 25
- smb2 (pure-JS SMB client)
- Local HTTP Range streaming server (unifies local / SMB / transcode)

## Install & usage

See [README.md](./README.md) for platform install commands (deb/NSIS/dmg) and source build.

## Developer guide

Read `docs/操作手册.md` (one-page ops), `docs/TASKS.md` (issue ledger), `docs/STATE.md` (decisions), `docs/smoke/README.md` (smoke suite).

```bash
npm run handoff    # generate handoff packet
npm run smoke      # smoke tests (must pass before commit)
npm run status     # project status
npm run verify     # pre-release health check
```

## Security

- Everything local; no backend server, no accounts, no data collection.
- SMB credentials encrypted via system safeStorage.
- Upgrade/component installs are main-process ledgered; renderer cannot pass arbitrary paths.

## License

[MIT License](./LICENSE)

> AI-generated