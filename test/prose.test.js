import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitParagraphs, typewriterFrames, TYPE_CHARS_PER_FRAME } from '../src/ui/prose.js'

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

test('打字机逐帧推进，末帧等于全文', () => {
  const 全文 = '陈岩用杖尖敲了敲碎石。'
  const 帧 = typewriterFrames(全文)
  assert.equal(帧[帧.length - 1], 全文)
  assert.ok(帧.length > 1, '至少要有多帧才叫打字机')
})

test('打字机每帧只增不减，且严格递增', () => {
  const 帧 = typewriterFrames('这是一段用来验证打字机推进的文字，足够长。')
  for (let i = 1; i < 帧.length; i++) {
    assert.ok(帧[i].length > 帧[i - 1].length, `第 ${i} 帧没有推进`)
    assert.ok(帧[i].startsWith(帧[i - 1]), `第 ${i} 帧不是前一帧的延长`)
  }
})

test('帧数按每帧字数换算，不会一字一帧拖死长文', () => {
  const 长文 = '啊'.repeat(600)
  const 帧 = typewriterFrames(长文)
  assert.equal(帧.length, Math.ceil(600 / TYPE_CHARS_PER_FRAME))
})

test('空文本不产生帧', () => {
  assert.deepEqual(typewriterFrames(''), [])
})
