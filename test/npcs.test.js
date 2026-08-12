import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NPCS, PERSONALITY_TAGS, RANDOM_POOL, getNpc } from '../src/data/npcs.js'

test('共 12 人：10 随机配角 + 2 重要配角', () => {
  assert.equal(NPCS.length, 12)
  assert.equal(RANDOM_POOL.length, 10)
  assert.equal(NPCS.filter((n) => n.重要).length, 2)
})

test('随机池不含两位重要配角', () => {
  assert.ok(!RANDOM_POOL.includes('taxue'))
  assert.ok(!RANDOM_POOL.includes('mengshe'))
})

test('每人字段齐备', () => {
  for (const n of NPCS) {
    assert.ok(n.id && n.名称 && n.职业 && n.性格 && n.状态, `字段缺失: ${n.id}`)
    assert.equal(typeof n.年龄, 'number', `年龄非数字: ${n.id}`)
    assert.ok(Array.isArray(n.技能) && n.技能.length > 0, `技能为空: ${n.id}`)
  }
})

test('每人有 4 维性格轴，取值只能是 -1/0/1', () => {
  for (const n of NPCS) {
    assert.equal(n.轴.length, 4, `轴维度不对: ${n.id}`)
    assert.ok(n.轴.every((v) => v === -1 || v === 0 || v === 1), `轴取值非法: ${n.id}`)
  }
})

test('玩家性格标签同样是 4 维轴，且至少 8 个', () => {
  assert.ok(PERSONALITY_TAGS.length >= 8)
  for (const t of PERSONALITY_TAGS) {
    assert.ok(t.id && t.文案)
    assert.equal(t.轴.length, 4)
    assert.ok(t.轴.every((v) => v === -1 || v === 0 || v === 1))
  }
})

test('文档原文照搬：踏雪与猛蛇过江保留事迹结局', () => {
  assert.ok(getNpc('taxue').事迹.includes('失联21天'))
  assert.ok(getNpc('mengshe').事迹.includes('64小时'))
})

test('开局带伤的三人状态与文档一致', () => {
  assert.equal(getNpc('wangdapeng').状态, '膝盖旧伤复发')
  assert.equal(getNpc('zhoutao').状态, '脚踝扭伤')
  assert.equal(getNpc('sunxiaojie').状态, '肠胃不适，腹泻')
})

test('getNpc 取不到返回 undefined', () => {
  assert.equal(getNpc('查无此人'), undefined)
})
