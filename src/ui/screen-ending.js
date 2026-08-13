import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'
import { affinityLabel } from '../engine/affinity.js'
import { FINE_AMOUNT } from '../engine/ending.js'

const ENDING_文案 = {
  失败遇险: { 标题: '你没能走下来', 定性: '惨败',
    说明: '山不会为谁破例。这一次，鳌太线留下了你。' },
  被救援: { 标题: '救援队找到了你', 定性: '生还',
    说明: '你活着下了山。代价是这趟没走完，以及一笔说不清的人情。' },
  主动下撤: { 标题: '你自己走下来了', 定性: '生还',
    说明: '你没有走完，但你是自己走下来的。山会一直在那儿——能判断什么时候该退，本身就是本事。' },
  成功穿越: { 标题: '你走完了鳌太线', 定性: '完成',
    说明: `你从下板寺走出景区大门，等着你的是一张 ${FINE_AMOUNT} 元的罚单。穿越鳌太线是违规的——但你确实走完了。` },
}

// 走到过的最高点。数据本来就在，不摆出来可惜——爬到 3767 米的拔仙台
// 是玩家最想在结算页看到的一个数字。
function 最高节点(journal) {
  let 最高 = null
  for (const id of journal.已过节点 || []) {
    const n = getNode(id)
    if (n && (!最高 || n.海拔 > 最高.海拔)) 最高 = n
  }
  return 最高 ? { 名称: 最高.名称, 海拔: 最高.海拔 } : null
}

// 结算称号：一句话给这一局定性。数字之外要有一个能记住、能跟朋友说的词。
function 称号of(state) {
  const t = state.ending?.type
  if (t === '成功穿越') {
    if (state.clock.day <= 6) return '秦岭老驴'
    if (state.clock.day <= 9) return '稳扎稳打的完成者'
    return '磨出来的胜利'
  }
  if (t === '主动下撤') return '知进退的明白人'
  if (t === '被救援') return '捡回一条命'
  return '山把你留下了'
}

export function endingViewModel(state, journal) {
  if (state.phase !== '结局' || !state.ending) return null
  // 未知结局类型也要给出页面。此前返回 null 会让玩家在一片空白里
  // 结束整局——checkEnding 能产出的类型比这里多过一次（主动下撤），
  // 白屏就是那样来的。
  const 文案 = ENDING_文案[state.ending.type] || {
    标题: '这一局结束了', 定性: '生还', 说明: state.ending.原因 || '',
  }

  return {
    type: state.ending.type,
    标题: 文案.标题,
    定性: 文案.定性,
    说明: 文案.说明,
    原因: state.ending.原因 || '',
    罚款: state.ending.type === '成功穿越' ? FINE_AMOUNT : 0,
    称号: 称号of(state),
    回顾: {
      天数: state.clock.day,
      最低体力: state.flags?.最低体力 ?? null,
      受伤次数: (state.pc.伤病 || []).length,
      剩余主粮: (state.pack || [])
        .filter((p) => p.gearId === 'staple_food' || p.gearId === 'extra_staple')
        .reduce((s, p) => s + p.数量, 0),
      最高点: 最高节点(journal),
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
