import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// 拓扑顺序：被依赖者在前。新增模块必须手动登记在此。
export const MODULE_ORDER = [
  'src/engine/rng.js',
]

// 行首（无缩进）的 import 整行删除；行首的 export 关键字剥掉。
// 约束见计划开头的「代码风格约束」——字符串里的同名字样因为不在行首，不受影响。
export function stripModuleSyntax(source) {
  return source
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .map((line) => line.replace(/^export\s+/, ''))
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
