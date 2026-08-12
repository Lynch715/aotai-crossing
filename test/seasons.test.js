import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEASONS, getSeason, rollSeason, gearWarnings } from '../src/data/seasons.js'
import { makeRng } from '../src/engine/rng.js'

test('四季齐全且字段完整', () => {
  assert.equal(SEASONS.length, 4)
  for (const s of SEASONS) {
    assert.ok(s.id && s.名称 && s.月份, `字段缺失: ${s.id}`)
    assert.ok(s.主要风险.length > 0 && s.次要风险.length > 0 && s.推荐准备.length > 0)
    assert.equal(typeof s.夜间温度, 'number')
  }
})

test('冬季最冷，夏季最暖', () => {
  const 最冷 = SEASONS.reduce((a, b) => (a.夜间温度 < b.夜间温度 ? a : b))
  const 最暖 = SEASONS.reduce((a, b) => (a.夜间温度 > b.夜间温度 ? a : b))
  assert.equal(最冷.id, '冬季')
  assert.equal(最暖.id, '夏季')
})

test('rollSeason 同种子结果一致，且四季都能抽到', () => {
  assert.equal(rollSeason(makeRng(42)), rollSeason(makeRng(42)))
  const 抽到 = new Set()
  for (let i = 0; i < 400; i++) 抽到.add(rollSeason(makeRng(i)))
  assert.equal(抽到.size, 4)
})

test('冬季缺冰爪会报警告', () => {
  const w = gearWarnings('冬季', [])
  assert.ok(w.some((x) => x.includes('冰爪')))
})

test('冬季带齐了就不报那条警告', () => {
  const w = gearWarnings('冬季', ['crampons', 'ice_axe', 'gaiters'])
  assert.ok(!w.some((x) => x.includes('冰爪')))
})

test('夏季不因为缺冰爪报警告', () => {
  const w = gearWarnings('夏季', [])
  assert.ok(!w.some((x) => x.includes('冰爪')))
})

test('任何季节缺求救设备都报警告', () => {
  for (const s of ['春季', '夏季', '秋季', '冬季']) {
    assert.ok(gearWarnings(s, []).some((x) => x.includes('求救')), `${s} 未报求救警告`)
  }
  assert.ok(!gearWarnings('夏季', ['gps']).some((x) => x.includes('求救')))
})

test('睡袋温标不足会报警告', () => {
  assert.ok(gearWarnings('冬季', ['sleeping_bag']).some((x) => x.includes('温标')))
  assert.ok(!gearWarnings('夏季', ['sleeping_bag']).some((x) => x.includes('温标')))
})

test('睡袋温标从 gear.js 读取，不是硬编码', () => {
  // 冬季夜间 -25℃：睡袋 -10℃ 不够，加内胆后 -15℃ 仍不够，
  // 但警告文案里的数字必须随 gear.js 的数据变化，否则说明被写死了
  const 无内胆 = gearWarnings('冬季', ['sleeping_bag']).find((x) => x.includes('温标'))
  const 有内胆 = gearWarnings('冬季', ['sleeping_bag', 'bag_liner']).find((x) => x.includes('温标'))
  assert.ok(无内胆.includes('-10℃'), `无内胆文案: ${无内胆}`)
  assert.ok(有内胆.includes('-15℃'), `有内胆文案: ${有内胆}`)
})

test('压根没带睡袋要报警，只买内胆不算带了睡袋', () => {
  // 秋季原本只有一条通用求救警告，没带睡袋应当也提醒
  assert.ok(gearWarnings('秋季', ['gps']).some((x) => x.includes('没带睡袋')))
  // 内胆不能单独用
  assert.ok(gearWarnings('冬季', ['bag_liner']).some((x) => x.includes('没带睡袋')))
  // 夏季夜间 5℃，不报
  assert.ok(!gearWarnings('夏季', []).some((x) => x.includes('没带睡袋')))
  // 带了睡袋就走温标那条，不再报「没带」
  assert.ok(!gearWarnings('冬季', ['sleeping_bag']).some((x) => x.includes('没带睡袋')))
})

test('getSeason 取不到返回 undefined', () => {
  assert.equal(getSeason('雨季'), undefined)
})

test('冬季带极寒睡袋不再报温标警告', () => {
  const w = gearWarnings('冬季', ['winter_bag'])
  assert.ok(!w.some((x) => x.includes('温标')), `仍报警：${w.join('｜')}`)
})
