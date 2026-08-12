import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveExperience, createViewModel, validateDraft, randomDraft, EXPERIENCE_JOBS } from '../src/ui/screen-create.js'
import { PERSONALITY_TAGS } from '../src/data/npcs.js'
import { makeRng } from '../src/engine/rng.js'

const 草稿 = (over = {}) => ({
  名字: '周野', 职业: '户外器材工程师', 年龄: 28, 性别: '男',
  性格: 'renside', 外貌: '偏瘦，晒得黑', 技能: ['装备维修', '路线规划', '生火'],
  经验微调: 0, ...over,
})

test('户外经验落在 0-100 且随职业变化', () => {
  const 高 = deriveExperience({ ...草稿(), 职业: '退役登山教练' })
  const 低 = deriveExperience({ ...草稿(), 职业: '大学历史教授' })
  assert.ok(高 > 低, `登山教练(${高}) 应高于历史教授(${低})`)
  for (const 职业 of Object.keys(EXPERIENCE_JOBS)) {
    const v = deriveExperience({ ...草稿(), 职业 })
    assert.ok(v >= 0 && v <= 100, `${职业} 越界 ${v}`)
  }
})

test('技能越多经验越高，但边际递减不至于爆表', () => {
  const 一技 = deriveExperience({ ...草稿(), 技能: ['生火'] })
  const 三技 = deriveExperience({ ...草稿(), 技能: ['生火', '装备维修', '路线规划'] })
  assert.ok(三技 > 一技)
  assert.ok(三技 <= 100)
})

test('年龄影响经验但不是线性叠加', () => {
  const 少年 = deriveExperience({ ...草稿(), 年龄: 19 })
  const 中年 = deriveExperience({ ...草稿(), 年龄: 45 })
  assert.ok(中年 > 少年)
})

test('微调只允许 ±10', () => {
  const 基础 = deriveExperience(草稿())
  assert.equal(deriveExperience(草稿({ 经验微调: 10 })), Math.min(100, 基础 + 10))
  assert.equal(deriveExperience(草稿({ 经验微调: 999 })), Math.min(100, 基础 + 10))
  assert.equal(deriveExperience(草稿({ 经验微调: -999 })), Math.max(0, 基础 - 10))
})

test('校验：名字必填', () => {
  const r = validateDraft(草稿({ 名字: '  ' }))
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('名字')))
})

test('校验：技能必须正好 3 个', () => {
  assert.equal(validateDraft(草稿({ 技能: ['生火'] })).ok, false)
  assert.equal(validateDraft(草稿({ 技能: ['a', 'b', 'c', 'd'] })).ok, false)
  assert.equal(validateDraft(草稿()).ok, true)
})

test('校验：性格必须是合法标签', () => {
  assert.equal(validateDraft(草稿({ 性格: '查无此性格' })).ok, false)
})

test('校验：年龄要在合理区间', () => {
  assert.equal(validateDraft(草稿({ 年龄: 8 })).ok, false)
  assert.equal(validateDraft(草稿({ 年龄: 120 })).ok, false)
})

test('随机捏人产出的草稿必定合法', () => {
  for (let i = 0; i < 50; i++) {
    const d = randomDraft(makeRng(i))
    const r = validateDraft(d)
    assert.equal(r.ok, true, `第 ${i} 次随机不合法：${r.问题.join('、')}`)
  }
})

test('随机捏人同种子可复现', () => {
  assert.deepEqual(randomDraft(makeRng(3)), randomDraft(makeRng(3)))
})

test('视图模型带出全部性格标签与推算出的经验', () => {
  const vm = createViewModel(草稿())
  assert.equal(vm.性格标签.length, PERSONALITY_TAGS.length)
  assert.equal(vm.性格标签.find((t) => t.选中).id, 'renside')
  assert.equal(vm.户外经验, deriveExperience(草稿()))
  assert.equal(vm.可继续, true)
})

test('自填字段有长度上限——它们会进每一次 LLM 请求', () => {
  assert.equal(validateDraft(草稿({ 名字: '啊'.repeat(13) })).ok, false)
  assert.equal(validateDraft(草稿({ 职业: '啊'.repeat(21) })).ok, false)
  assert.equal(validateDraft(草稿({ 外貌: '啊'.repeat(61) })).ok, false)
  assert.equal(validateDraft(草稿({ 技能: ['正常', '也正常', '啊'.repeat(13)] })).ok, false)
  // 边界内照常放行
  assert.equal(validateDraft(草稿({ 名字: '啊'.repeat(12), 外貌: '啊'.repeat(60) })).ok, true)
})

test('随机捏人产出的草稿不会撞上长度上限', () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(validateDraft(randomDraft(makeRng(i))).ok, true, `第 ${i} 次随机超限`)
  }
})
