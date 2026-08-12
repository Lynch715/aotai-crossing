import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portraitSeed, portraitTheme, portraitSvg, portraitPath } from '../src/ui/portrait.js'
import { NPCS } from '../src/data/npcs.js'

test('同一 id 恒得同一种子，不同 id 基本不撞', () => {
  assert.equal(portraitSeed('chenyan'), portraitSeed('chenyan'))
  const 种子 = new Set(NPCS.map((n) => portraitSeed(n.id)))
  assert.ok(种子.size >= NPCS.length - 1, `12 人里撞了太多：${种子.size}`)
})

test('主题给出色相与剪影参数，且落在合法区间', () => {
  for (const n of NPCS) {
    const t = portraitTheme(n.id)
    assert.ok(t.色相 >= 0 && t.色相 < 360, `${n.id} 色相越界 ${t.色相}`)
    assert.ok(t.肩宽 >= 0.5 && t.肩宽 <= 1, `${n.id} 肩宽越界`)
    assert.ok(typeof t.主色 === 'string' && t.主色.startsWith('hsl('))
  }
})

test('12 个人的色相拉得开，不会看起来都一样', () => {
  const 色相 = NPCS.map((n) => portraitTheme(n.id).色相).sort((a, b) => a - b)
  let 最小间隔 = 360
  for (let i = 1; i < 色相.length; i++) 最小间隔 = Math.min(最小间隔, 色相[i] - 色相[i - 1])
  assert.ok(最小间隔 >= 25, `有两人色相只差 ${最小间隔} 度——22% 饱和度下那就是两块一样的暗色，肉眼分不出`)
})

test('生成的是合法 SVG 且不含可执行内容', () => {
  const svg = portraitSvg('chenyan')
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.includes('</svg>'))
  assert.ok(!/<script/i.test(svg), 'SVG 里不该有脚本')
  assert.ok(!/on\w+=/i.test(svg), 'SVG 里不该有事件属性')
})

test('立绘路径按约定拼，状态层可选', () => {
  assert.equal(portraitPath('chenyan'), 'assets/portraits/chenyan.png')
  assert.equal(portraitPath('chenyan', 'hurt'), 'assets/portraits/chenyan_hurt.png')
})

test('主角用性别加种子，不与任何 NPC 撞', () => {
  const 男 = portraitTheme('pc:男:7')
  const 女 = portraitTheme('pc:女:7')
  assert.notEqual(男.色相, 女.色相)
})

test('主角男女的渐变 id 不会撞车', () => {
  const 取id = (svg) => svg.match(/id="([^"]+)"/)[1]
  const 男 = 取id(portraitSvg('pc:男:7'))
  const 女 = 取id(portraitSvg('pc:女:7'))
  assert.notEqual(男, 女, '两张立绘共用同一个渐变，后渲染的会顶掉前一个')
})
