import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'
import { getGear } from '../data/gear.js'
import { activeParty } from '../engine/party.js'
import { affinityLabel } from '../engine/affinity.js'
import { gapFor, successChance } from '../engine/threshold.js'
import { splitParagraphs } from './prose.js'

const GAME_负重偏重线 = 0.88
const GAME_体力告警线 = 20
const GAME_余量告警线 = 20

export function panelViewModel(state) {
  const 比 = state.carry.当前 / state.carry.上限
  const 档 = state.carry.当前 > state.carry.上限 ? '超重' : 比 >= GAME_负重偏重线 ? '偏重' : '正常'

  return {
    名字: state.pc.名字,
    职业: state.pc.职业,
    年龄: state.pc.年龄,
    性别: state.pc.性别,
    户外经验: state.pc.户外经验,
    体力: state.pc.体力,
    体力告警: state.pc.体力 < GAME_体力告警线,
    负重: { 当前: state.carry.当前, 上限: state.carry.上限, 比: Math.min(1, 比), 档 },
    现金: state.money,
    同行者: activeParty(state).map((p) => {
      const npc = getNpc(p.npcId)
      return { npcId: p.npcId, 名称: npc ? npc.名称 : p.npcId, 好感: p.好感, 分级: affinityLabel(p.好感), 状态: p.状态 }
    }),
    背包: state.pack.map((i) => {
      const g = getGear(i.gearId)
      return {
        gearId: i.gearId,
        名称: g ? g.名称 : i.gearId,
        数量: i.数量,
        余量: i.余量,
        余量告警: typeof i.余量 === 'number' && i.余量 <= GAME_余量告警线,
        每日消耗: g && typeof g.每日消耗 === 'number' && g.每日消耗 > 0 ? g.每日消耗 : null,
      }
    }),
  }
}

// 点击之前就把门槛比对算出来，用的是 judgeOption 同一套 gapFor——
// 所以界面上写的概率和真掷骰时的概率一致，不会骗人。
// 「玩家能看懂自己为什么失败」是整套判定设计的前提。
export function optionDisplay(option, state) {
  const { gap, reasons } = gapFor(option.require, state)
  const chance = successChance(gap)

  if (chance >= 1) {
    return { ...option, 可点: true, 档: '达标', 概率文案: '', 理由: '' }
  }
  if (chance <= 0) {
    return { ...option, 可点: false, 档: '不可达', 概率文案: '', 理由: reasons[0] || '条件不足' }
  }
  return {
    ...option,
    可点: true,
    档: '勉强',
    概率文案: `勉强 · 约 ${Math.round(chance * 100)}%`,
    理由: reasons[0] || '',
  }
}

export function stageViewModel(state, 说话人) {
  return {
    人物: activeParty(state).map((p) => {
      const npc = getNpc(p.npcId)
      return {
        npcId: p.npcId,
        名称: npc ? npc.名称 : p.npcId,
        状态: p.状态,
        说话中: p.npcId === 说话人,
      }
    }),
  }
}

export function gameViewModel({ state, 回合, 说话人 }) {
  const node = getNode(state.place.nodeId)
  return {
    顶栏: {
      时间: `第${state.clock.day}天 ${state.clock.slot}`,
      地点: node ? node.名称 : state.place.nodeId,
      海拔: state.place.海拔,
      天气: `${state.weather.状态} ${state.weather.等级}级`,
    },
    面板: panelViewModel(state),
    舞台: stageViewModel(state, 说话人),
    标题: 回合 ? 回合.标题 || '' : '',
    段落: 回合 ? splitParagraphs(回合.剧情) : [],
    万象: 回合 && Array.isArray(回合.万象) ? 回合.万象 : [],
    选项: 回合 && Array.isArray(回合.选项) ? 回合.选项.map((o) => optionDisplay(o, state)) : [],
  }
}
