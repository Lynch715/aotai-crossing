import { getNode } from '../data/route.js'
import { tierOf, getGear } from '../data/gear.js'

// v3：路线压缩为 6 天决策节点；新增累计风险计数，供面板和结算使用。
export const STATE_VERSION = 3

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
    // 队友初始状态照抄人物表（王大鹏的膝伤、周涛的脚踝）。此前一律写「正常」，
    // 抽卡卡片和 system prompt 里说他带伤、user message 里又说他正常，模型无所适从。
    party: opts.队友.map((t) => ({ npcId: t.npcId, 好感: t.好感, 状态: t.状态 || '正常', 在队: true })),
    flags: {
      已求救: false, 已下撤: false, 高海拔过夜数: 0, 失温连败: 0,
      迷路次数: 0, 恶劣天气暴露次数: 0,
      触发过的事件id: [], 最低体力: 100,
    },
    ending: null,
  }

  const 起点节点 = getNode(state.place.nodeId)
  if (!起点节点) throw new Error(`createInitialState: 起点不是合法节点 id：${state.place.nodeId}`)
  state.place.海拔 = 起点节点.海拔

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

// 分份物品（食物、气罐）的单重 = 整包重量 ÷ 份数。tier.重量 是采购时整包的重量，
// 数量的语义是「还剩几份」。直接拿 tier.重量 当单重的话，5 份主粮会按 5 个整包计重。
function 单重of(gearId, tier) {
  const 份数 = getGear(gearId)?.份数
  const 除数 = Number.isFinite(份数) && 份数 > 0 ? 份数 : 1
  return Math.round((tier.重量 / 除数) * 1000) / 1000
}

export function addItem(state, gearId, 档, 数量 = 1) {
  const tier = tierOf(gearId, 档)
  if (!tier) return false
  if (!Number.isFinite(数量) || 数量 <= 0) return false
  const 已有 = state.pack.find((p) => p.gearId === gearId)
  if (已有) {
    // 换档要同步替换整摞的档次与单重。只加数量不改单重的话，负重会按旧档
    // 算出错值且无人察觉——而「数值不飘」正是这整套架构存在的理由。
    已有.数量 += 数量
    已有.档 = 档
    已有.单重 = 单重of(gearId, tier)
  } else {
    state.pack.push({ gearId, 档, 数量, 单重: 单重of(gearId, tier), 余量: 100 })
  }
  recalcCarry(state)
  return true
}

export function removeItem(state, gearId, 数量 = 1) {
  if (!Number.isFinite(数量) || 数量 <= 0) return false
  const i = state.pack.findIndex((p) => p.gearId === gearId)
  if (i === -1) return false
  state.pack[i].数量 -= 数量
  if (state.pack[i].数量 <= 0) state.pack.splice(i, 1)
  recalcCarry(state)
  return true
}

// 按百分比消耗（气罐、净水药片这类）。归零则摘出背包。
export function consumeItem(state, gearId, 百分比) {
  // 负百分比等于凭空把消耗品加满，必须拦。写入层自己守住，
  // 不指望每个调用点都记得校验。
  if (!Number.isFinite(百分比) || 百分比 <= 0) return false
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
