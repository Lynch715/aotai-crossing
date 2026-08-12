import { RANDOM_POOL, getNpc, PERSONALITY_TAGS } from '../data/npcs.js'
import { initialAffinity } from '../engine/affinity.js'
import { rollInt } from '../engine/rng.js'

export const MAX_REDRAW = 1

const 抽取人数 = 2

// 从 10 位随机配角里抽 2 个。两位重要配角（踏雪、猛蛇过江）不在池里——
// 他们要在途中遭遇，开局就同行会毁掉那份分量。
export function drawCompanions(rng, 性格id) {
  // 性格 id 打错时 initialAffinity 会静默返回基准值，全队好感齐刷刷 25——
  // 看起来毫无异常，实际整个性格匹配机制没生效。宁可在这里炸掉。
  if (!PERSONALITY_TAGS.some((t) => t.id === 性格id)) {
    throw new Error(`drawCompanions: 认不出的性格标签「${性格id}」，好感匹配会静默失效`)
  }
  const 池 = [...RANDOM_POOL]
  const 结果 = []
  for (let i = 0; i < 抽取人数; i++) {
    const [id] = 池.splice(rollInt(rng, 0, 池.length - 1), 1)
    结果.push({ npcId: id, 好感: initialAffinity(性格id, id) })
  }
  return 结果
}

export function drawViewModel(抽到, 已重抽次数) {
  return {
    卡片: 抽到.map((c) => {
      const npc = getNpc(c.npcId)
      return {
        npcId: c.npcId,
        名称: npc.名称,
        年龄: npc.年龄,
        职业: npc.职业,
        技能: npc.技能,
        性格: npc.性格,
        状态: npc.状态,
        好感: c.好感,
        带伤: npc.状态 !== '正常',
      }
    }),
    可重抽: 已重抽次数 < MAX_REDRAW,
    剩余重抽: Math.max(0, MAX_REDRAW - 已重抽次数),
  }
}
