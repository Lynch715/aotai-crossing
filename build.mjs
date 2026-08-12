import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// 拓扑顺序：被依赖者在前。新增模块必须手动登记在此。
export const MODULE_ORDER = [
  'src/engine/rng.js',
]

// 只删真正的 import 语句（必须有 from 子句或裸副作用导入），
// 只剥真正的 export 声明（后面必须跟 function/const/let/var/class）。
//
// 为什么不用宽松的 /^import\s/ 和 /^export\s+/：模板字符串的续行也在列 0，
// 一旦某行以 "export 你的数据" 或 "import 一段说明" 开头就会被静默改写或整行删掉。
// Task 15 的 system prompt 是一大段多行模板，正好是重灾区，而且测试跑的是 src/
// 的 ESM 原文、不是拼接产物，这种损坏永远测不出来。
const IMPORT_LINE = /^import\s+[^'"]*from\s+['"][^'"]+['"];?\s*$|^import\s+['"][^'"]+['"];?\s*$/
const EXPORT_KEYWORD = /^export\s+(?=(async\s+)?(function|const|let|var|class)\s)/

export function stripModuleSyntax(source) {
  return source
    .split('\n')
    .filter((line) => !IMPORT_LINE.test(line))
    .map((line) => line.replace(EXPORT_KEYWORD, ''))
    .join('\n')
}

export function buildScript() {
  const bodies = MODULE_ORDER.map((rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    return `// ===== ${rel} =====\n${stripModuleSyntax(src)}`
  })
  return `;(function () {\n'use strict'\n${bodies.join('\n')}\n})();`
}

export function buildHtml() {
  const shell = readFileSync(join(ROOT, 'src/index.html'), 'utf8')
  return shell.replace('__STYLES__', '').replace('__SCRIPT__', buildScript())
}

// 仅在直接执行时写盘，被 import 时不产生副作用
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true })
  const out = join(ROOT, 'dist/穿越鳌太线.html')
  writeFileSync(out, buildHtml(), 'utf8')
  console.log(`已生成 ${out}`)
}
