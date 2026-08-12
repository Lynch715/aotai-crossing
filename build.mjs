import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// 拓扑顺序：被依赖者在前。新增模块必须手动登记在此。
export const MODULE_ORDER = [
  'src/data/route.js',
  'src/data/npcs.js',
  'src/data/gear.js',
  'src/data/seasons.js',
  'src/engine/rng.js',
]

// 只删真正的 import 语句（必须有 from 子句或裸副作用导入），
// 只剥真正的 export 声明（后面必须跟 function/const/let/var/class）。
//
// 为什么不用宽松的 /^import\s/ 和 /^export\s+/：模板字符串的续行也在列 0，
// 一旦某行以 "export 你的数据" 或 "import 一段说明" 开头就会被静默改写或整行删掉。
// Task 15 的 system prompt 是一大段多行模板，正好是重灾区，而且测试跑的是 src/
// 的 ESM 原文、不是拼接产物，这种损坏永远测不出来。
const IMPORT_LINE = /^import\s+[^'"]*from\s+['"][^'"]+['"];?\s*(\/\/.*|\/\*.*\*\/)?\s*$|^import\s+['"][^'"]+['"];?\s*(\/\/.*|\/\*.*\*\/)?\s*$/
const EXPORT_KEYWORD = /^export\s+(?=(async\s+)?(function|const|let|var|class)\s)/

export function stripModuleSyntax(source) {
  return source
    .split('\n')
    .filter((line) => !IMPORT_LINE.test(line))
    .map((line) => line.replace(EXPORT_KEYWORD, ''))
    .join('\n')
}

// 防呆：src/ 下每个 .js 都必须登记进 MODULE_ORDER，否则产物会静默缺模块。
function findSourceModules(dir = 'src') {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...findSourceModules(rel))
    else if (entry.name.endsWith('.js')) out.push(rel)
  }
  return out
}

export function assertModuleOrderComplete() {
  const missing = findSourceModules().filter((f) => !MODULE_ORDER.includes(f))
  if (missing.length) {
    throw new Error(`以下模块未登记进 MODULE_ORDER，不会进入产物：\n  ${missing.join('\n  ')}`)
  }
}

export function buildScript() {
  assertModuleOrderComplete()
  const bodies = MODULE_ORDER.map((rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    return `// ===== ${rel} =====\n${stripModuleSyntax(src)}`
  })
  return `;(function () {\n'use strict'\n${bodies.join('\n')}\n})();`
}

export function assertHtmlPlaceholders(html) {
  if (!html.includes('__STYLES__')) throw new Error('src/index.html 缺少 __STYLES__ 占位符，产物将不含样式')
  if (!html.includes('__SCRIPT__')) throw new Error('src/index.html 缺少 __SCRIPT__ 占位符，产物将不含脚本')
}

export function buildHtml() {
  const shell = readFileSync(join(ROOT, 'src/index.html'), 'utf8')
  assertHtmlPlaceholders(shell)
  return shell.replace('__STYLES__', '').replace('__SCRIPT__', buildScript())
}

// 仅在直接执行时写盘，被 import 时不产生副作用
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true })
  const out = join(ROOT, 'dist/穿越鳌太线.html')
  writeFileSync(out, buildHtml(), 'utf8')
  console.log(`已生成 ${out}`)
}
