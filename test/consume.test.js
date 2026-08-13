import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stepStaminaCost, applyStepCost, isAcclimatized, effectiveWarmth,
  rest, eatHot, eatCold, sleep, advanceSlot, dailyUpkeep,
} from '../src/engine/consume.js'
import { createInitialState } from '../src/engine/state.js'

function 状态(over = {}) {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [], 金钱: 5000,
    背包: [{ gearId: 'staple_food', 档: '主流', 数量: 4 }],
  })
  Object.assign(s.pc, over.pc || {})
  if (over.负重 !== undefined) s.carry.当前 = over.负重
  if (over.海拔 !== undefined) s.place.海拔 = over.海拔
  if (over.高海拔过夜数 !== undefined) s.flags.高海拔过夜数 = over.高海拔过夜数
  return s
}

test('负重不超基准线时消耗基础值 6', () => {
  assert.equal(stepStaminaCost(状态({ 负重: 15, 海拔: 3000 })), 6)
  assert.equal(stepStaminaCost(状态({ 负重: 10, 海拔: 3000 })), 6)
})

test('spec 里的样例：负重 26.8kg、已适应的 3500m，消耗 9', () => {
  const s = 状态({ 负重: 26.8, 海拔: 3500, 高海拔过夜数: 2 })
  assert.equal(stepStaminaCost(s), 9)
})

test('未适应时高海拔额外扣 2', () => {
  const s = 状态({ 负重: 26.8, 海拔: 3500, 高海拔过夜数: 0 })
  assert.equal(stepStaminaCost(s), 11)
})

test('3400 米以下不吃高海拔惩罚', () => {
  const s = 状态({ 负重: 15, 海拔: 3400, 高海拔过夜数: 0 })
  assert.equal(stepStaminaCost(s), 6)
})

test('登山杖减免 1 点', () => {
  const s = 状态({ 负重: 26.8, 海拔: 3500, 高海拔过夜数: 2 })
  s.pack.push({ gearId: 'trekking_poles', 档: '通用', 数量: 1, 单重: 0.5, 余量: 100 })
  assert.equal(stepStaminaCost(s), 8)
})

test('消耗至少为 1，不会被减到 0 或负数', () => {
  const s = 状态({ 负重: 0, 海拔: 1700 })
  s.pack.push({ gearId: 'trekking_poles', 档: '通用', 数量: 1, 单重: 0.5, 余量: 100 })
  assert.ok(stepStaminaCost(s) >= 1)
})

test('适应判定：高海拔过夜满 1 晚即适应', () => {
  assert.equal(isAcclimatized(状态({ 高海拔过夜数: 0 })), false)
  assert.equal(isAcclimatized(状态({ 高海拔过夜数: 1 })), true)
})

test('applyStepCost 扣体力且不低于 0', () => {
  const s = 状态({ pc: { 体力: 5 }, 负重: 26.8, 海拔: 3500, 高海拔过夜数: 2 })
  applyStepCost(s)
  assert.equal(s.pc.体力, 0)
})

test('休整 +8，带折凳 +10，上限 100', () => {
  const s = 状态({ pc: { 体力: 50 } })
  rest(s)
  assert.equal(s.pc.体力, 58)

  s.pack.push({ gearId: 'camp_stool', 档: '通用', 数量: 1, 单重: 0.5, 余量: 100 })
  s.pc.体力 = 50
  rest(s)
  assert.equal(s.pc.体力, 60)

  s.pc.体力 = 96
  rest(s)
  assert.equal(s.pc.体力, 100)
})

test('热食 +6 并消耗气罐 8% 与一份冻干', () => {
  const s = 状态({ pc: { 体力: 50 } })
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 2, 单重: 1.2, 余量: 100 })

  assert.equal(eatHot(s), true)
  assert.equal(s.pc.体力, 56)
  assert.equal(s.pack.find((p) => p.gearId === 'stove').余量, 92)
  assert.equal(s.pack.find((p) => p.gearId === 'freeze_dried').数量, 1)
})

test('没炉头或没冻干就吃不了热食', () => {
  const s = 状态({ pc: { 体力: 50 } })
  assert.equal(eatHot(s), false)
  assert.equal(s.pc.体力, 50)
})

test('冷食 +3 并消耗一份路餐', () => {
  const s = 状态({ pc: { 体力: 50 } })
  s.pack.push({ gearId: 'trail_snack', 档: '通用', 数量: 1, 单重: 1.0, 余量: 100 })
  assert.equal(eatCold(s), true)
  assert.equal(s.pc.体力, 53)
  assert.equal(s.pack.some((p) => p.gearId === 'trail_snack'), false)
})

test('睡眠：有帐篷睡袋且在营地 +25，有水源的正规营地再 +5', () => {
  const s = 状态({ pc: { 体力: 50 }, 海拔: 3100 })
  s.place.nodeId = 'shuiwozi'
  s.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  sleep(s, { 恶劣天气: false })
  assert.equal(s.pc.体力, 80, '水窝子有水源：25 + 5')

  // 东源可扎营但无水源，只有基础 25
  const s2 = 状态({ pc: { 体力: 50 }, 海拔: 3400 })
  s2.place.nodeId = 'dongyuan'
  s2.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
  s2.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  sleep(s2, { 恶劣天气: false })
  assert.equal(s2.pc.体力, 75)
})

test('睡眠：缺装备或恶劣天气减半', () => {
  const s = 状态({ pc: { 体力: 50 }, 海拔: 3100 })
  s.place.nodeId = 'shuiwozi'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.pc.体力, 62)
})

test('在 3000 米以上营地过夜会累计适应晚数', () => {
  const s = 状态({ 海拔: 3100 })
  s.place.nodeId = 'shuiwozi'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.高海拔过夜数, 1)
})

test('在低海拔过夜不累计适应', () => {
  const s = 状态({ 海拔: 1700 })
  s.place.nodeId = 'tangkou'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.高海拔过夜数, 0)
})

test('时段推进：早→中→晚→次日早', () => {
  const s = 状态()
  assert.deepEqual(advanceSlot(s).clock, { day: 1, slot: '中' })
  assert.deepEqual(advanceSlot(s).clock, { day: 1, slot: '晚' })
  assert.deepEqual(advanceSlot(s).clock, { day: 2, slot: '早' })
})

test('气罐烧完换备用罐，炉头不会跟着丢掉', () => {
  const s = 状态({ pc: { 体力: 0 } })
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 60, 单重: 1.2, 余量: 100 })

  let 顿数 = 0
  while (eatHot(s)) 顿数++
  assert.equal(顿数, 12, `一罐 8%/顿应做 12 顿，实为 ${顿数}`)
  assert.ok(s.pack.some((p) => p.gearId === 'stove'), '没气了也不该把炉头丢掉')
})

test('带备用气罐能多做热食——买备用不是白买', () => {
  const s = 状态({ pc: { 体力: 0 } })
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'extra_canister', 档: '通用', 数量: 2, 单重: 0.5, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 60, 单重: 1.2, 余量: 100 })

  let 顿数 = 0
  while (eatHot(s)) 顿数++
  assert.equal(顿数, 36, `自带罐 + 2 备用罐应做 36 顿，实为 ${顿数}`)
  assert.ok(!s.pack.some((p) => p.gearId === 'extra_canister'), '备用罐应已用尽')
})

test('主粮耗尽后自动启用额外主粮', () => {
  const s = 状态()
  s.pack.find((p) => p.gearId === 'staple_food').数量 = 3
  s.pack.push({ gearId: 'extra_staple', 档: '通用', 数量: 4, 单重: 1.2, 余量: 100 })

  assert.deepEqual(dailyUpkeep(s), { 断粮: false, 欠缺: 0 })
  assert.equal(s.pack.find((p) => p.gearId === 'staple_food').数量, 1)

  // 主粮只剩 1 份，缺口由额外主粮补上
  dailyUpkeep(s)
  assert.ok(!s.pack.some((p) => p.gearId === 'staple_food'), '主粮应已耗尽')
  assert.equal(s.pack.find((p) => p.gearId === 'extra_staple').数量, 3)

  dailyUpkeep(s)
  assert.equal(s.pack.find((p) => p.gearId === 'extra_staple').数量, 1)

  const 最后 = dailyUpkeep(s)
  assert.equal(最后.断粮, true)
  assert.equal(最后.欠缺, 1, '最后一天只吃到 1 份')
})

test('每日结算扣 2 份主粮，不足则扣到 0', () => {
  const s = 状态()
  dailyUpkeep(s)
  assert.equal(s.pack.find((p) => p.gearId === 'staple_food').数量, 2)
  dailyUpkeep(s)
  assert.equal(s.pack.some((p) => p.gearId === 'staple_food'), false)
  assert.equal(dailyUpkeep(s).断粮, true)
})

test('冬季没带睡袋过夜判为失温，连败计数递增', () => {
  const s = 状态({ 海拔: 3100 })
  s.meta.季节 = '冬季'
  s.place.nodeId = 'shuiwozi'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.失温连败, 1)
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.失温连败, 2)
})

test('睡袋够暖则连败归零', () => {
  const s = 状态({ 海拔: 3100 })
  s.meta.季节 = '秋季'
  s.place.nodeId = 'shuiwozi'
  s.flags.失温连败 = 2
  s.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  sleep(s, { 恶劣天气: false })
  // 秋季夜间 -6℃，睡袋温标 -10℃ 够用
  assert.equal(s.flags.失温连败, 0)
})

test('内胆真的顶用：冬季 -25℃ 下把有效温标从 -10 拉到 -15', () => {
  const 造 = (带内胆) => {
    const s = 状态({ 海拔: 3100 })
    s.meta.季节 = '冬季'
    s.place.nodeId = 'shuiwozi'
    s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
    if (带内胆) s.pack.push({ gearId: 'bag_liner', 档: '通用', 数量: 1, 单重: 0.3, 余量: 100 })
    return s
  }
  // 冬季 -25℃ 下两者都不够，但有效温标必须随内胆变化
  assert.equal(effectiveWarmth(造(false)), -10)
  assert.equal(effectiveWarmth(造(true)), -15)
})

test('春季 -8℃ 下内胆足以扭转失温判定', () => {
  const 造 = (带内胆) => {
    const s = 状态({ 海拔: 3100 })
    s.meta.季节 = '春季'
    s.place.nodeId = 'shuiwozi'
    // 只带睡袋时有效温标 -10，春季 -8 已经够用；这里用没带睡袋对照
    if (带内胆) {
      s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
    }
    return s
  }
  sleep(造(false), {})
  const 有 = 造(true)
  sleep(有, {})
  assert.equal(有.flags.失温连败, 0, '带了睡袋的春季不该失温')
})

test('没带睡袋时有效温标记为毫无保暖', () => {
  const s = 状态({ 海拔: 3100 })
  assert.equal(effectiveWarmth(s), 99)
})

test('有极寒睡袋时取最暖的那件算有效温标', () => {
  const s = 状态({ 海拔: 3100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  assert.equal(effectiveWarmth(s), -10)
  s.pack.push({ gearId: 'winter_bag', 档: '通用', 数量: 1, 单重: 1.8, 余量: 100 })
  assert.equal(effectiveWarmth(s), -25, '带了极寒睡袋却还按普通睡袋算')
})

test('冬季带极寒睡袋不再失温', () => {
  const s = 状态({ 海拔: 3100 })
  s.meta.季节 = '冬季'
  s.place.nodeId = 'shuiwozi'
  s.pack.push({ gearId: 'winter_bag', 档: '通用', 数量: 1, 单重: 1.8, 余量: 100 })
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.失温连败, 0)
})
