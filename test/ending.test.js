import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEnding, applyEnding, FINE_AMOUNT } from '../src/engine/ending.js'

function 状态(over = {}) {
  return {
    phase: '徒步',
    clock: { day: 5, slot: '中' },
    place: { nodeId: 'maijieling', 海拔: 3500 },
    money: 4320,
    pc: { 体力: 50, 伤病: [] },
    flags: { 已求救: false, 已下撤: false, 失温连败: 0 },
    ...over,
  }
}

test('一切正常时没有结局', () => {
  assert.equal(checkEnding(状态()), null)
})

test('体力归零 → 失败遇险', () => {
  const e = checkEnding(状态({ pc: { 体力: 0, 伤病: [] } }))
  assert.equal(e.type, '失败遇险')
  assert.ok(e.原因.includes('体力'))
})

test('重伤满 2 天未处理 → 失败遇险', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '滑坠骨折', 严重度: '重', 起始day: 3, 已处理: false }] } })
  assert.equal(checkEnding(s).type, '失败遇险')
})

test('重伤但已处理 → 不触发', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '滑坠骨折', 严重度: '重', 起始day: 3, 已处理: true }] } })
  assert.equal(checkEnding(s), null)
})

test('重伤刚发生不满 2 天 → 不触发', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '滑坠骨折', 严重度: '重', 起始day: 4, 已处理: false }] } })
  assert.equal(checkEnding(s), null)
})

test('轻伤放多久都不触发', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '擦伤', 严重度: '轻', 起始day: 1, 已处理: false }] } })
  assert.equal(checkEnding(s), null)
})

test('失温连败 3 次 → 失败遇险', () => {
  assert.equal(checkEnding(状态({ flags: { 已求救: false, 已下撤: false, 失温连败: 2 } })), null)
  assert.equal(checkEnding(状态({ flags: { 已求救: false, 已下撤: false, 失温连败: 3 } })).type, '失败遇险')
})

test('已求救 → 被救援', () => {
  const e = checkEnding(状态({ flags: { 已求救: true, 已下撤: false, 失温连败: 0 } }))
  assert.equal(e.type, '被救援')
})

test('抵达下板寺 → 成功穿越', () => {
  const e = checkEnding(状态({ place: { nodeId: 'xiabansi', 海拔: 2800 } }))
  assert.equal(e.type, '成功穿越')
  assert.equal(e.罚款, FINE_AMOUNT)
})

test('失败遇险优先于被救援', () => {
  const s = 状态({ pc: { 体力: 0, 伤病: [] }, flags: { 已求救: true, 已下撤: false, 失温连败: 0 } })
  assert.equal(checkEnding(s).type, '失败遇险')
})

test('applyEnding 写入 phase 与结局，并对成功穿越扣罚款', () => {
  // 钱要多于罚款才看得出扣款；基础夹具的 4320 不够扣，会被下限夹成 0
  const s = 状态({ place: { nodeId: 'xiabansi', 海拔: 2800 }, money: 8000 })
  applyEnding(s, checkEnding(s))
  assert.equal(s.phase, '结局')
  assert.equal(s.ending.type, '成功穿越')
  assert.equal(s.money, 8000 - FINE_AMOUNT)
})

test('罚款不会把钱扣成负数', () => {
  const s = 状态({ place: { nodeId: 'xiabansi', 海拔: 2800 }, money: 300 })
  applyEnding(s, checkEnding(s))
  assert.equal(s.money, 0)
})

test('失败遇险不扣罚款', () => {
  const s = 状态({ pc: { 体力: 0, 伤病: [] } })
  applyEnding(s, checkEnding(s))
  assert.equal(s.money, 4320)
})
