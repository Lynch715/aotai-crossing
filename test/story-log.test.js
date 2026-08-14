import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInitialState } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'
import { getNode } from '../src/data/route.js'
import { routeMapViewModel } from '../src/ui/screen-game.js'
import { storyPoint, makeTurnStoryEntry, makeActionStoryEntry, formatStoryLog } from '../src/ui/story-log.js'

function 局面(nodeId = 'maijieling', slot = '中') {
  const state = createInitialState({
    种子: 17, 季节: '秋季', 起点: 'tangkou',
    pc: { 名字: '林川', 职业: '摄影师', 年龄: 27, 性别: '男', 性格: 'renside', 外貌: '', 技能: [], 户外经验: 42 },
    队友: [], 背包: [], 金钱: 1000,
  })
  state.place.nodeId = nodeId
  state.place.海拔 = getNode(nodeId).海拔
  state.clock.slot = slot
  return state
}

test('路线图显示 18 个决策节点、当前位置和今晚营地', () => {
  const vm = routeMapViewModel(局面())
  assert.equal(vm.节点.length, 18)
  assert.equal(vm.节点.find((n) => n.状态 === '当前位置').id, 'maijieling')
  assert.equal(vm.节点.find((n) => n.是今晚营地).id, 'shuiwozi')
  assert.equal(vm.今晚营地, '水窝子营地')
})

test('路线图标出全部计划营地与 2800 营地两条下撤线', () => {
  const vm = routeMapViewModel(局面('yingdi2800', '晚'))
  assert.deepEqual(vm.节点.filter((n) => n.是计划营地).map((n) => n.id), [
    'yingdi2900', 'shuiwozi', 'yingdi2800', 'dongyuan', 'dayehai',
  ])
  assert.deepEqual(vm.节点.find((n) => n.id === 'yingdi2800').下撤.map((n) => n.id).sort(), ['hetaoping', 'songpingsi'])
})

test('故事条目保留回合前后时空、选择、剧情和诊断材料', () => {
  const state = 局面()
  const 开始 = storyPoint(state)
  state.place.nodeId = 'shuiwozi'
  state.place.海拔 = 3100
  state.clock.slot = '晚'
  const e = makeTurnStoryEntry({
    序号: 2, 开始, 结束: storyPoint(state),
    选中项: { id: 'A', 文本: '稳妥前进', 类型: '徒步' },
    回合: { 标题: '抵达水窝子', 剧情: '天黑前，你们抵达营地。', 万象: ['山风增强'], 生存提示: ['体力 -8'], warnings: ['测试警告'], 原文: 'RAW', 判定: { outcome: 'success' } },
  })
  assert.equal(e.开始.地点, '麦秸岭')
  assert.equal(e.结束.地点, '水窝子营地')
  assert.equal(e.判定, '成功')
  const 普通 = formatStoryLog([e], state)
  const 排错 = formatStoryLog([e], state, { debug: true, journal: createJournal() })
  assert.ok(普通.includes('第1天中｜麦秸岭'))
  assert.ok(!普通.includes('模型原始回复'))
  assert.ok(排错.includes('RAW'))
  assert.ok(排错.includes('当前游戏状态'))
})

test('营地行动也进入完整故事且能记录跨夜', () => {
  const state = 局面('shuiwozi', '晚')
  const 开始 = storyPoint(state)
  state.clock.day = 2
  state.clock.slot = '早'
  const e = makeActionStoryEntry({ 序号: 3, 开始, 结束: storyPoint(state), 动作: '原地休整', 反馈: '已过夜' })
  assert.equal(e.开始.day, 1)
  assert.equal(e.结束.day, 2)
  assert.ok(formatStoryLog([e], state).includes('第1天晚｜水窝子营地 3100m → 第2天早｜水窝子营地 3100m'))
})
