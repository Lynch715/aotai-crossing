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

test('模板字符串续行中以 export/import 开头的中文内容不被改写', () => {
  // 模拟 Task 15 那类大段多行模板：续行在列 0，偶尔以 export/import 汉字开头。
  // 旧宽松正则会删掉 "import 一段说明" 整行，并剥掉 "export 你的数据" 的 "export "。
  const src = [
    "export const PROMPT = `",
    "export 你的数据",
    "import 一段说明",
    "export：见下表",
    "`",
    "",
  ].join('\n')
  const out = stripModuleSyntax(src)
  // export 声明本身应被剥掉关键字
  assert.ok(out.includes('const PROMPT = `'), 'export const 声明未被正确剥离')
  // 模板字符串内的续行必须完整保留
  assert.ok(out.includes('export 你的数据'), '"export 你的数据" 被错误改写')
  assert.ok(out.includes('import 一段说明'), '"import 一段说明" 被错误删除')
  assert.ok(out.includes('export：见下表'), '"export：见下表" 被错误改写')
})

test('export async function 与 export class 形式均被正确处理', () => {
  const src = [
    'export async function bar() {}',
    'export class Baz {}',
    'export let x = 1',
    'export var y = 2',
  ].join('\n')
  assert.equal(
    stripModuleSyntax(src),
    ['async function bar() {}', 'class Baz {}', 'let x = 1', 'var y = 2'].join('\n'),
  )
})
