import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripModuleSyntax, buildScript, assertModuleOrderComplete, assertHtmlPlaceholders, buildHtml } from '../build.mjs'
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

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

test('buildHtml 把 styles.css 注进去，不再是空字符串', () => {
  const html = buildHtml()
  assert.ok(!html.includes('__STYLES__'), '占位符没被替换')
  assert.ok(html.includes('--bg-deep'), '主题变量没进产物')
  assert.ok(/<style>[\s\S]{200,}<\/style>/.test(html), '样式内容过短，可能没读到文件')
})

test('样式里不得出现会破坏 HTML 的闭合标签', () => {
  const css = readFileSync(join(ROOT_DIR, 'src/styles.css'), 'utf8')
  assert.ok(!css.includes('</style'), 'CSS 里出现 </style 会提前闭合样式块')
})

// ══════════════════════════════════════════════════════════════
// 这一条是拿整页白屏换来的。
//
// 原来的「bundle 可求值」测的是 buildScript() 的直接输出，
// 而真正送到浏览器的是 buildHtml() 里被 replace 塞进 HTML 的那份。
// 中间这步替换没人看着——String.replace 把代码里的 $` 当成特殊记号，
// 展开成「匹配位置之前的全部内容」，整段 CSS 被灌进脚本，语法直接崩。
// 本地测试全绿、线上白屏，就是这么来的。
// ══════════════════════════════════════════════════════════════

function 从HTML取脚本(html) {
  const 开 = html.indexOf('<script>') + '<script>'.length
  const 关 = html.lastIndexOf('</script>')
  return html.slice(开, 关)
}

test('HTML 里嵌的那份脚本才是真交付物，它必须可求值', () => {
  const 码 = 从HTML取脚本(buildHtml())
  assert.doesNotThrow(() => new Function(码)(), 'HTML 内嵌脚本求值失败')
})

test('嵌进 HTML 的脚本与 buildScript 逐字相同，replace 不许改动它', () => {
  assert.equal(从HTML取脚本(buildHtml()), buildScript(),
    'replace 把脚本改动了——多半是 $` / $\' / $& 被当成特殊记号展开')
})

test('代码里含 $` 时也不会被 replace 展开', () => {
  // 直接复现触发条件：正则末尾的 $ 紧挨模板字符串的收尾反引号
  const 码 = 从HTML取脚本(buildHtml())
  assert.ok(码.includes('(.*)$`'), '前提不成立：产物里已没有 $` 序列，这条测试失去意义')
  assert.ok(!码.includes('--bg-deep'), 'CSS 被灌进脚本了')
})
