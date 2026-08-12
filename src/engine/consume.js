import { getNode } from '../data/route.js'
import { removeItem, hasItem } from './state.js'

const 基础时段消耗 = 6
const 负重基准线 = 15
const 高海拔线 = 3400
const 适应海拔线 = 3000
const 需要适应晚数 = 1
const 每次热食耗气 = 8
const 每日主粮 = 2

const SLOTS = ['早', '中', '晚']

// 适应 = 在 3000m 以上营地过夜累计 ≥1 晚。
// 这让前两天在 2900 营地慢慢爬高有了现实意义，也让「一天冲上 3500」要付代价。
export function isAcclimatized(state) {
  return state.flags.高海拔过夜数 >= 需要适应晚数
}

export function stepStaminaCost(state) {
  const 超出 = Math.max(0, state.carry.当前 - 负重基准线)
  let cost = Math.floor(基础时段消耗 * Math.pow(1.04, 超出))
  if (state.place.海拔 > 高海拔线 && !isAcclimatized(state)) cost += 2
  if (hasItem(state, 'trekking_poles')) cost -= 1
  return Math.max(1, cost)
}

function 调整体力(state, delta) {
  state.pc.体力 = Math.max(0, Math.min(100, state.pc.体力 + delta))
  return state
}

export function applyStepCost(state) {
  return 调整体力(state, -stepStaminaCost(state))
}

export function rest(state) {
  return 调整体力(state, hasItem(state, 'camp_stool') ? 10 : 8)
}

export function eatHot(state) {
  if (!hasItem(state, 'stove')) return false
  const 有餐 = hasItem(state, 'freeze_dried') || hasItem(state, 'extra_freeze_dried')
  if (!有餐) return false

  // 气罐见底要换备用罐，而不是把整套炉具丢掉——直接 consumeItem 归零会连炉头
  // 一起摘出背包。这里也是「带 2 罐比带 1 罐能多做热食」真正成立的地方：
  // extra_canister 是独立 gearId，不是 stove 的数量叠加（见本任务开头的 T7 预警）。
  const 炉 = state.pack.find((p) => p.gearId === 'stove')
  if (炉.余量 < 每次热食耗气) {
    if (!hasItem(state, 'extra_canister')) return false
    removeItem(state, 'extra_canister', 1)
    炉.余量 = 100
  }
  炉.余量 -= 每次热食耗气

  removeItem(state, hasItem(state, 'freeze_dried') ? 'freeze_dried' : 'extra_freeze_dried', 1)
  调整体力(state, 6)
  return true
}

export function eatCold(state) {
  if (!hasItem(state, 'trail_snack')) return false
  removeItem(state, 'trail_snack', 1)
  调整体力(state, 3)
  return true
}

export function sleep(state, { 恶劣天气 = false } = {}) {
  const node = getNode(state.place.nodeId)
  const 装备齐 = hasItem(state, 'tent') && hasItem(state, 'sleeping_bag')
  const 条件好 = 装备齐 && node && node.可扎营 && !恶劣天气
  调整体力(state, 条件好 ? 25 : 12)

  if (node && node.海拔 >= 适应海拔线) state.flags.高海拔过夜数 += 1
  return state
}

export function advanceSlot(state) {
  const i = SLOTS.indexOf(state.clock.slot)
  if (i === SLOTS.length - 1) {
    state.clock.slot = SLOTS[0]
    state.clock.day += 1
  } else {
    state.clock.slot = SLOTS[i + 1]
  }
  return state
}

// 每天扣 2 份主粮；主粮见底后自动动用 extra_staple 这个缓冲池
//（它的 每日消耗 标的是 0，正是「不自己扣、只在顶上时被动消耗」的意思）。
// 返回是否断粮，供结局判定参考；欠缺 > 0 表示今天没吃够。
export function dailyUpkeep(state) {
  let 待扣 = 每日主粮
  for (const id of ['staple_food', 'extra_staple']) {
    if (待扣 <= 0) break
    const 项 = state.pack.find((p) => p.gearId === id)
    if (!项) continue
    const 扣 = Math.min(待扣, 项.数量)
    removeItem(state, id, 扣)
    待扣 -= 扣
  }
  const 还有粮 = hasItem(state, 'staple_food') || hasItem(state, 'extra_staple')
  return { 断粮: !还有粮, 欠缺: 待扣 }
}
