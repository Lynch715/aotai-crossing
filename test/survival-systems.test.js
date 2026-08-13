import { test } from 'node:test'
import assert from 'node:assert/strict'
import { campPressure, getNode } from '../src/data/route.js'
import { createInitialState, addItem } from '../src/engine/state.js'
import { 调整体温, 调整高反, stepStaminaCost, sleep, eatHot } from '../src/engine/consume.js'
import { checkEnding } from '../src/engine/ending.js'
import { applyTravelRisks } from '../src/turn.js'
import { panelViewModel } from '../src/ui/screen-game.js'
import { endingViewModel } from '../src/ui/screen-ending.js'
import { createJournal } from '../src/engine/journal.js'
import { migrateSave } from '../src/ui/save.js'

function 状态({ 季节 = '秋季', nodeId = 'shuiwozi', slot = '早', 体力 = 80 } = {}) {
  const s = createInitialState({
    种子: 7, 季节,
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
      外貌: '偏瘦', 技能: [], 户外经验: 45 },
    队友: [{ npcId: 'chenyan', 好感: 65 }, { npcId: 'linxiaoya', 好感: 61 }],
    背包: [], 金钱: 5000,
  })
  s.place = { nodeId, 海拔: getNode(nodeId).海拔 }
  s.clock = { day: 2, slot }
  s.pc.体力 = 体力
  return s
}

const 成功 = { outcome: 'success' }
const 徒步 = { 类型: '徒步' }

test('营地截止账：准点赶路、浪费时段后赶不上、抵达晚间三种状态', () => {
  assert.equal(campPressure('yingdi2900', '早').状态, '紧迫')
  assert.equal(campPressure('yingdi2900', '中').状态, '赶不上')
  assert.equal(campPressure('shuiwozi', '晚').状态, '已抵达')
  assert.equal(campPressure('tangkou', '早').状态, '宽裕')
})

test('野外迫降会留下次数、体温与额外体力后果', () => {
  const s = 状态({ nodeId: 'maijieling', slot: '晚', 体力: 50 })
  addItem(s, 'tent', '主流', 1)
  addItem(s, 'sleeping_bag', '主流', 1)
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.野外迫降次数, 1)
  assert.equal(s.pc.体温, '发冷')
  assert.ok(s.pc.体力 < 54, `非营地不能按普通睡眠白赚体力：${s.pc.体力}`)
})

test('体温与高反是离散状态且会实质拖累行军', () => {
  const s = 状态()
  const 基础 = stepStaminaCost(s)
  调整体温(s, 2)
  调整高反(s, 2)
  assert.equal(s.pc.体温, '失温')
  assert.equal(s.pc.高反, '中度')
  assert.ok(stepStaminaCost(s) >= 基础 + 6)
  assert.equal(s.flags.最重体温, 2)
  assert.equal(s.flags.最重高反, 2)
})

test('热食能解除发冷，但不能把真正失温当普通体力药治好', () => {
  const s = 状态({ 体力: 40 })
  addItem(s, 'stove', '主流', 1)
  addItem(s, 'freeze_dried', '主流', 2)
  调整体温(s, 1)
  eatHot(s)
  assert.equal(s.pc.体温, '正常')
  调整体温(s, 2)
  eatHot(s)
  assert.equal(s.pc.体温, '失温')
})

test('快速拔高会触发显性高反，严重失温和重度高反会结束本局', () => {
  const s = 状态({ nodeId: 'yingdi2900' })
  applyTravelRisks(s, 徒步, 成功, () => 0, getNode('aoshan'))
  assert.equal(s.pc.高反, '轻度')
  s.pc.高反 = '重度'
  s.place = { nodeId: 'aoshan', 海拔: 3475 }
  assert.equal(checkEnding(s).type, '失败遇险')
  s.pc.高反 = '无'
  s.pc.体温 = '严重失温'
  assert.equal(checkEnding(s).type, '失败遇险')
})

test('麦秸岭是滑坠伤，飞机梁是疲劳与降温，金字塔是攀爬伤', () => {
  const 麦 = 状态({ nodeId: 'maijieling' })
  麦.flags.高海拔过夜数 = 1
  applyTravelRisks(麦, 徒步, 成功, () => 0, getNode('shuiwozi'))
  assert.equal(麦.pc.伤病[0].名称, '麦秸岭滑坠伤')

  const 飞 = 状态({ nodeId: 'feijiliang1', 体力: 70 })
  飞.flags.高海拔过夜数 = 1
  飞.weather.等级 = 5
  const 飞前 = 飞.pc.体力
  applyTravelRisks(飞, 徒步, 成功, () => 1, getNode('feijiliang3'))
  assert.equal(飞.pc.体力, 飞前 - 4)
  assert.equal(飞.pc.体温, '发冷')

  const 塔 = 状态({ nodeId: 'jinzita1' })
  塔.flags.高海拔过夜数 = 1
  applyTravelRisks(塔, 徒步, 成功, () => 0, getNode('jiuchongshihai2'))
  assert.equal(塔.pc.伤病[0].名称, '金字塔攀爬伤')
})

test('九重石海同时压体力与脚伤；万仙阵分别结算迷路和跑马梁风雨', () => {
  const 石 = 状态({ nodeId: 'jiuchongshihai2', 体力: 70 })
  石.flags.高海拔过夜数 = 1
  const 前 = 石.pc.体力
  applyTravelRisks(石, 徒步, 成功, () => 0, getNode('dongyuan'))
  assert.equal(石.pc.体力, 前 - 6)
  assert.equal(石.pc.伤病[0].名称, '石海崴伤')

  const 迷 = 状态({ nodeId: 'wanxianzhen' })
  迷.flags.高海拔过夜数 = 1
  const r1 = applyTravelRisks(迷, 徒步, 成功, () => 0, getNode('baxiantai'))
  assert.equal(r1.迷路, true)
  assert.equal(迷.flags.迷路次数, 1)

  const 风 = 状态({ nodeId: 'wanxianzhen' })
  风.flags.高海拔过夜数 = 1
  风.weather.等级 = 7
  const r2 = applyTravelRisks(风, 徒步, 成功, () => 1, getNode('baxiantai'))
  assert.equal(r2.迷路, false)
  assert.equal(风.pc.体温, '失温')
})

test('面板常驻显示体温、高反和今晚营地账', () => {
  const s = 状态({ nodeId: 'yingdi2900', slot: '中' })
  s.pc.体温 = '发冷'
  s.pc.高反 = '轻度'
  const vm = panelViewModel(s)
  assert.equal(vm.体温, '发冷')
  assert.equal(vm.高反, '轻度')
  assert.equal(vm.营地压力.营地.id, 'shuiwozi')
  assert.equal(vm.营地压力.状态, '赶不上')
})

test('结算可同时给出过程称号和新增生存统计', () => {
  const s = 状态({ nodeId: 'xiabansi' })
  s.phase = '结局'
  s.ending = { type: '成功穿越', 原因: '抵达下板寺' }
  s.clock.day = 6
  s.flags.高危尝试次数 = 4
  s.flags.高危成功次数 = 3
  s.flags.最重体温 = 2
  s.flags.最重高反 = 1
  s.flags.野外迫降次数 = 1
  const vm = endingViewModel(s, createJournal())
  assert.ok(vm.称号列表.includes('秦岭老驴'))
  assert.ok(vm.称号列表.includes('毫发无伤'))
  assert.ok(vm.称号列表.includes('赌徒'))
  assert.equal(vm.回顾.最重体温, '失温')
  assert.equal(vm.回顾.野外迫降次数, 1)
})

test('v3 存档迁移后保留旧失温进度并补齐新字段', () => {
  const r = migrateSave({
    版本: 3, 摘要: '旧档', journal: {},
    state: { pc: { 体力: 50 }, flags: { 失温连败: 2 } },
  })
  assert.equal(r.包.state.pc.体温, '失温')
  assert.equal(r.包.state.pc.高反, '无')
  assert.equal(r.包.state.flags.野外迫降次数, 0)
})
