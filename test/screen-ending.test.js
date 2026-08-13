import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endingViewModel } from '../src/ui/screen-ending.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal, recordNode, recordEvent } from '../src/engine/journal.js'
import { FINE_AMOUNT } from '../src/engine/ending.js'

function 收场(type) {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 72 }, { npcId: 'linxiaoya', 好感: 31 }],
    背包: [], 金钱: 4320,
  })
  s.clock = { day: 7, slot: '晚' }
  s.phase = '结局'
  s.ending = { type, 原因: '测试' }
  const j = createJournal()
  recordNode(j, 'tangkou'); recordNode(j, 'shuiwozi'); recordNode(j, 'maijieling')
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝伤复发')
  return { s, j }
}

test('三种结局各有标题与定性', () => {
  for (const t of ['失败遇险', '被救援', '成功穿越']) {
    const { s, j } = 收场(t)
    const vm = endingViewModel(s, j)
    assert.ok(vm.标题, `${t} 缺标题`)
    assert.equal(vm.type, t)
    assert.ok(['惨败', '生还', '完成'].includes(vm.定性), `${t} 定性不合法：${vm.定性}`)
  }
})

test('成功穿越要写明罚款 5000——文档定死的', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.罚款, FINE_AMOUNT)
  assert.ok(vm.说明.includes(String(FINE_AMOUNT)), '说明里没写出罚款金额')
})

test('失败与被救援不罚款', () => {
  for (const t of ['失败遇险', '被救援']) {
    assert.equal(endingViewModel(收场(t).s, 收场(t).j).罚款, 0)
  }
})

test('回顾列出走过的节点，用中文名不是 id', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.回顾.节点.length, 3)
  assert.ok(vm.回顾.节点.includes('麦秸岭'), `节点没转中文名：${vm.回顾.节点}`)
})

test('回顾列出关键事件与天数', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.回顾.事件.length, 1)
  assert.equal(vm.回顾.天数, 7)
})

test('最终好感按高到低排，带分级标签', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.回顾.好感[0].名称, '陈岩')
  assert.equal(vm.回顾.好感[0].好感, 72)
  assert.equal(vm.回顾.好感[0].分级, '信任')
})

test('没有结局时返回 null，而不是编一个出来', () => {
  const { s, j } = 收场('成功穿越')
  s.phase = '徒步'
  s.ending = null
  assert.equal(endingViewModel(s, j), null)
})

test('主动下撤有自己的文案，不能白屏', () => {
  const { s, j } = 收场('主动下撤')
  const vm = endingViewModel(s, j)
  assert.ok(vm, '主动下撤返回了 null —— 玩家会看到空白结局页')
  assert.equal(vm.定性, '生还')
  assert.equal(vm.罚款, 0)
  assert.ok(vm.标题.length > 0)
})

test('未知结局类型也给页面，不留白屏', () => {
  const { s, j } = 收场('将来才有的新结局')
  const vm = endingViewModel(s, j)
  assert.ok(vm, '未知类型返回了 null')
  assert.ok(vm.标题.length > 0)
})

test('回顾给出走到过的最高点', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.ok(vm.回顾.最高点, '缺最高点')
  assert.equal(vm.回顾.最高点.名称, '麦秸岭')
  assert.equal(vm.回顾.最高点.海拔, 3500)
})

test('没走过任何节点时最高点为 null 而不是崩', () => {
  const { s } = 收场('失败遇险')
  const vm = endingViewModel(s, createJournal())
  assert.equal(vm.回顾.最高点, null)
})
