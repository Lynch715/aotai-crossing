import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripModuleSyntax, buildScript, assertModuleOrderComplete, assertHtmlPlaceholders } from '../build.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

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

// Issue 1: import 行尾注释不再漏进产物
test('import 行带尾部注释时应被完整删除', () => {
  const src = [
    "import { a } from './x.js' // 说明为什么要它",
    "import { b } from './y.js' /* block comment */",
    "import './side-effect.js' // 副作用",
    'const c = 1',
  ].join('\n')
  const out = stripModuleSyntax(src)
  assert.ok(!out.includes('import'), `import 行未被删除: ${out}`)
  assert.ok(out.includes('const c = 1'), '普通代码行被误删')
})

// Issue 2: 产物求值冒烟测试
test('bundle 可求值且内部函数可调用', () => {
  const script = buildScript()
  assert.doesNotThrow(() => new Function(script)(), 'bundle 求值抛错')

  // 在 IIFE 收尾前注入探针，确认拼接后的函数确实可用
  const probed = script.replace(/\}\)\(\);$/, 'globalThis.__probe = rollInt(makeRng(1), 1, 6)\n})();')
  new Function(probed)()
  assert.ok(globalThis.__probe >= 1 && globalThis.__probe <= 6, `探针值异常: ${globalThis.__probe}`)
  delete globalThis.__probe
})

// Issue 3: MODULE_ORDER 漏登记改为构建时报错
test('assertModuleOrderComplete 在模块未登记时抛出含路径的错误', () => {
  const tmpPath = join(ROOT, 'src/engine/__tmp_test_probe__.js')
  writeFileSync(tmpPath, '// temp\n', 'utf8')
  try {
    assert.throws(
      () => assertModuleOrderComplete(),
      (err) => {
        assert.ok(err.message.includes('__tmp_test_probe__'), `错误消息未含文件名: ${err.message}`)
        assert.ok(err.message.includes('MODULE_ORDER'), `错误消息未提及 MODULE_ORDER: ${err.message}`)
        return true
      },
      '漏登记模块时应抛错',
    )
  } finally {
    unlinkSync(tmpPath)
  }
})

// Issue 4: buildHtml 占位符缺失改为报错
test('assertHtmlPlaceholders 在 __SCRIPT__ 占位符缺失时抛出错误', () => {
  const noScript = '<html><body>__STYLES__</body></html>'
  assert.throws(
    () => assertHtmlPlaceholders(noScript),
    (err) => {
      assert.ok(err.message.includes('__SCRIPT__'), `错误消息应提及 __SCRIPT__: ${err.message}`)
      return true
    },
    '__SCRIPT__ 缺失时应抛错',
  )
})

test('assertHtmlPlaceholders 在 __STYLES__ 占位符缺失时抛出错误', () => {
  const noStyles = '<html><body>__SCRIPT__</body></html>'
  assert.throws(
    () => assertHtmlPlaceholders(noStyles),
    (err) => {
      assert.ok(err.message.includes('__STYLES__'), `错误消息应提及 __STYLES__: ${err.message}`)
      return true
    },
    '__STYLES__ 缺失时应抛错',
  )
})
