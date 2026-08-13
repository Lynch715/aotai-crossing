import { getNode, mainProgress, ROUTE, isAdjacent } from '../data/route.js'
import { getNpc } from '../data/npcs.js'
import { getGear } from '../data/gear.js'
import { activeParty } from '../engine/party.js'
import { affinityLabel } from '../engine/affinity.js'
import { gapFor, successChance } from '../engine/threshold.js'
import { hasItem } from '../engine/state.js'
import { splitParagraphs } from './prose.js'

const GAME_每次热食耗气 = 8

// 原生操作的可用性。这些操作（进食/休整/求救）不经过 LLM——
// consume.js 里的 eatHot/eatCold/rest 写了又测了，此前却没有任何调用方，
// 炉头气罐冻干餐全是死重。可用性判定放视图模型层，才能进 node --test。
export function actionsViewModel(state) {
  const 结束 = state.phase === '结局'
  const 炉 = state.pack.find((p) => p.gearId === 'stove')
  const 有餐 = hasItem(state, 'freeze_dried') || hasItem(state, 'extra_freeze_dried')
  const 有气 = !!炉 && (炉.余量 >= GAME_每次热食耗气 || hasItem(state, 'extra_canister'))
  const 热食原因 = !炉 ? '没有炉具' : !有餐 ? '没有冻干餐' : !有气 ? '气罐见底' : ''
  const 有求救设备 = hasItem(state, 'gps') || hasItem(state, 'sat_phone')

  // 下撤分叉：当前位置相邻的下撤点（水窝子→核桃坪；2800→核桃坪/嵩坪寺）。
  // 2800 是全线最后一次容易主动放弃的地方——这组按钮就是那个「战略弹窗」，
  // 原生实现，不经过模型。
  const 下撤列表 = 结束 ? [] : ROUTE
    .filter((n) => n.类型 === '下撤' && isAdjacent(state.place.nodeId, n.id))
    .map((n) => ({ nodeId: n.id, 名称: n.名称, 文案: `下撤${n.名称}（结束本局）` }))

  // 接待站补给：大爷海/大文公庙——重新摸到文明的边，可以花钱补主粮。
  const 接待站 = ['dayehai', 'dawengongmiao'].includes(state.place.nodeId)
  const 补给价 = 200

  return {
    热食: { 可用: !结束 && !!炉 && 有餐 && 有气, 原因: 热食原因, 文案: '热食 +6' },
    冷食: { 可用: !结束 && hasItem(state, 'trail_snack'), 原因: hasItem(state, 'trail_snack') ? '' : '没有路餐', 文案: '路餐 +3' },
    休整: { 可用: !结束, 原因: '', 文案: hasItem(state, 'camp_stool') ? '休整 +10（耗一个时段）' : '休整 +8（耗一个时段）' },
    求救: { 可用: !结束 && 有求救设备, 原因: 有求救设备 ? '' : '没有 GPS 信标或卫星电话', 文案: '发出求救（结束本局）' },
    下撤列表,
    补给: {
      可用: !结束 && 接待站 && state.money >= 补给价,
      原因: !接待站 ? '' : state.money < 补给价 ? `现金不足 ¥${补给价}` : '',
      在接待站: 接待站,
      价格: 补给价,
      文案: `接待站补给 ¥${补给价}（主粮+4）`,
    },
  }
}

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

// 代价也要明码标价：体力多少、要不要多耗半天、花不花钱——
// 玩家曾经点了个「冲刺」，睁眼已是第二天，因为没人告诉他这一步吃两个时段。
export function costLabel(cost) {
  if (!cost || typeof cost !== 'object') return ''
  const 段 = []
  if (typeof cost.体力 === 'number' && cost.体力 > 0) 段.push(`耗体力约${cost.体力}`)
  if (typeof cost.时段 === 'number' && cost.时段 > 0) 段.push('多耗一个时段')
  if (typeof cost.金钱 === 'number' && cost.金钱 > 0) 段.push(`花 ¥${cost.金钱}`)
  return 段.join('、')
}

export function optionDisplay(option, state) {
  const { gap, reasons } = gapFor(option.require, state)
  const chance = successChance(gap)
  const 代价文案 = costLabel(option.cost)

  if (chance >= 1) {
    return { ...option, 可点: true, 档: '达标', 概率文案: '', 理由: '', 代价文案 }
  }
  if (chance <= 0) {
    return { ...option, 可点: false, 档: '不可达', 概率文案: '', 理由: reasons[0] || '条件不足', 代价文案 }
  }
  return {
    ...option,
    可点: true,
    档: '勉强',
    概率文案: `勉强 · 约 ${Math.round(chance * 100)}%`,
    理由: reasons[0] || '',
    代价文案,
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
  // 完成度（文档要求的「主线完成度」）。下撤点不在主线上，返回空串隐藏。
  const 进度 = mainProgress(state.place.nodeId)
  return {
    顶栏: {
      时间: `第${state.clock.day}天 ${state.clock.slot}`,
      地点: node ? node.名称 : state.place.nodeId,
      海拔: state.place.海拔,
      天气: `${state.weather.状态} ${state.weather.等级}级`,
      行程: 进度 ? `行程 ${进度.序号}/${进度.总数}` : '',
    },
    面板: panelViewModel(state),
    舞台: stageViewModel(state, 说话人),
    标题: 回合 ? 回合.标题 || '' : '',
    段落: 回合 ? splitParagraphs(回合.剧情) : [],
    万象: 回合 && Array.isArray(回合.万象) ? 回合.万象 : [],
    选项: 回合 && Array.isArray(回合.选项) ? 回合.选项.map((o) => optionDisplay(o, state)) : [],
  }
}
