// build/afterPack.cjs
// electron-builder afterPack 钩子：
//   1) 裁剪 Chromium 语言包，只保留 简中/繁中/英文（体积优化）
//   2) macOS：ad-hoc 重签（把"已损坏"降级为"无法验证开发者"，右键打开可过；真机有证书时后续正式签名覆盖）
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const KEEP = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])
const KEEP_LPROJ = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj'])

function prunePakLocales(appOutDir) {
  const localesDir = path.join(appOutDir, 'locales')
  if (!fs.existsSync(localesDir)) return
  let removed = 0
  for (const file of fs.readdirSync(localesDir)) {
    if (!KEEP.has(file)) { fs.unlinkSync(path.join(localesDir, file)); removed++ }
  }
  console.log(`[afterPack] locales 裁剪：保留 简中/繁中/英文，删除 ${removed} 个语言包`)
}

function pruneLproj(dir, label) {
  if (!fs.existsSync(dir)) return
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.lproj')) continue
    if (KEEP_LPROJ.has(name)) continue
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    removed++
  }
  console.log(`[afterPack] ${label} .lproj 裁剪：删除 ${removed} 个语言目录`)
}

function pruneMacLocales(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  pruneLproj(path.join(app, 'Contents', 'Resources'), 'App Resources')
  pruneLproj(path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources'), 'Electron Framework')
}

function adhocSign(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!fs.existsSync(app)) throw new Error(`[afterPack] 找不到 .app：${app}`)
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
    console.log('[afterPack] macOS ad-hoc 重签完成')
  } catch (e) {
    throw new Error(`[afterPack] macOS ad-hoc 重签失败：${e.message}`)
  }
}

exports.default = async function (context) {
  if (context.electronPlatformName === 'darwin') {
    pruneMacLocales(context)
    adhocSign(context)
    return
  }
  prunePakLocales(context.appOutDir)
}