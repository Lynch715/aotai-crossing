import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'
import { affinityLabel } from '../engine/affinity.js'
import { FINE_AMOUNT } from '../engine/ending.js'

const ENDING_文案 = {
  失败遇险: { 标题: '你没能走下来', 定性: '惨败',
    说明: '山不会为谁破例。这一次，鳌太线留下了你。' },
  被救援: { 标题: '救援队找到了你', 定性: '生还',
    说明: '你活着下了山。代价是这趟没走完，以及一笔说不清的人情。' },
  成功穿越: { 标题: '你走完了鳌太线', 定性: '完成',
    说明: `你从下板寺走出景区大门，等着你的是一张 ${FINE_AMOUNT} 元的罚单。穿越鳌太线是违规的——但你确实走完了。` },
}

export function endingViewModel(state, journal) {
  if (state.phase !== '结局' || !state.ending) return null
  const 文案 = ENDING_文案[state.ending.type]
  if (!文案) return null

  return {
    type: state.ending.type,
    标题: 文案.标题,
    定性: 文案.定性,
    说明: 文案.说明,
    原因: state.ending.原因 || '',
    罚款: state.ending.type === '成功穿越' ? FINE_AMOUNT : 0,
    回顾: {
      天数: state.clock.day,
      节点: (journal.已过节点 || []).map((id) => {
        const n = getNode(id)
        return n ? n.名称 : id
      }),
      事件: (journal.关键事件 || []).map((e) => e.文本 || String(e)),
      好感: [...state.party]
        .sort((a, b) => b.好感 - a.好感)
        .map((p) => {
          const npc = getNpc(p.npcId)
          return { npcId: p.npcId, 名称: npc ? npc.名称 : p.npcId, 好感: p.好感, 分级: affinityLabel(p.好感), 在队: p.在队 }
        }),
    },
  }
}
