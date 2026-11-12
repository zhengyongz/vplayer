# VPlayer 冒烟测试说明

统一入口：`node scripts/smoke/run.mjs`（`npm run smoke`）。

## 分层

| 层 | 内容 | 是否需 Electron | 耗时 |
|----|------|----------------|------|
| L1 静态 | 关键文件存在、electron 语法、package.json 字段、i18n 双语、vite 构建 | 否 | 秒级 |
| L2 逻辑 | 来源路由（`source.js`）与格式化（`format.js`）单元测试（纯 ESM） | 否 | 秒级 |
| L4 集成 | 起真实 Electron 冒烟进程，断言渲染层无未捕获错误 + 产出截图 | 是 | ~20s |

## 用法

```bash
npm run smoke                 # 全跑（L1→L2→L4）
npm run smoke -- --layer L1    # 只跑 L1
npm run smoke -- --skip L4      # 跳过 L4（无显示环境）
npm run smoke -- --no-build     # dist 已存在时跳过构建
npm run smoke -- --json         # JSON 报告（.smoke-report/smoke.json）
```

## 判据

- 退出码 0 = 全通过；1 = 有失败。
- L4 用 `VPLAYER_SMOKE=1` 让主进程在 6 秒后截图并退出；断言 "完成，正常退出" 且渲染层无 `[renderer] ... Error / Uncaught`。
- Linux 无显示环境：`xvfb-run --auto-servernum npm run smoke`。

## 报告

结果写入 `.smoke-report/smoke.json`（已 gitignore），`npm run verify` 读取它判断"能否发版"。