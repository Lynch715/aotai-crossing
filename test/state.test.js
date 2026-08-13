import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, recalcCarry, addItem, removeItem,
  consumeItem, hasItem, snapshot, restore, STATE_VERSION,
} from '../src/engine/state.js'

function 基础状态() {
  return createInitialState({
    种子: 42,
    季节: '秋季',
    pc: { 名字: '周野', 职业: '户外器材工程师', 年龄: 28, 性别: '男',
          性格: 'renside', 外貌: '偏瘦，晒得黑', 技能: ['装备维修'], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 30 }, { npcId: 'linxiaoya', 好感: 28 }],
    背包: [{ gearId: 'backpack', 档: '主流', 数量: 1 }, { gearId: 'staple_food', 档: '主流', 数量: 1 }],
    金钱: 4320,
  })
}

test('初始状态字段齐备', () => {
  const s = 基础状态()
  assert.equal(s.meta.版本, STATE_VERSION)
  assert.equal(s.meta.季节, '秋季')
  assert.equal(s.meta.随机种子, 42)
  assert.equal(s.phase, '徒步')
  assert.deepEqual(s.clock, { day: 1, slot: '早' })
  assert.equal(s.place.nodeId, 'tangkou')
  assert.equal(s.place.海拔, 1700)
  assert.equal(s.pc.体力, 100)
  assert.equal(s.money, 4320)
  assert.equal(s.carry.上限, 30)
  assert.equal(s.party.length, 2)
  assert.equal(s.flags.已求救, false)
  assert.equal(s.flags.高海拔过夜数, 0)
  assert.equal(s.flags.失温连败, 0, '结局判定要读这个计数器，初始化时不能漏')
})

test('背包条目补齐单重，负重按单重×数量算', () => {
  const s = 基础状态()
  const 包 = s.pack.find((p) => p.gearId === 'backpack')
  assert.equal(包.单重, 2.1)
  // 主粮是分份物品：单重 = 整包 2.0kg ÷ 14 份 ≈ 0.143。
  // 背包 2.1 + 1 份主粮 0.143 ≈ 2.24
  assert.equal(s.carry.当前, 2.24)
})

test('分份物品按整包份数入包时，总重等于整包重量', () => {
  const s = 基础状态()
  removeItem(s, 'staple_food', 99)
  addItem(s, 'staple_food', '主流', 14)
  // 14 × 0.143 = 2.002 → 保留两位 2.0（±0.01 的量化误差可接受）
  assert.ok(Math.abs(s.carry.当前 - (2.1 + 2.0)) <= 0.01, `总重漂了: ${s.carry.当前}`)
})

test('addItem 累加数量并重算负重', () => {
  const s = 基础状态()
  addItem(s, 'ibuprofen', '基础', 1)
  assert.equal(s.carry.当前, 2.29)
  addItem(s, 'ibuprofen', '基础', 2)
  assert.equal(s.pack.find((p) => p.gearId === 'ibuprofen').数量, 3)
  assert.equal(s.carry.当前, 2.39)
})

test('removeItem 扣到 0 就摘出背包', () => {
  const s = 基础状态()
  removeItem(s, 'staple_food', 1)
  assert.equal(hasItem(s, 'staple_food'), false)
  assert.equal(s.carry.当前, 2.1)
})

test('removeItem 扣不出负数', () => {
  const s = 基础状态()
  removeItem(s, 'staple_food', 99)
  assert.equal(hasItem(s, 'staple_food'), false)
})

test('removeItem 对不存在的物品是安全的空操作', () => {
  const s = 基础状态()
  const 原重 = s.carry.当前
  removeItem(s, '查无此物', 1)
  assert.equal(s.carry.当前, 原重)
})

test('consumeItem 按余量百分比消耗，归零后摘出', () => {
  const s = 基础状态()
  addItem(s, 'stove', '主流', 1)
  assert.equal(consumeItem(s, 'stove', 8), true)
  assert.equal(s.pack.find((p) => p.gearId === 'stove').余量, 92)
  for (let i = 0; i < 12; i++) consumeItem(s, 'stove', 8)
  assert.equal(hasItem(s, 'stove'), false)
})

test('consumeItem 对没有的物品返回 false', () => {
  const s = 基础状态()
  assert.equal(consumeItem(s, 'stove', 8), false)
})

test('写入层拒收脏数量与脏百分比', () => {
  const s = 基础状态()
  const 原重 = s.carry.当前

  // 不含 undefined：它会触发默认参数 数量 = 1，那是有意的
  for (const 坏值 of [0, -1, NaN, Infinity, '三个', null]) {
    assert.equal(addItem(s, 'ibuprofen', '基础', 坏值), false, `addItem 收下了 ${坏值}`)
    assert.equal(removeItem(s, 'staple_food', 坏值), false, `removeItem 收下了 ${坏值}`)
  }
  assert.equal(s.carry.当前, 原重, '脏调用不该改动负重')

  // 负百分比等于凭空加满
  addItem(s, 'stove', '主流', 1)
  assert.equal(consumeItem(s, 'stove', -10), false)
  assert.equal(s.pack.find((p) => p.gearId === 'stove').余量, 100, '余量不该被负百分比抬高')
})

test('快照与回滚是深拷贝，互不影响', () => {
  const s = 基础状态()
  const snap = snapshot(s)
  s.pc.体力 = 12
  s.party[0].好感 = 99
  s.pack.push({ gearId: 'rope', 档: '通用', 数量: 1, 单重: 1.6 })

  const 回滚 = restore(snap)
  assert.equal(回滚.pc.体力, 100)
  assert.equal(回滚.party[0].好感, 30)
  assert.equal(回滚.pack.length, 2)
  // 回滚出来的对象再改，不该动到 snap
  回滚.pc.体力 = 1
  assert.equal(restore(snap).pc.体力, 100)
})

test('addItem 换档时同步更新档次与单重，不留旧值', () => {
  const s = 基础状态()
  // 基础状态里 backpack 是主流 2.1kg，经济档是 2.5kg
  addItem(s, 'backpack', '经济', 1)
  const 包 = s.pack.find((p) => p.gearId === 'backpack')
  assert.equal(包.档, '经济')
  assert.equal(包.单重, 2.5)
  assert.equal(包.数量, 2)
  // 2×2.5 + 1 份干粮 0.143 ≈ 5.14；若单重停留在旧档会算成 4.34
  assert.equal(s.carry.当前, 5.14)
})

test('起点不是合法节点时报出可读的错，而不是裸 TypeError', () => {
  assert.throws(
    () =>
      createInitialState({
        种子: 1, 季节: '秋季', 起点: '不存在的地方',
        pc: { 名字: '甲', 职业: '乙', 年龄: 30, 性别: '男', 性格: 'renside', 外貌: '丙', 技能: [], 户外经验: 10 },
        队友: [], 背包: [], 金钱: 100,
      }),
    /起点不是合法节点/
  )
})

test('recalcCarry 幂等', () => {
  const s = 基础状态()
  recalcCarry(s)
  recalcCarry(s)
  assert.equal(s.carry.当前, 2.24)
})

test('负重保留一位小数，不出浮点毛刺', () => {
  const s = 基础状态()
  addItem(s, 'emergency_blanket', '基础', 3)
  assert.equal(s.carry.当前, 2.39)
  assert.ok(String(s.carry.当前).length <= 5, `浮点毛刺: ${s.carry.当前}`)
})
