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

function 剩余主粮of(state) {
  return (state.pack || [])
    .filter((p) => p.gearId === 'staple_food' || p.gearId === 'extra_staple')
    .reduce((s, p) => s + p.数量, 0)
}

// 同一种结局也应留下不同的个人故事。称号只读取引擎记下来的硬事实，
// 不让模型临场编一个“毫发无伤”却同时显示受伤 3 次。
function 称号列表of(state) {
  const t = state.ending?.type
  const out = []
  if (t === '成功穿越') {
    if (state.clock.day <= 6) out.push('秦岭老驴')
    else if (state.clock.day <= 9) out.push('稳扎稳打的完成者')
    else out.push('磨出来的胜利')
    if (!(state.pc.伤病 || []).length) out.push('毫发无伤')
    if (剩余主粮of(state) === 0) out.push('最后一口粮')
    if ((state.party || []).length >= 2 && state.party.every((p) => p.在队)) out.push('队长')
    if (!(state.party || []).some((p) => p.在队)) out.push('独行者')
    if ((state.flags?.高危成功次数 || 0) >= 3) out.push('赌徒')
    if ((state.flags?.迷路次数 || 0) === 0) out.push('山里人')
    if ((state.flags?.最低体力 ?? 100) <= 15) out.push('命悬一线')
  } else if (t === '主动下撤') {
    out.push('知难而退')
    if ((state.party || []).every((p) => p.在队)) out.push('全员平安')
  } else if (t === '被救援') {
    out.push('捡回一条命')
  } else {
    out.push('山把你留下了')
  }
  return [...new Set(out)].slice(0, 6)
}

export function endingViewModel(state, journal) {
  if (state.phase !== '结局' || !state.ending) return null
  // 未知结局类型也要给出页面。此前返回 null 会让玩家在一片空白里
  // 结束整局——checkEnding 能产出的类型比这里多过一次（主动下撤），
  // 白屏就是那样来的。
  const 文案 = ENDING_文案[state.ending.type] || {
    标题: '这一局结束了', 定性: '生还', 说明: state.ending.原因 || '',
  }

  const 称号列表 = 称号列表of(state)
  return {
    type: state.ending.type,
    标题: 文案.标题,
    定性: 文案.定性,
    说明: 文案.说明,
    原因: state.ending.原因 || '',
    罚款: state.ending.type === '成功穿越' ? FINE_AMOUNT : 0,
    称号: 称号列表[0] || '',
    称号列表,
    回顾: {
      天数: state.clock.day,
      最低体力: state.flags?.最低体力 ?? null,
      受伤次数: (state.pc.伤病 || []).length,
      迷路次数: state.flags?.迷路次数 || 0,
      恶劣天气暴露次数: state.flags?.恶劣天气暴露次数 || 0,
      野外迫降次数: state.flags?.野外迫降次数 || 0,
      最重体温: ['正常', '发冷', '失温', '严重失温'][state.flags?.最重体温 || 0],
      最重高反: ['无', '轻度', '中度', '重度'][state.flags?.最重高反 || 0],
      高危成功: state.flags?.高危成功次数 || 0,
      高危尝试: state.flags?.高危尝试次数 || 0,
      剩余主粮: 剩余主粮of(state),
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
