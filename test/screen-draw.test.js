import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawCompanions, drawViewModel, MAX_REDRAW } from '../src/ui/screen-draw.js'
import { RANDOM_POOL, getNpc } from '../src/data/npcs.js'
import { initialAffinity } from '../src/engine/affinity.js'
import { makeRng } from '../src/engine/rng.js'

test('抽出 2 个不重复的随机配角', () => {
  for (let i = 0; i < 60; i++) {
    const 抽 = drawCompanions(makeRng(i), 'renside')
    assert.equal(抽.length, 2)
    assert.notEqual(抽[0].npcId, 抽[1].npcId)
    for (const c of 抽) assert.ok(RANDOM_POOL.includes(c.npcId), `抽到了池外的人 ${c.npcId}`)
  }
})

test('两位重要配角永远不会被抽到', () => {
  for (let i = 0; i < 200; i++) {
    for (const c of drawCompanions(makeRng(i), 'renside')) {
      assert.ok(c.npcId !== 'taxue' && c.npcId !== 'mengshe', `重要配角不该出现在开局抽卡：${c.npcId}`)
    }
  }
})

test('同种子可复现', () => {
  assert.deepEqual(drawCompanions(makeRng(9), 'renside'), drawCompanions(makeRng(9), 'renside'))
})

test('初始好感取自性格匹配度，不是固定值', () => {
  const 抽 = drawCompanions(makeRng(4), 'renside')
  for (const c of 抽) {
    assert.equal(c.好感, initialAffinity('renside', c.npcId))
  }
  // 换个性格重抽同一批人，好感应当不同
  const 另一性格 = drawCompanions(makeRng(4), 'zilaishu')
  assert.deepEqual(另一性格.map((c) => c.npcId), 抽.map((c) => c.npcId), '同种子应抽到同一批人')
  assert.ok(另一性格.some((c, i) => c.好感 !== 抽[i].好感), '换了性格好感却没变')
})

test('不同性格对同一个人给出不同初始好感', () => {
  const a = initialAffinity('renside', 'chenyan')
  const b = initialAffinity('zilaishu', 'chenyan')
  assert.notEqual(a, b, '性格轴没起作用')
})

test('十个人都有机会被抽到，不是只在头几个里打转', () => {
  const 出现 = new Set()
  for (let i = 0; i < 400; i++) for (const c of drawCompanions(makeRng(i), 'renside')) 出现.add(c.npcId)
  assert.equal(出现.size, RANDOM_POOL.length, `只抽到 ${出现.size} 种人`)
})

test('视图模型带出卡片所需的全部字段', () => {
  const vm = drawViewModel(drawCompanions(makeRng(1), 'renside'), 0)
  assert.equal(vm.卡片.length, 2)
  for (const 卡 of vm.卡片) {
    const npc = getNpc(卡.npcId)
    assert.equal(卡.名称, npc.名称)
    assert.equal(卡.职业, npc.职业)
    assert.deepEqual(卡.技能, npc.技能)
    assert.equal(卡.状态, npc.状态)
    assert.ok(卡.立绘, '缺立绘占位')
    assert.equal(typeof 卡.好感, 'number')
  }
})

test('重抽次数用尽后不再允许重抽', () => {
  assert.equal(drawViewModel([], 0).可重抽, true)
  assert.equal(drawViewModel([], MAX_REDRAW).可重抽, false)
})
