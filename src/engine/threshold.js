import { getNpc } from '../data/npcs.js'
import { getGear } from '../data/gear.js'

// 差距超过 10 即不可达。用一个远大于 10 的哨兵值表示「结构性缺失」（缺物品、人不在队）。
export const UNREACHABLE = 999

// 理由是直接摆到玩家眼前的，不能出现内部 id。
// 「玩家能看懂自己为什么失败」是这套判定存在的前提——写成
// 「linxiaoya 好感 62」就等于没写。
function npcName(npcId) {
  const n = getNpc(npcId)
  return n ? n.名称 : npcId
}

function gearName(gearId) {
  const g = getGear(gearId)
  return g ? g.名称 : gearId
}

const 体力惩罚阈值 = 20
const 体力惩罚差距 = 10

export function successChance(gap) {
  if (gap <= 0) return 1
  if (gap > 10) return 0
  return 0.9 - 0.07 * (gap - 1)
}

// 算出「离达标还差多少」。多条门槛取最大差距——最短板决定成败。
export function gapFor(require, state) {
  const 未达 = []
  let gap = 0
  const bump = (d, why) => {
    if (d > 0) {
      未达.push({ d, why })
      if (d > gap) gap = d
    }
  }

  if (require) {
    if (typeof require.经验 === 'number') {
      const d = require.经验 - state.pc.户外经验
      bump(d, `户外经验 ${state.pc.户外经验}，需 ${require.经验}，差 ${d}`)
    }
    if (typeof require.体力 === 'number') {
      const d = require.体力 - state.pc.体力
      bump(d, `体力 ${state.pc.体力}，需 ${require.体力}，差 ${d}`)
    }
    for (const [npcId, 需要] of Object.entries(require.好感 || {})) {
      const 同伴 = state.party.find((p) => p.npcId === npcId && p.在队)
      if (!同伴) {
        bump(UNREACHABLE, `${npcName(npcId)} 不在队`)
        continue
      }
      const d = 需要 - 同伴.好感
      bump(d, `${npcName(npcId)} 好感 ${同伴.好感}，需 ${需要}，差 ${d}`)
    }
    for (const gearId of require.物品 || []) {
      if (!state.pack.some((p) => p.gearId === gearId)) {
        bump(UNREACHABLE, `缺少${gearName(gearId)}`)
      }
    }
  }

  // 体力见底时百事艰难：所有判定统一加码，不区分门槛类型。
  if (gap < UNREACHABLE && state.pc.体力 < 体力惩罚阈值) {
    gap += 体力惩罚差距
    未达.push({ d: 体力惩罚差距, why: `体力 ${state.pc.体力} 低于 ${体力惩罚阈值}，判定额外加 ${体力惩罚差距} 点难度` })
  }

  // 数值门槛可能报得离谱（LLM 写了个「需经验 5000」），算出的差距会远超哨兵值。
  // 一律收敛到 UNREACHABLE，否则下游用 gap === UNREACHABLE 判结构性不可达时会漏掉。
  if (gap > UNREACHABLE) gap = UNREACHABLE

  // 按差距从大到小排：reasons[0] 恒为真正卡住玩家的那一条。
  // 「玩家能看懂自己为什么失败」是这套判定存在的前提，UI 要显示的就是它。
  未达.sort((a, b) => b.d - a.d)

  return { gap, reasons: 未达.map((r) => r.why) }
}

// 判定在调用 LLM 之前完成。返回值直接决定要告诉 LLM 的「既成事实」。
export function judgeOption(option, state, rng) {
  const { gap, reasons } = gapFor(option.require, state)
  const chance = successChance(gap)

  if (chance >= 1) {
    return { outcome: 'success', gap, chance: 1, roll: null, selectable: true, reasons }
  }
  if (chance <= 0) {
    return { outcome: 'fail', gap, chance: 0, roll: null, selectable: false, reasons }
  }

  const roll = rng()
  return {
    outcome: roll < chance ? 'success' : 'fail',
    gap, chance, roll, selectable: true, reasons,
  }
}
