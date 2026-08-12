import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitParagraphs, createTypewriter, TYPE_CHARS_PER_FRAME } from '../src/ui/prose.js'

test('按空行切段', () => {
  assert.deepEqual(splitParagraphs('甲\n\n乙\n\n丙'), ['甲', '乙', '丙'])
})

test('单换行不切段——LLM 常在一段里手动折行', () => {
  assert.deepEqual(splitParagraphs('甲\n乙'), ['甲 乙'])
})

test('多余空行不产生空段', () => {
  assert.deepEqual(splitParagraphs('甲\n\n\n\n乙'), ['甲', '乙'])
})

test('首尾空白被清掉', () => {
  assert.deepEqual(splitParagraphs('\n\n  甲  \n\n'), ['甲'])
})

test('空输入给空数组而不是 [""]', () => {
  assert.deepEqual(splitParagraphs(''), [])
  assert.deepEqual(splitParagraphs('   \n\n  '), [])
  assert.deepEqual(splitParagraphs(null), [])
})


test('打字机匀速吐字，每帧只增不减', () => {
  const tw = createTypewriter()
  tw.push('陈岩用杖尖敲了敲碎石。')
  const 帧 = []
  let f
  while ((f = tw.tick()) !== null) 帧.push(f)
  assert.ok(帧.length > 1, '至少要有多帧才叫打字机')
  assert.equal(帧[帧.length - 1], '陈岩用杖尖敲了敲碎石。')
  for (let i = 1; i < 帧.length; i++) {
    assert.ok(帧[i].length > 帧[i - 1].length, `第 ${i} 帧没推进`)
    assert.ok(帧[i].startsWith(帧[i - 1]), `第 ${i} 帧不是前一帧的延长`)
  }
})

test('每帧吐 TYPE_CHARS_PER_FRAME 个字', () => {
  const tw = createTypewriter()
  tw.push('啊'.repeat(30))
  assert.equal(tw.tick().length, TYPE_CHARS_PER_FRAME)
  assert.equal(tw.tick().length, TYPE_CHARS_PER_FRAME * 2)
})

test('流式续推：吐完了再来新内容，还能接着吐', () => {
  const tw = createTypewriter()
  tw.push('甲乙丙')
  while (tw.tick() !== null) {}
  assert.equal(tw.done(), true)
  tw.push('丁戊己')
  assert.equal(tw.done(), false, '来了新内容却认为吐完了')
  let 末 = null
  let f
  while ((f = tw.tick()) !== null) 末 = f
  assert.equal(末, '甲乙丙丁戊己')
})

test('网络一次来一大块也匀速吐，不会一次全糊上去', () => {
  const tw = createTypewriter()
  tw.push('啊'.repeat(50))
  const 首帧 = tw.tick()
  assert.ok(首帧.length < 50, `一次全吐了：${首帧.length} 字`)
})

test('flush 一次吐完，用于玩家点跳过', () => {
  const tw = createTypewriter()
  tw.push('甲乙丙丁戊己庚辛')
  tw.tick()
  assert.equal(tw.flush(), '甲乙丙丁戊己庚辛')
  assert.equal(tw.done(), true)
  assert.equal(tw.tick(), null)
})

test('没内容时 tick 返回 null 而不是空串', () => {
  const tw = createTypewriter()
  assert.equal(tw.tick(), null)
  assert.equal(tw.done(), true)
})

test('push 非字符串不炸', () => {
  const tw = createTypewriter()
  tw.push(null)
  tw.push(undefined)
  tw.push(42)
  assert.equal(tw.text(), '')
})
