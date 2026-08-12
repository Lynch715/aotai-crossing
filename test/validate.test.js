import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveNpc, clampRequire, clampCost, validateProposal, CLAMP_TABLE } from '../src/llm/validate.js'

function 状态() {
  return {
    place: { nodeId: 'maijieling', 海拔: 3500 },
    party: [
      { npcId: 'linxiaoya', 好感: 62, 在队: true },
      { npcId: 'chenyan', 好感: 45, 在队: true },
    ],
    pack: [{ gearId: 'rope', 数量: 1, 单重: 1.6 }],
  }
}

test('人物中文名映射回 id', () => {
  assert.equal(resolveNpc('林晓雅'), 'linxiaoya')
  assert.equal(resolveNpc('陈岩'), 'chenyan')
  assert.equal(resolveNpc('linxiaoya'), 'linxiaoya', 'id 原样传入也认')
  assert.equal(resolveNpc('查无此人'), null)
  assert.equal(resolveNpc(''), null)
  assert.equal(resolveNpc(null), null)
})

test('社交类经验门槛夹到 0-30', () => {
  const { require: r, warnings } = clampRequire('社交', { 经验: 80 })
  assert.equal(r.经验, CLAMP_TABLE.社交.经验[1])
  assert.equal(r.经验, 30)
  assert.equal(warnings.length, 1)
})

test('徒步类经验门槛低于下限时抬到下限', () => {
  assert.equal(clampRequire('徒步', { 经验: 5 }).require.经验, 20)
})

test('高危类好感门槛夹到 70', () => {
  const { require: r } = clampRequire('高危', { 好感: { linxiaoya: 95 } })
  assert.equal(r.好感.linxiaoya, 70)
})

test('门槛在范围内时原样保留，不产生 warning', () => {
  const { require: r, warnings } = clampRequire('徒步', { 经验: 60, 好感: { linxiaoya: 50 } })
  assert.equal(r.经验, 60)
  assert.equal(r.好感.linxiaoya, 50)
  assert.deepEqual(warnings, [])
})

test('未知类型按徒步处理', () => {
  assert.equal(clampRequire('胡编的类型', { 经验: 99 }).require.经验, 75)
})

test('好感提议：名字映射、幅度交由引擎夹取', () => {
  const p = { 好感: [{ npc: '林晓雅', delta: 3, 因: '你退后让她先过' }] }
  const r = validateProposal(状态(), p)
  assert.equal(r.好感变更.length, 1)
  assert.equal(r.好感变更[0].npcId, 'linxiaoya')
  assert.equal(r.好感变更[0].delta, 3)
  assert.equal(r.好感变更[0].重大, false)
})

test('带重大标记的好感提议被识别', () => {
  const p = { 好感: [{ npc: '陈岩', delta: 15, 重大: true, 因: '他把你从石缝里拽了上来' }] }
  assert.equal(validateProposal(状态(), p).好感变更[0].重大, true)
})

test('对不在队/不存在的人的好感提议被驳回', () => {
  const p = { 好感: [{ npc: '王大鹏', delta: 5 }, { npc: '孙悟空', delta: 5 }] }
  const r = validateProposal(状态(), p)
  assert.equal(r.好感变更.length, 0)
  assert.equal(r.warnings.length, 2)
})

test('delta 非数字被驳回', () => {
  const r = validateProposal(状态(), { 好感: [{ npc: '林晓雅', delta: '很多' }] })
  assert.equal(r.好感变更.length, 0)
  assert.ok(r.warnings[0].includes('delta'))
})

test('选项里引用不存在的物品被驳回，其余照常', () => {
  const p = { 选项: [
    { id: 'A', 类型: '徒步', require: { 物品: ['rope'] }, cost: { 体力: 10 } },
    { id: 'B', 类型: '徒步', require: { 物品: ['光剑'] }, cost: { 体力: 10 } },
  ] }
  const r = validateProposal(状态(), p)
  assert.equal(r.选项.length, 2)
  assert.deepEqual(r.选项[0].require.物品, ['rope'])
  assert.deepEqual(r.选项[1].require.物品, [], '不存在的物品应被剔除')
  assert.ok(r.warnings.some((w) => w.includes('光剑')))
})

test('选项 id 非法被丢弃', () => {
  const r = validateProposal(状态(), { 选项: [{ id: 'X', 类型: '社交' }, { id: 'A', 类型: '社交' }] })
  assert.equal(r.选项.length, 1)
  assert.equal(r.选项[0].id, 'A')
})

test('选项好感门槛的人名同样被映射', () => {
  const p = { 选项: [{ id: 'A', 类型: '社交', require: { 好感: { 林晓雅: 40 } } }] }
  const r = validateProposal(状态(), p)
  assert.equal(r.选项[0].require.好感.linxiaoya, 40)
})

test('去向必须是合法相邻节点', () => {
  assert.equal(validateProposal(状态(), { 去向建议: '水窝子营地' }).去向, 'shuiwozi')
  assert.equal(validateProposal(状态(), { 去向建议: 'shuiwozi' }).去向, 'shuiwozi')
  assert.equal(validateProposal(状态(), { 去向建议: '下板寺' }).去向, null, '隔着大半条线不该允许')
  assert.equal(validateProposal(状态(), { 去向建议: '珠穆朗玛' }).去向, null)
})

test('去向不合法时记 warning', () => {
  const r = validateProposal(状态(), { 去向建议: '下板寺' })
  assert.ok(r.warnings.some((w) => w.includes('去向')))
})

test('记忆与伏笔原样透传，空白项被剔除', () => {
  const p = { 记忆: ['D4晚 麦秸岭 判定失败', '  ', ''], 伏笔: { 新增: ['雾里的人影'], 已收: ['石缝路标带'] } }
  const r = validateProposal(状态(), p)
  assert.deepEqual(r.记忆, ['D4晚 麦秸岭 判定失败'])
  assert.deepEqual(r.伏笔.新增, ['雾里的人影'])
  assert.deepEqual(r.伏笔.已收, ['石缝路标带'])
})

test('地名前缀必须唯一才认，含糊的一律驳回', () => {
  // 「大」同时前缀匹配 大爷海 与 大文公庙。必须站在大爷海的相邻节点上测，
  // 否则是相邻判定兜住了它，而不是唯一前缀规则在起作用。
  const 在拔仙台 = { ...状态(), place: { nodeId: 'baxiantai', 海拔: 3767 } }
  assert.equal(validateProposal(在拔仙台, { 去向建议: '大爷海' }).去向, 'dayehai', '精确名该认')
  assert.equal(validateProposal(在拔仙台, { 去向建议: '大' }).去向, null, '含糊前缀必须驳回')
  // 唯一前缀仍然认
  assert.equal(validateProposal({ ...状态(), place: { nodeId: 'yaowangdong', 海拔: 3360 } }, { 去向建议: '麦秸' }).去向, 'maijieling')
})

test('代价被夹取：负值归零，超限截断，未知项剔除', () => {
  const { cost, warnings } = clampCost({ 体力: -50, 时段: 99, 金钱: 200, 玄学: 1, 运气: '爆棚' })
  assert.equal(cost.体力, 0, '负代价等于白送体力')
  assert.equal(cost.时段, 3)
  assert.equal(cost.金钱, 200)
  assert.equal(cost.玄学, undefined)
  assert.equal(cost.运气, undefined)
  assert.ok(warnings.length >= 4)
})

test('选项里的代价同样过夹取', () => {
  const r = validateProposal(状态(), { 选项: [{ id: 'A', 类型: '徒步', cost: { 体力: -20 } }] })
  assert.equal(r.选项[0].cost.体力, 0)
  assert.ok(r.warnings.some((w) => w.includes('体力')))
})

test('非数字的好感门槛会报 warning，不静默丢弃', () => {
  const { warnings } = clampRequire('社交', { 好感: { linxiaoya: '很高' } })
  assert.ok(warnings.some((w) => w.includes('不是数字')), `实得 warnings: ${warnings}`)
})

test('state 畸形时同样不抛异常', () => {
  const 提议 = { 好感: [{ npc: '林晓雅', delta: 3 }], 去向建议: '水窝子营地' }
  for (const bad of [null, undefined, {}, { party: null }, { place: {} }, 42]) {
    assert.doesNotThrow(() => validateProposal(bad, 提议), `炸在 state = ${JSON.stringify(bad)}`)
    const r = validateProposal(bad, 提议)
    assert.deepEqual(r.好感变更, [], 'state 不可信时不该放行好感变更')
    assert.equal(r.去向, null)
  }
})

test('空提议或 null 提议返回空结构，不炸', () => {
  for (const p of [null, undefined, {}, 42, []]) {
    const r = validateProposal(状态(), p)
    assert.deepEqual(r.好感变更, [])
    assert.deepEqual(r.选项, [])
    assert.equal(r.去向, null)
  }
})

test('validateProposal 从不抛异常', () => {
  const 恶意 = [
    { 好感: '不是数组' },
    { 选项: [null, undefined, 42] },
    { 伏笔: '不是对象' },
    { 选项: [{ id: 'A', require: { 好感: '不是对象' } }] },
  ]
  for (const p of 恶意) {
    assert.doesNotThrow(() => validateProposal(状态(), p), JSON.stringify(p))
  }
})

function 局面() {
  return {
    place: { nodeId: 'maijieling', 海拔: 3500 },
    party: [
      { npcId: 'chenyan', 好感: 45, 在队: true },
      { npcId: 'wangdapeng', 好感: 30, 在队: true },
    ],
    pack: [],
  }
}

test('离队提议按名字解析，写进 离队', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '王大鹏', 因: '膝伤严重，从水窝子下撤' }] })
  assert.equal(r.离队.length, 1)
  assert.equal(r.离队[0].npcId, 'wangdapeng')
  assert.ok(r.离队[0].因.includes('膝伤'))
})

test('认不出的人不当离队处理，记 warning', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '张三丰', 因: 'x' }] })
  assert.deepEqual(r.离队, [])
  assert.ok(r.warnings.some((w) => w.includes('张三丰')))
})

test('本就不在队伍里的人不能被离队', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '踏雪', 因: 'x' }] })
  assert.deepEqual(r.离队, [])
  assert.ok(r.warnings.length > 0)
})

test('已经离队的人不会被重复处理', () => {
  const s = 局面()
  s.party.find((p) => p.npcId === 'chenyan').在队 = false
  const r = validateProposal(s, { 离队: [{ npc: '陈岩', 因: '又走一次' }] })
  assert.deepEqual(r.离队, [])
})

test('离队原因过长会被截断', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '陈岩', 因: '啊'.repeat(200) }] })
  assert.ok(r.离队[0].因.length <= 30, `没截断：${r.离队[0].因.length}`)
})

test('没有离队字段时 离队 是空数组而不是 undefined', () => {
  assert.deepEqual(validateProposal(局面(), {}).离队, [])
})
