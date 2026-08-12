import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createJournal, recordNode, recordEvent, addForeshadow,
  resolveForeshadow, updateNpcStatus, compressJournal,
  renderJournal, MAX_EVENTS,
} from '../src/engine/journal.js'

test('新档案是空的', () => {
  const j = createJournal()
  assert.deepEqual(j.已过节点, [])
  assert.deepEqual(j.关键事件, [])
  assert.deepEqual(j.未收伏笔, [])
  assert.deepEqual(j.人物状态, {})
})

test('记录节点，连续重复不会重复记', () => {
  const j = createJournal()
  recordNode(j, 'tangkou')
  recordNode(j, 'tangkou')
  recordNode(j, 'huoshaopo')
  assert.deepEqual(j.已过节点, ['tangkou', 'huoshaopo'])
})

test('折返回旧节点会再记一次（路线是有来回的）', () => {
  const j = createJournal()
  recordNode(j, 'shuiwozi')
  recordNode(j, 'maijieling')
  recordNode(j, 'shuiwozi')
  assert.deepEqual(j.已过节点, ['shuiwozi', 'maijieling', 'shuiwozi'])
})

test('记录事件带上时间戳', () => {
  const j = createJournal()
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝盖旧伤复发，你分了他布洛芬')
  assert.equal(j.关键事件.length, 1)
  assert.equal(j.关键事件[0].day, 2)
  assert.equal(j.关键事件[0].slot, '晚')
  assert.ok(j.关键事件[0].文本.includes('布洛芬'))
})

test('空白事件被忽略', () => {
  const j = createJournal()
  recordEvent(j, { day: 1, slot: '早' }, '   ')
  recordEvent(j, { day: 1, slot: '早' }, '')
  assert.equal(j.关键事件.length, 0)
})

test('伏笔可增可收，收掉的移出未收列表', () => {
  const j = createJournal()
  addForeshadow(j, '石缝里那截褪色路标带')
  addForeshadow(j, '对讲机里断续的呼叫')
  assert.equal(j.未收伏笔.length, 2)

  assert.equal(resolveForeshadow(j, '石缝里那截褪色路标带'), true)
  assert.equal(j.未收伏笔.length, 1)
  assert.equal(j.已收伏笔.length, 1)
})

test('重复添加同一伏笔不会翻倍', () => {
  const j = createJournal()
  addForeshadow(j, '对讲机里断续的呼叫')
  addForeshadow(j, '对讲机里断续的呼叫')
  assert.equal(j.未收伏笔.length, 1)
})

test('收一个不存在的伏笔返回 false', () => {
  const j = createJournal()
  assert.equal(resolveForeshadow(j, '查无此伏笔'), false)
})

test('人物状态可更新可覆盖', () => {
  const j = createJournal()
  updateNpcStatus(j, 'linxiaoya', '轻度高反')
  updateNpcStatus(j, 'linxiaoya', '已恢复')
  assert.equal(j.人物状态.linxiaoya, '已恢复')
})

test(`压缩只留最近 ${MAX_EVENTS} 条事件`, () => {
  const j = createJournal()
  for (let i = 1; i <= 30; i++) recordEvent(j, { day: i, slot: '早' }, `事件${i}`)
  compressJournal(j)
  assert.equal(j.关键事件.length, MAX_EVENTS)
  assert.equal(j.关键事件[0].文本, `事件${30 - MAX_EVENTS + 1}`)
  assert.equal(j.关键事件[MAX_EVENTS - 1].文本, '事件30')
})

test('压缩绝不丢未收伏笔', () => {
  const j = createJournal()
  for (let i = 1; i <= 50; i++) recordEvent(j, { day: i, slot: '早' }, `事件${i}`)
  for (let i = 1; i <= 12; i++) addForeshadow(j, `伏笔${i}`)
  compressJournal(j)
  assert.equal(j.未收伏笔.length, 12)
})

test('事件不超限时压缩是空操作', () => {
  const j = createJournal()
  recordEvent(j, { day: 1, slot: '早' }, '只有一条')
  compressJournal(j)
  assert.equal(j.关键事件.length, 1)
})

test('渲染成 prompt 片段，含四个小节', () => {
  const j = createJournal()
  recordNode(j, 'tangkou')
  recordNode(j, 'huoshaopo')
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝盖旧伤复发')
  addForeshadow(j, '对讲机里断续的呼叫')
  updateNpcStatus(j, 'linxiaoya', '轻度高反')

  const out = renderJournal(j)
  assert.ok(out.includes('已过节点'))
  assert.ok(out.includes('塘口村起点'))
  assert.ok(out.includes('火烧坡'))
  assert.ok(out.includes('关键事件'))
  assert.ok(out.includes('王大鹏'))
  assert.ok(out.includes('未收伏笔'))
  assert.ok(out.includes('对讲机'))
  assert.ok(out.includes('林晓雅'))
  assert.ok(out.includes('轻度高反'))
})

test('渲染绝不泄漏数字好感（文档禁止 LLM 开天眼）', () => {
  const j = createJournal()
  updateNpcStatus(j, 'linxiaoya', '轻度高反')
  const out = renderJournal(j)
  assert.ok(!/好感/.test(out), '渲染结果不该出现「好感」二字')
  assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(out), '渲染结果不该出现百分制数值')
})

test('档案拒收裸数值与好感字样的状态词', () => {
  const j = createJournal()
  updateNpcStatus(j, 'linxiaoya', '62')
  updateNpcStatus(j, 'chenyan', '62/100')
  updateNpcStatus(j, 'wangdapeng', '好感很高')
  assert.deepEqual(j.人物状态, {}, '这三种都该被拒收')

  // 正当描述照收，含数字也不误伤
  updateNpcStatus(j, 'zhoutao', '膝伤第2天')
  assert.equal(j.人物状态.zhoutao, '膝伤第2天')

  const out = renderJournal(j)
  assert.ok(!/62/.test(out), '裸数值不该出现在发给 LLM 的档案里')
})

test('空档案也能渲染，不炸', () => {
  const out = renderJournal(createJournal())
  assert.equal(typeof out, 'string')
  assert.ok(out.length > 0)
})
