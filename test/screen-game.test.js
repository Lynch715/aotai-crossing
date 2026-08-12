import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelViewModel, optionDisplay, stageViewModel, gameViewModel } from '../src/ui/screen-game.js'
import { createInitialState } from '../src/engine/state.js'
import { UNREACHABLE } from '../src/engine/threshold.js'

function 局面() {
  const s = createInitialState({
    种子: 42, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: ['装备维修'], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'linxiaoya', 好感: 62 }],
    背包: [{ gearId: 'backpack', 档: '主流', 数量: 1 }, { gearId: 'staple_food', 档: '主流', 数量: 5 }],
    金钱: 4320,
  })
  s.clock = { day: 4, slot: '中' }
  s.place = { nodeId: 'maijieling', 海拔: 3500 }
  s.weather = { 状态: '大风', 等级: 6 }
  s.pc.体力 = 41
  return s
}

test('左栏带出角色、体力、负重、现金', () => {
  const vm = panelViewModel(局面())
  assert.equal(vm.名字, '周野')
  assert.equal(vm.体力, 41)
  assert.equal(vm.现金, 4320)
  assert.ok(vm.负重.当前 > 0)
  assert.equal(vm.负重.上限, 30)
})

test('负重接近上限时标黄，超了标红', () => {
  const s = 局面()
  assert.equal(panelViewModel(s).负重.档, '正常')
  s.carry.当前 = 27
  assert.equal(panelViewModel(s).负重.档, '偏重')
  s.carry.当前 = 31
  assert.equal(panelViewModel(s).负重.档, '超重')
})

test('体力低于 20 要给出警示——那是判定额外加 10 点难度的门槛', () => {
  const s = 局面()
  s.pc.体力 = 19
  const vm = panelViewModel(s)
  assert.equal(vm.体力告警, true)
  s.pc.体力 = 20
  assert.equal(panelViewModel(s).体力告警, false)
})

test('同行者带好感与分级标签，离队的不出现', () => {
  const s = 局面()
  const vm = panelViewModel(s)
  assert.equal(vm.同行者.length, 2)
  const 林 = vm.同行者.find((p) => p.npcId === 'linxiaoya')
  assert.equal(林.好感, 62)
  assert.ok(林.分级, '缺好感分级标签')

  s.party.find((p) => p.npcId === 'chenyan').在队 = false
  assert.equal(panelViewModel(s).同行者.length, 1)
})

test('背包按余量给出告警项', () => {
  const s = 局面()
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 12 })
  const vm = panelViewModel(s)
  const 炉 = vm.背包.find((i) => i.gearId === 'stove')
  assert.equal(炉.余量告警, true, '余量 12% 应告警')
})

test('选项达标：可点、无警示', () => {
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 30 } }, 局面())
  assert.equal(d.可点, true)
  assert.equal(d.档, '达标')
  assert.equal(d.概率文案, '')
})

test('选项勉强：可点、标黄、写出概率', () => {
  // 经验 38，门槛 43 → 差 5 → 0.62
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 43 } }, 局面())
  assert.equal(d.可点, true)
  assert.equal(d.档, '勉强')
  assert.ok(d.概率文案.includes('62'), `概率没写对：${d.概率文案}`)
})

test('选项差太远：置灰、写明差多少', () => {
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 60 } }, 局面())
  assert.equal(d.可点, false)
  assert.equal(d.档, '不可达')
  assert.ok(d.理由.includes('22'), `没写出差多少：${d.理由}`)
})

test('缺物品的选项置灰，理由点名缺什么', () => {
  const d = optionDisplay({ id: 'A', 文本: '爬', 类型: '徒步', require: { 物品: ['rope'] } }, 局面())
  assert.equal(d.可点, false)
  assert.ok(d.理由.includes('rope') || d.理由.includes('绳'), `理由没点名缺件：${d.理由}`)
})

test('理由首条是真正卡住玩家的那一条', () => {
  // 经验差 7、体力差 20 → 卡住的是体力
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 45, 体力: 61 } }, 局面())
  assert.ok(d.理由.includes('体力'), `首条理由应为体力：${d.理由}`)
})

test('无门槛的选项一律可点', () => {
  const d = optionDisplay({ id: 'B', 文本: '休整', 类型: '徒步' }, 局面())
  assert.equal(d.可点, true)
  assert.equal(d.档, '达标')
})

test('立绘舞台只列在队的人，说话人高亮', () => {
  const vm = stageViewModel(局面(), 'linxiaoya')
  assert.equal(vm.人物.length, 2)
  assert.equal(vm.人物.find((p) => p.npcId === 'linxiaoya').说话中, true)
  assert.equal(vm.人物.find((p) => p.npcId === 'chenyan').说话中, false)
})

test('没有说话人时无人高亮', () => {
  const vm = stageViewModel(局面(), null)
  assert.ok(vm.人物.every((p) => !p.说话中))
})

test('gameViewModel 把三块拼齐，并带出时间地点天气', () => {
  const vm = gameViewModel({
    state: 局面(),
    回合: { 标题: '刃脊上的三十米', 剧情: '甲\n\n乙', 万象: ['一', '二', '三', '四'],
            选项: [{ id: 'A', 文本: '走', 类型: '徒步', require: {} }] },
    说话人: 'chenyan',
  })
  assert.ok(vm.面板)
  assert.ok(vm.舞台)
  assert.equal(vm.标题, '刃脊上的三十米')
  assert.deepEqual(vm.段落, ['甲', '乙'])
  assert.equal(vm.万象.length, 4)
  assert.equal(vm.选项.length, 1)
  assert.equal(vm.顶栏.地点, '麦秸岭')
  assert.equal(vm.顶栏.海拔, 3500)
  assert.ok(vm.顶栏.时间.includes('第4天'))
  assert.ok(vm.顶栏.天气.includes('大风'))
})

test('gameViewModel 对空回合不炸——首次进入徒步阶段时还没有回合数据', () => {
  const vm = gameViewModel({ state: 局面(), 回合: null, 说话人: null })
  assert.deepEqual(vm.段落, [])
  assert.deepEqual(vm.选项, [])
  assert.ok(vm.面板, '面板不该因为没有回合就消失')
})
