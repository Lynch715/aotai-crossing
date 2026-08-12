import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampAffinity, affinityLabel, applyAffinityDelta,
  initialAffinity, MAX_DELTA, MAX_MAJOR_DELTA,
} from '../src/engine/affinity.js'

function 队伍() {
  return { party: [{ npcId: 'linxiaoya', 好感: 62, 在队: true }] }
}

test('夹取到 0-100', () => {
  assert.equal(clampAffinity(-30), 0)
  assert.equal(clampAffinity(0), 0)
  assert.equal(clampAffinity(150), 100)
  assert.equal(clampAffinity(62), 62)
})

test('分级标签覆盖每个区间，边界归属正确', () => {
  assert.equal(affinityLabel(0), '冷淡')
  assert.equal(affinityLabel(19), '冷淡')
  assert.equal(affinityLabel(20), '面熟')
  assert.equal(affinityLabel(39), '面熟')
  assert.equal(affinityLabel(40), '搭伙')
  assert.equal(affinityLabel(59), '搭伙')
  assert.equal(affinityLabel(60), '信任')
  assert.equal(affinityLabel(69), '信任')
  assert.equal(affinityLabel(70), '爱慕')
  assert.equal(affinityLabel(89), '爱慕')
  assert.equal(affinityLabel(90), '深爱')
  assert.equal(affinityLabel(99), '深爱')
  assert.equal(affinityLabel(100), '至死不渝')
})

test('文档明写的两个刻度对得上', () => {
  assert.equal(affinityLabel(70), '爱慕')
  assert.equal(affinityLabel(100), '至死不渝')
})

test('普通变化夹到 ±5', () => {
  const s = 队伍()
  assert.equal(applyAffinityDelta(s, 'linxiaoya', 3).实际, 3)
  assert.equal(s.party[0].好感, 65)

  const r = applyAffinityDelta(s, 'linxiaoya', 40)
  assert.equal(r.实际, MAX_DELTA)
  assert.equal(r.被夹取, true)
  assert.equal(s.party[0].好感, 70)
})

test('重大事件可到 ±15', () => {
  const s = 队伍()
  const r = applyAffinityDelta(s, 'linxiaoya', 40, { 重大: true })
  assert.equal(r.实际, MAX_MAJOR_DELTA)
  assert.equal(s.party[0].好感, 77)
})

test('负向变化同样受夹取', () => {
  const s = 队伍()
  assert.equal(applyAffinityDelta(s, 'linxiaoya', -40).实际, -MAX_DELTA)
  assert.equal(s.party[0].好感, 57)
})

test('好感不会越过 0-100 边界', () => {
  const s = { party: [{ npcId: 'a', 好感: 98, 在队: true }] }
  applyAffinityDelta(s, 'a', 5)
  assert.equal(s.party[0].好感, 100)
  s.party[0].好感 = 2
  applyAffinityDelta(s, 'a', -5)
  assert.equal(s.party[0].好感, 0)
})

test('对不在队的人不生效', () => {
  const s = 队伍()
  const r = applyAffinityDelta(s, 'wangdapeng', 5)
  assert.equal(r.应用, false)
  assert.equal(s.party[0].好感, 62)
})

test('分级标签先夹取再查表，越界值不会静默变成冷淡', () => {
  assert.equal(affinityLabel(150), '至死不渝')
  assert.equal(affinityLabel(-5), '冷淡')
})

test('应用失败时返回同样的键，不让调用方静默拿到 undefined', () => {
  const s = 队伍()
  const 失败 = applyAffinityDelta(s, 'wangdapeng', 5)
  const 成功 = applyAffinityDelta(s, 'linxiaoya', 1)
  assert.deepEqual(Object.keys(失败).sort(), Object.keys(成功).sort())
  assert.equal(失败.后值, null)
})

test('初始好感落在 10-45', () => {
  for (const tag of ['renside', 'zilaishu', 'maoxian', 'dulai']) {
    for (const npc of ['chenyan', 'hanmei', 'liweiwei', 'zhaozhiguo']) {
      const v = initialAffinity(tag, npc)
      assert.ok(v >= 10 && v <= 45, `${tag}/${npc} = ${v}`)
    }
  }
})

test('性格越合拍初始好感越高', () => {
  // 「话不多，认死理」[-1,-1,0,-1] 对陈岩「沉稳寡言」[-1,-1,0,-1]：
  // 三条非零轴全同号，轴2 因标签为 0 跳过
  const 合拍 = initialAffinity('renside', 'chenyan')
  // 同一标签对韩梅「强势控制欲」[1,1,1,-1]：轴0/轴1 异号，
  // 轴2 因标签为 0 跳过（不是三轴异号），轴3 同号
  const 不合 = initialAffinity('renside', 'hanmei')
  assert.ok(合拍 > 不合, `合拍 ${合拍} 应高于不合 ${不合}`)
  assert.equal(合拍, 37) // 25 + 4×3
  assert.equal(不合, 21) // 25 − 4×2 + 4×1
})

test('未知标签或未知 npc 返回基准值', () => {
  assert.equal(initialAffinity('查无此标签', 'chenyan'), 25)
  assert.equal(initialAffinity('renside', '查无此人'), 25)
})
