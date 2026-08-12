import { test } from 'node:test'
import assert from 'node:assert/strict'
import { successChance, gapFor, judgeOption, UNREACHABLE } from '../src/engine/threshold.js'
import { makeRng } from '../src/engine/rng.js'

function 状态(over = {}) {
  return {
    pc: { 户外经验: 38, 体力: 50 },
    party: [{ npcId: 'linxiaoya', 好感: 62, 在队: true }, { npcId: 'chenyan', 好感: 45, 在队: true }],
    pack: [{ gearId: 'rope', 数量: 1 }],
    ...over,
  }
}

test('成功率：达标 100%，d=1 九成，d=10 两成七，d>10 归零', () => {
  assert.equal(successChance(0), 1)
  assert.equal(successChance(-5), 1)
  assert.ok(Math.abs(successChance(1) - 0.9) < 1e-9)
  assert.ok(Math.abs(successChance(10) - 0.27) < 1e-9)
  assert.equal(successChance(11), 0)
  assert.equal(successChance(999), 0)
})

test('门槛全达标时差距为 0', () => {
  const { gap } = gapFor({ 经验: 30, 体力: 40, 好感: { linxiaoya: 60 } }, 状态())
  assert.equal(gap, 0)
})

test('经验不足按差值算，理由写明缺口', () => {
  const { gap, reasons } = gapFor({ 经验: 60 }, 状态())
  assert.equal(gap, 22)
  assert.ok(reasons[0].includes('户外经验'))
  assert.ok(reasons[0].includes('22'))
})

test('多条不满足取最大差距', () => {
  const { gap } = gapFor({ 经验: 45, 体力: 70 }, 状态())
  // 经验差 7，体力差 20 → 取 20
  assert.equal(gap, 20)
})

test('好感按 npcId 比对，不在队的人视为不可达', () => {
  assert.equal(gapFor({ 好感: { linxiaoya: 70 } }, 状态()).gap, 8)
  assert.equal(gapFor({ 好感: { wangdapeng: 30 } }, 状态()).gap, UNREACHABLE)
})

test('缺物品直接不可达', () => {
  assert.equal(gapFor({ 物品: ['rope'] }, 状态()).gap, 0)
  assert.equal(gapFor({ 物品: ['crampons'] }, 状态()).gap, UNREACHABLE)
})

test('体力低于 20 时全局追加 10 点差距', () => {
  const 虚弱 = 状态({ pc: { 户外经验: 38, 体力: 15 } })
  assert.equal(gapFor({ 经验: 30 }, 虚弱).gap, 10)
  assert.equal(gapFor({ 经验: 45 }, 虚弱).gap, 17)
})

test('体力正好 20 不触发惩罚', () => {
  const s = 状态({ pc: { 户外经验: 38, 体力: 20 } })
  assert.equal(gapFor({ 经验: 30 }, s).gap, 0)
})

test('空门槛视为无条件通过', () => {
  assert.equal(gapFor({}, 状态()).gap, 0)
  assert.equal(gapFor(undefined, 状态()).gap, 0)
})

test('reasons[0] 恒为卡住玩家的那一条，不是先算到的那一条', () => {
  // 经验差 7、体力差 20 → 卡住的是体力，UI 要先显示它
  const { gap, reasons } = gapFor({ 经验: 45, 体力: 70 }, 状态())
  assert.equal(gap, 20)
  assert.ok(reasons[0].includes('体力'), `首条应为体力，实为：${reasons[0]}`)
  assert.ok(reasons[0].includes('20'))
  assert.ok(reasons[1].includes('户外经验'))
})

test('离谱的数值门槛收敛到 UNREACHABLE，不会溢出哨兵值', () => {
  // LLM 若报出「需经验 5000」，差距原本会算成 4962，
  // 下游用 gap === UNREACHABLE 判结构性不可达就会漏掉
  const { gap } = gapFor({ 经验: 5000 }, 状态())
  assert.equal(gap, UNREACHABLE)
  assert.equal(successChance(gap), 0)
})

test('judgeOption：达标必成，不掷骰', () => {
  const r = judgeOption({ require: { 经验: 30 } }, 状态(), makeRng(1))
  assert.equal(r.outcome, 'success')
  assert.equal(r.gap, 0)
  assert.equal(r.chance, 1)
  assert.equal(r.roll, null)
})

test('judgeOption：差距过大必败且标记不可选', () => {
  const r = judgeOption({ require: { 经验: 60 } }, 状态(), makeRng(1))
  assert.equal(r.outcome, 'fail')
  assert.equal(r.selectable, false)
  assert.equal(r.chance, 0)
})

test('judgeOption：边缘档会掷骰，且同种子可复现', () => {
  const opt = { require: { 经验: 43 } } // 差 5 → 0.62
  const a = judgeOption(opt, 状态(), makeRng(7))
  const b = judgeOption(opt, 状态(), makeRng(7))
  assert.equal(a.outcome, b.outcome)
  assert.equal(a.roll, b.roll)
  assert.ok(Math.abs(a.chance - 0.62) < 1e-9)
  assert.equal(a.selectable, true)
})

test('边缘档长期成功率贴近标称概率', () => {
  const opt = { require: { 经验: 43 } } // 0.62
  let 成功 = 0
  for (let i = 0; i < 4000; i++) {
    if (judgeOption(opt, 状态(), makeRng(i)).outcome === 'success') 成功++
  }
  const 实测 = 成功 / 4000
  assert.ok(Math.abs(实测 - 0.62) < 0.03, `实测 ${实测}`)
})

test('理由里写中文名，不泄漏内部 id', () => {
  const { reasons } = gapFor({ 好感: { linxiaoya: 70 } }, 状态())
  assert.ok(reasons[0].includes('林晓雅'), `没用中文名：${reasons[0]}`)
  assert.ok(!reasons[0].includes('linxiaoya'), `泄漏了 id：${reasons[0]}`)
})

test('人不在队的理由也用中文名', () => {
  const { reasons } = gapFor({ 好感: { wangdapeng: 30 } }, 状态())
  assert.ok(reasons[0].includes('王大鹏'), `没用中文名：${reasons[0]}`)
})

test('缺物品的理由写装备中文名', () => {
  const { reasons } = gapFor({ 物品: ['crampons'] }, 状态())
  assert.ok(reasons[0].includes('冰爪'), `没用中文名：${reasons[0]}`)
  assert.ok(!reasons[0].includes('crampons'), `泄漏了 id：${reasons[0]}`)
})
