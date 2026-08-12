import { getNpc, PERSONALITY_TAGS } from '../data/npcs.js'

export const MAX_DELTA = 5
export const MAX_MAJOR_DELTA = 15

const 基准好感 = 25
const 轴权重 = 4
const 初始下限 = 10
const 初始上限 = 45

const 分级 = [
  [0, 19, '冷淡'], [20, 39, '面熟'], [40, 59, '搭伙'], [60, 69, '信任'],
  [70, 89, '爱慕'], [90, 99, '深爱'], [100, 100, '至死不渝'],
]

export function clampAffinity(v) {
  return Math.max(0, Math.min(100, v))
}

export function affinityLabel(v) {
  // 先夹取再查表。否则 affinityLabel(150) 会落空并回落成「冷淡」——
  // 一个静默的谎言，而它恰恰出现在 UI 上给玩家看。
  const 夹取后 = clampAffinity(v)
  const hit = 分级.find(([lo, hi]) => 夹取后 >= lo && 夹取后 <= hi)
  return hit ? hit[2] : '冷淡'
}

// LLM 只能提议好感变化，落地前先夹到允许幅度——防止一句话涨 40 点。
export function applyAffinityDelta(state, npcId, delta, { 重大 = false } = {}) {
  const 同伴 = state.party.find((p) => p.npcId === npcId && p.在队)
  // 两个分支返回同样的键。少给 前值/后值 的话，调用方一解构就静默拿到
  // undefined，拿去比阈值或做算术会悄悄算错。
  if (!同伴) return { 应用: false, 实际: 0, 被夹取: false, 前值: null, 后值: null }

  const 上限 = 重大 ? MAX_MAJOR_DELTA : MAX_DELTA
  const 实际 = Math.max(-上限, Math.min(上限, delta))
  const 前值 = 同伴.好感
  同伴.好感 = clampAffinity(前值 + 实际)

  return { 应用: true, 实际, 被夹取: 实际 !== delta, 前值, 后值: 同伴.好感 }
}

// 初始好感由性格轴匹配度决定，让捏人这一步真的有后果。
export function initialAffinity(tagId, npcId) {
  const tag = PERSONALITY_TAGS.find((t) => t.id === tagId)
  const npc = getNpc(npcId)
  if (!tag || !npc) return 基准好感

  let 分 = 基准好感
  for (let i = 0; i < tag.轴.length; i++) {
    const a = tag.轴[i]
    const b = npc.轴[i]
    if (a === 0 || b === 0) continue
    分 += a === b ? 轴权重 : -轴权重
  }
  return Math.max(初始下限, Math.min(初始上限, 分))
}
