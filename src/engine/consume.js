import { getNode, travelDifficulty } from '../data/route.js'
import { getSeason } from '../data/seasons.js'
import { removeItem, hasItem } from './state.js'
import { getGear } from '../data/gear.js'

const 基础时段消耗 = 6
const 负重基准线 = 15
const 高海拔线 = 3400
const 适应海拔线 = 3000
const 需要适应晚数 = 1
const 毫无保暖 = 99
const 每次热食耗气 = 8
const 每日主粮 = 2

const SLOTS = ['早', '中', '晚']

// 适应 = 在 3000m 以上营地过夜累计 ≥1 晚。
// 这让前两天在 2900 营地慢慢爬高有了现实意义，也让「一天冲上 3500」要付代价。
export function isAcclimatized(state) {
  return state.flags.高海拔过夜数 >= 需要适应晚数
}

// 有效温标 = 最保暖那件睡袋的温标 − 内胆加成。数字越低越保暖。
// 没带睡袋记 +99：不是「有点冷」，是根本没有保暖可言。
// 遍历所有睡袋而不是写死 sleeping_bag——装备表里不止一款，写死会让
// 花大价钱买的极寒睡袋毫无作用，且没有任何测试会发现。
const 睡袋清单 = ['sleeping_bag', 'winter_bag']

export function effectiveWarmth(state) {
  const 温标表 = 睡袋清单
    .filter((id) => hasItem(state, id))
    .map((id) => getGear(id)?.温标)
    .filter((v) => typeof v === 'number')
  if (!温标表.length) return 毫无保暖
  const 最暖 = Math.min(...温标表)
  const 加成 = hasItem(state, 'bag_liner') ? (getGear('bag_liner')?.温标加成 ?? 0) : 0
  return 最暖 - 加成
}

const 每处未愈伤病拖累 = 2
const 恶劣天气行军线 = 6

function hasAny(state, ids) {
  return ids.some((id) => hasItem(state, id))
}

// 基础行动消耗。社交/整理物资不吃地形加成，徒步与高危行动才吃。
export function stepStaminaCost(state, { 行军 = true } = {}) {
  const 超出 = Math.max(0, state.carry.当前 - 负重基准线)
  let cost = 行军 ? Math.floor(基础时段消耗 * Math.pow(1.04, 超出)) : 2
  if (行军) {
    cost += travelDifficulty(state.place.nodeId)
    if (state.place.海拔 > 高海拔线 && !isAcclimatized(state)) cost += 2
    if ((state.weather?.等级 ?? 0) >= 恶劣天气行军线) {
      cost += hasAny(state, ['hardshell', 'rain_pants']) ? 2 : 5
    }
    if (hasItem(state, 'trekking_poles')) cost -= 1
  }
  // 带伤走路更费劲。这是伤病在体力线上的唯一挂钩点——没有它，
  // 轻伤对玩家来说就只是一行字。
  cost += (state.pc.伤病 || []).filter((w) => !w.已处理).length * (行军 ? 每处未愈伤病拖累 : 1)
  return Math.max(1, cost)
}

export function 调整体力(state, delta) {
  state.pc.体力 = Math.max(0, Math.min(100, state.pc.体力 + delta))
  // 全程最低体力在唯一写入口记账——结算页要用（「最低体力 11」这种数字
  // 比任何形容词都有说服力）。旧档没有该字段时按当前值起算。
  if (state.flags && state.pc.体力 < (state.flags.最低体力 ?? 100)) {
    state.flags.最低体力 = state.pc.体力
  }
  return state
}

export function applyStepCost(state, opts) {
  return 调整体力(state, -stepStaminaCost(state, opts))
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
  const 装备齐 = hasItem(state, 'tent') && hasAny(state, 睡袋清单)
  const 条件好 = 装备齐 && node && node.可扎营 && !恶劣天气
  // 有水源的正规营地（盆景园、水窝子、2800、西源……）恢复力更强——
  // 能打水做饭洗漱，睡得就是踏实。这也让「赶到营地再睡」有了数值意义。
  const 水源营地加成 = 条件好 && node.有水源 ? 5 : 0
  let 恢复 = (条件好 ? 22 : 4) + 水源营地加成
  if (条件好 && hasItem(state, 'down_jacket')) 恢复 += 3
  调整体力(state, 恢复)

  if (node && node.海拔 >= 适应海拔线) state.flags.高海拔过夜数 += 1

  // 失温判定：夜里比睡袋扛得住的还冷，就算一次失温。连续 失温连败上限 次
  // 触发「失败遇险」结局（见 ending.js）。失温当晚再扣 8 点体力，确保
  // 无睡袋露宿不是可反复利用的低效回血手段。
  const 季节 = getSeason(state.meta.季节)
  // 坏天气会给睡眠系统再压 5℃；硬壳+中层可抵消这层风寒，但不能替代睡袋。
  const 风寒 = 恶劣天气 && !hasAny(state, ['hardshell', 'midlayer']) ? 5 : 0
  if (季节 && 季节.夜间温度 - 风寒 < effectiveWarmth(state)) {
    state.flags.失温连败 += 1
    调整体力(state, -8)
  } else {
    state.flags.失温连败 = 0
  }

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

const 恶劣天气线 = 6
const 每份欠粮惩罚 = 8

// 完成一次夜间结算。徒步回合会先把时钟跨到次日，再在真正抵达的落点调用
// 这里；原生休整等不移动的操作则仍由 advanceTimeSlot 当场调用。
export function settleOvernight(state) {
  sleep(state, { 恶劣天气: (state.weather?.等级 ?? 0) >= 恶劣天气线 })
  const { 断粮, 欠缺 } = dailyUpkeep(state)
  if (欠缺 > 0) 调整体力(state, -欠缺 * 每份欠粮惩罚)
  return { 断粮, 欠缺 }
}

// 推进一个时段，并处理跨天的全部连锁（睡眠、日粮、断粮惩罚）。
// 这段连锁此前内联在 turn.js 里；「原地休整」等原生操作也要推进时段，
// 各写一份的话，总有一份会漏掉 sleep() 或断粮惩罚。唯一入口，谁调都一样。
export function advanceTimeSlot(state) {
  const 日前 = state.clock.day
  advanceSlot(state)
  if (state.clock.day === 日前) return { 跨天: false, 断粮: false, 欠缺: 0 }

  const { 断粮, 欠缺 } = settleOvernight(state)
  return { 跨天: true, 断粮, 欠缺 }
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
