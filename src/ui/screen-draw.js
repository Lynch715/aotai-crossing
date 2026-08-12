import { RANDOM_POOL, getNpc } from '../data/npcs.js'
import { initialAffinity } from '../engine/affinity.js'
import { rollInt } from '../engine/rng.js'
import { portraitSvg } from './portrait.js'

export const MAX_REDRAW = 1

const 抽取人数 = 2

// 从 10 位随机配角里抽 2 个。两位重要配角（踏雪、猛蛇过江）不在池里——
// 他们要在途中遭遇，开局就同行会毁掉那份分量。
export function drawCompanions(rng, 性格id) {
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
        立绘: portraitSvg(c.npcId),
      }
    }),
    可重抽: 已重抽次数 < MAX_REDRAW,
    剩余重抽: Math.max(0, MAX_REDRAW - 已重抽次数),
  }
}
