import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setNpcStatus, npcLeaves, activeParty, isActive } from '../src/engine/party.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal, renderJournal } from '../src/engine/journal.js'

function 局面() {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'wangdapeng', 好感: 30 }],
    背包: [], 金钱: 5000,
  })
  return { s, j: createJournal() }
}

test('setNpcStatus 同时写 state 与 journal', () => {
  const { s, j } = 局面()
  setNpcStatus(s, j, 'chenyan', '轻度高反')
  assert.equal(s.party.find((p) => p.npcId === 'chenyan').状态, '轻度高反')
  assert.ok(renderJournal(j).includes('轻度高反'), '档案里也要有')
})

test('npcLeaves 置为不在队并同步状态', () => {
  const { s, j } = 局面()
  npcLeaves(s, j, 'wangdapeng', '膝伤下撤')
  const 王 = s.party.find((p) => p.npcId === 'wangdapeng')
  assert.equal(王.在队, false)
  assert.equal(王.状态, '膝伤下撤')
  assert.ok(renderJournal(j).includes('膝伤下撤'))
})

test('activeParty 只返回在队的人', () => {
  const { s, j } = 局面()
  assert.equal(activeParty(s).length, 2)
  npcLeaves(s, j, 'wangdapeng', '下撤')
  assert.deepEqual(activeParty(s).map((p) => p.npcId), ['chenyan'])
})

test('isActive 对离队者与查无此人都返回 false', () => {
  const { s, j } = 局面()
  assert.equal(isActive(s, 'chenyan'), true)
  npcLeaves(s, j, 'chenyan', '走散')
  assert.equal(isActive(s, 'chenyan'), false)
  assert.equal(isActive(s, '查无此人'), false)
})

test('对不存在的 npc 是安全的空操作', () => {
  const { s, j } = 局面()
  assert.equal(setNpcStatus(s, j, '查无此人', 'x'), false)
  assert.equal(npcLeaves(s, j, '查无此人', 'x'), false)
})

test('已经离队的人不会被重复处理', () => {
  const { s, j } = 局面()
  assert.equal(npcLeaves(s, j, 'chenyan', '第一次'), true)
  assert.equal(npcLeaves(s, j, 'chenyan', '第二次'), false)
  assert.equal(s.party.find((p) => p.npcId === 'chenyan').状态, '第一次')
})
