import { getNode } from '../data/route.js'
import { tierOf } from '../data/gear.js'

export const STATE_VERSION = 1

// 唯一权威状态。LLM 永远碰不到这个对象，只能提议；提议经 llm/validate.js 校验后由引擎应用。
export function createInitialState(opts) {
  const state = {
    meta: { 版本: STATE_VERSION, 季节: opts.季节, 随机种子: opts.种子 },
    phase: '徒步',
    clock: { day: 1, slot: '早' },
    place: { nodeId: opts.起点 || 'tangkou', 海拔: 0 },
    weather: { 状态: '晴', 等级: 1 },
    pc: {
      名字: opts.pc.名字, 职业: opts.pc.职业, 年龄: opts.pc.年龄,
      性别: opts.pc.性别, 性格: opts.pc.性格, 外貌: opts.pc.外貌,
      技能: [...opts.pc.技能], 户外经验: opts.pc.户外经验,
      体力: 100, 伤病: [],
    },
    money: opts.金钱,
    pack: [],
    carry: { 当前: 0, 上限: 30 },
    party: opts.队友.map((t) => ({ npcId: t.npcId, 好感: t.好感, 状态: '正常', 在队: true })),
    flags: { 已求救: false, 已下撤: false, 高海拔过夜数: 0, 失温连败: 0, 触发过的事件id: [] },
  }

  state.place.海拔 = getNode(state.place.nodeId).海拔

  for (const item of opts.背包 || []) {
    addItem(state, item.gearId, item.档, item.数量)
  }

  return state
}

// 负重 = Σ(单重 × 数量)。气罐一类的余量不影响重量（罐体本身就那么重）。
export function recalcCarry(state) {
  const 合计 = state.pack.reduce((s, p) => s + p.单重 * p.数量, 0)
  state.carry.当前 = Math.round(合计 * 100) / 100
}

export function addItem(state, gearId, 档, 数量 = 1) {
  const tier = tierOf(gearId, 档)
  if (!tier) return false
  const 已有 = state.pack.find((p) => p.gearId === gearId)
  if (已有) {
    已有.数量 += 数量
  } else {
    state.pack.push({ gearId, 档, 数量, 单重: tier.重量, 余量: 100 })
  }
  recalcCarry(state)
  return true
}

export function removeItem(state, gearId, 数量 = 1) {
  const i = state.pack.findIndex((p) => p.gearId === gearId)
  if (i === -1) return false
  state.pack[i].数量 -= 数量
  if (state.pack[i].数量 <= 0) state.pack.splice(i, 1)
  recalcCarry(state)
  return true
}

// 按百分比消耗（气罐、净水药片这类）。归零则摘出背包。
export function consumeItem(state, gearId, 百分比) {
  const item = state.pack.find((p) => p.gearId === gearId)
  if (!item) return false
  item.余量 -= 百分比
  if (item.余量 <= 0) removeItem(state, gearId, item.数量)
  return true
}

export function hasItem(state, gearId) {
  return state.pack.some((p) => p.gearId === gearId)
}

// 每回合开始前打快照，LLM 结算出错时整体回滚——绝不留半应用的脏状态。
export function snapshot(state) {
  return JSON.stringify(state)
}

export function restore(snap) {
  return JSON.parse(snap)
}
