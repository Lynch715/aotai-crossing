import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripModuleSyntax, buildScript } from '../build.mjs'

test('剥掉行首 import 语句', () => {
  const src = "import { a } from './x.js'\nconst b = 1\n"
  assert.equal(stripModuleSyntax(src), 'const b = 1\n')
})

test('剥掉 export 关键字但保留声明', () => {
  const src = 'export function foo() {}\nexport const BAR = 1\n'
  assert.equal(stripModuleSyntax(src), 'function foo() {}\nconst BAR = 1\n')
})

test('不碰字符串里出现的 import/export 字样', () => {
  const src = 'const s = "  import x"\nconst t = "export y"\n'
  assert.equal(stripModuleSyntax(src), src)
})

test('拼接结果里不残留模块语法', () => {
  const out = buildScript()
  assert.ok(!/^import\s/m.test(out), '残留 import')
  assert.ok(!/^export\s/m.test(out), '残留 export')
})

test('拼接结果包含各模块的关键标识符', () => {
  const out = buildScript()
  for (const id of ['makeRng', 'rollInt']) {
    assert.ok(out.includes(id), `缺少 ${id}`)
  }
})

test('拼接结果被 IIFE 包裹', () => {
  const out = buildScript()
  assert.ok(out.trimStart().startsWith(';(function () {'))
  assert.ok(out.trimEnd().endsWith('})();'))
})
