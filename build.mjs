import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// 拓扑顺序：被依赖者在前。新增模块必须手动登记在此。
export const MODULE_ORDER = [
  'src/data/route.js',
  'src/data/npcs.js',
  'src/data/gear.js',
  'src/data/seasons.js',
  'src/engine/state.js',
  'src/engine/rng.js',
  'src/engine/threshold.js',
  'src/engine/consume.js',
  'src/engine/affinity.js',
  'src/engine/ending.js',
  'src/engine/journal.js',
  'src/engine/party.js',
  'src/llm/parser.js',
  'src/llm/validate.js',
  'src/llm/prompt.js',
  'src/llm/client.js',
  'src/turn.js',
  'src/ui/dom.js',
  'src/ui/prose.js',
  'src/ui/router.js',
  'src/ui/save.js',
  'src/ui/config.js',
  'src/ui/portrait.js',
  'src/ui/screen-create.js',
  'src/ui/screen-draw.js',
  'src/ui/screen-shop.js',
  'src/ui/screen-game.js',
  'src/ui/screen-ending.js',
  'src/ui/app.js',
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
  const styles = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
  if (styles.includes('</style')) {
    throw new Error('src/styles.css 含 </style，会提前闭合样式块')
  }
  // 必须用替换函数，不能直接传字符串。String.replace 会把替换串里的
  // $` $' $& $1 当成特殊记号展开——代码里只要出现一个 $ 紧挨反引号
  // （比如正则 `...(.*)$` 的收尾），$` 就会把「匹配位置之前的全部内容」
  // 也就是整段 CSS 塞进脚本里，产物直接语法错误、整页白屏。
  // 替换函数没有这层展开。
  return shell.replace('__STYLES__', () => styles).replace('__SCRIPT__', () => buildScript())
}

// 仅在直接执行时写盘，被 import 时不产生副作用
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true })
  const out = join(ROOT, 'dist/穿越鳌太线.html')
  writeFileSync(out, buildHtml(), 'utf8')
  console.log(`已生成 ${out}`)

  // 立绘按相对路径 assets/portraits/xxx.png 加载，必须跟产物放在同一层，
  // 否则从 dist/ 里解析会指向 dist/assets/——图永远加载不到，且只会静默
  // 退回占位，没有任何报错。
  const 素材源 = join(ROOT, 'assets')
  if (existsSync(素材源)) {
    cpSync(素材源, join(ROOT, 'dist/assets'), { recursive: true })
    const n = readdirSync(join(ROOT, 'dist/assets/portraits')).filter((f) => f.endsWith('.png')).length
    console.log(`已复制 assets/（立绘 ${n} 张）`)
  } else {
    console.log('未发现 assets/，立绘将全部使用程序化占位')
  }
}
