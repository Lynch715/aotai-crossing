import { NPCS, getNpc } from '../data/npcs.js'
import { getGear } from '../data/gear.js'
import { ROUTE, getNode, isAdjacent } from '../data/route.js'

// 门槛夹取表。LLM 现编的门槛不能超出这个范围，否则「喝口水」也要求经验 80。
export const CLAMP_TABLE = {
  社交: { 好感: 85, 经验: [0, 30] },
  徒步: { 好感: 60, 经验: [20, 75] },
  高危: { 好感: 70, 经验: [40, 90] },
}

const 合法选项id = new Set(['A', 'B', 'C', 'D'])

// LLM 用中文名指代人物，映射回 id；id 直传也认。
export function resolveNpc(name) {
  if (!name || typeof name !== 'string') return null
  const t = name.trim()
  if (getNpc(t)) return t
  const hit = NPCS.find((n) => n.名称 === t)
  return hit ? hit.id : null
}

function resolveNode(name) {
  if (!name || typeof name !== 'string') return null
  const t = name.trim()
  if (getNode(t)) return t
  const 精确 = ROUTE.find((n) => n.名称 === t)
  if (精确) return 精确.id
  // 前缀匹配只在唯一命中时才认。「大」同时前缀匹配大爷海与大文公庙，
  // 谁胜出取决于数组顺序——等于让模型的手滑决定玩家被送到哪个山头。
  const 候选 = ROUTE.filter((n) => n.名称.startsWith(t))
  return 候选.length === 1 ? 候选[0].id : null
}

// 代价也是 LLM 现编的。不夹的话「cost: {体力: -50}」就是白送体力，
// 「9999」则一步把人耗干。校验放在这里，T17 拿到的就是干净值。
const 代价上限 = { 体力: 50, 时段: 3, 金钱: 100000 }

export function clampCost(cost) {
  const warnings = []
  const out = {}
  if (!cost || typeof cost !== 'object' || Array.isArray(cost)) return { cost: out, warnings }

  for (const [键, 值] of Object.entries(cost)) {
    if (typeof 值 !== 'number' || !Number.isFinite(值)) {
      warnings.push(`代价「${键}」不是有限数字，已剔除`)
      continue
    }
    const 上限 = 代价上限[键]
    if (上限 === undefined) {
      warnings.push(`未知代价项「${键}」，已剔除`)
      continue
    }
    const 夹 = Math.max(0, Math.min(上限, 值))
    if (夹 !== 值) warnings.push(`代价 ${键} ${值} 越界，夹到 ${夹}`)
    out[键] = 夹
  }
  return { cost: out, warnings }
}

export function clampRequire(类型, require) {
  const rule = CLAMP_TABLE[类型] || CLAMP_TABLE.徒步
  const warnings = []
  const out = {}

  if (typeof require?.经验 === 'number') {
    const [lo, hi] = rule.经验
    out.经验 = Math.max(lo, Math.min(hi, require.经验))
    if (out.经验 !== require.经验) warnings.push(`经验门槛 ${require.经验} 越界，夹到 ${out.经验}`)
  }
  if (typeof require?.体力 === 'number') {
    out.体力 = Math.max(0, Math.min(100, require.体力))
  }

  if (require?.好感 && typeof require.好感 === 'object' && !Array.isArray(require.好感)) {
    out.好感 = {}
    for (const [名, 值] of Object.entries(require.好感)) {
      const id = resolveNpc(名)
      if (!id) {
        warnings.push(`好感门槛引用了未知人物「${名}」，已剔除`)
        continue
      }
      if (typeof 值 !== 'number' || !Number.isFinite(值)) {
        warnings.push(`${名} 的好感门槛不是数字，已剔除`)
        continue
      }
      const 夹 = Math.max(0, Math.min(rule.好感, 值))
      if (夹 !== 值) warnings.push(`${名} 好感门槛 ${值} 越界，夹到 ${夹}`)
      out.好感[id] = 夹
    }
  }

  if (Array.isArray(require?.物品)) {
    out.物品 = []
    for (const g of require.物品) {
      if (getGear(g)) out.物品.push(g)
      else warnings.push(`选项引用了不存在的物品「${g}」，已剔除`)
    }
  }

  return { require: out, warnings }
}

// 把 LLM 的 STATE 提议过一遍筛子。所有越权都记 warning，但不打断——游戏要能继续。
export function validateProposal(state, proposal) {
  const out = { 好感变更: [], 说话人: null, 离队: [], 记忆: [], 伏笔: { 新增: [], 已收: [] }, 选项: [], 去向: null, warnings: [] }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return out
  // 「从不抛异常」得对 state 也成立，否则调用方传进半截状态时一样白屏。
  const 队伍 = Array.isArray(state?.party) ? state.party : []
  const 当前节点 = state?.place?.nodeId ?? null

  for (const item of Array.isArray(proposal.好感) ? proposal.好感 : []) {
    if (!item || typeof item !== 'object') continue
    const npcId = resolveNpc(item.npc)
    if (!npcId) {
      out.warnings.push(`好感提议引用了未知人物「${item.npc}」，已驳回`)
      continue
    }
    if (!队伍.some((p) => p.npcId === npcId && p.在队)) {
      out.warnings.push(`${item.npc} 不在队，好感提议已驳回`)
      continue
    }
    if (typeof item.delta !== 'number' || !Number.isFinite(item.delta)) {
      out.warnings.push(`${item.npc} 的 delta 不是数字，已驳回`)
      continue
    }
    out.好感变更.push({ npcId, delta: item.delta, 重大: item.重大 === true, 因: item.因 || '' })
  }

  // 说话人。立绘舞台靠它决定谁亮起——没有这个字段，舞台上永远没人说话，
  // 「说话人高亮」这条设计就是死的。只认在队的人，认不出就留 null。
  if (typeof proposal.说话人 === 'string' && proposal.说话人.trim()) {
    const npcId = resolveNpc(proposal.说话人)
    if (!npcId) {
      out.warnings.push(`说话人认不出这个人：${proposal.说话人}`)
    } else if (!队伍.some((p) => p.npcId === npcId && p.在队)) {
      out.warnings.push(`说话人 ${proposal.说话人} 不在队伍里`)
    } else {
      out.说话人 = npcId
    }
  }

  // 离队。没有这一段，模型只能在正文里叙述某人下撤，引擎永远不知道——
  // 下一回合玩家照样能对着他搭话，好感门槛照样为他放行。
  for (const item of Array.isArray(proposal.离队) ? proposal.离队 : []) {
    if (!item || typeof item !== 'object') continue
    const npcId = resolveNpc(item.npc)
    if (!npcId) {
      out.warnings.push(`离队提议里认不出这个人：${item.npc}`)
      continue
    }
    const 同伴 = 队伍.find((p) => p.npcId === npcId)
    if (!同伴) {
      out.warnings.push(`${item.npc} 本就不在队伍里，忽略离队提议`)
      continue
    }
    if (!同伴.在队) {
      out.warnings.push(`${item.npc} 已经离队，忽略重复提议`)
      continue
    }
    out.离队.push({ npcId, 因: String(item.因 || '离队').slice(0, 30) })
  }

  for (const m of Array.isArray(proposal.记忆) ? proposal.记忆 : []) {
    if (typeof m === 'string' && m.trim()) out.记忆.push(m.trim())
  }

  const 伏笔 = proposal.伏笔
  if (伏笔 && typeof 伏笔 === 'object' && !Array.isArray(伏笔)) {
    for (const k of ['新增', '已收']) {
      for (const f of Array.isArray(伏笔[k]) ? 伏笔[k] : []) {
        if (typeof f === 'string' && f.trim()) out.伏笔[k].push(f.trim())
      }
    }
  }

  for (const opt of Array.isArray(proposal.选项) ? proposal.选项 : []) {
    if (!opt || typeof opt !== 'object') continue
    const id = typeof opt.id === 'string' ? opt.id.trim().toUpperCase() : ''
    if (!合法选项id.has(id)) {
      out.warnings.push(`选项 id「${opt.id}」非法，已丢弃`)
      continue
    }
    const { require, warnings } = clampRequire(opt.类型, opt.require)
    const { cost, warnings: cw } = clampCost(opt.cost)
    out.warnings.push(...warnings, ...cw)
    out.选项.push({ id, 类型: opt.类型 || '徒步', require, cost })
  }

  if (proposal.去向建议) {
    const id = resolveNode(proposal.去向建议)
    if (id && 当前节点 && isAdjacent(当前节点, id)) {
      out.去向 = id
    } else {
      out.warnings.push(`去向建议「${proposal.去向建议}」不是当前位置的合法相邻节点，已驳回`)
    }
  }

  return out
}

// 天气等级 1–10。计划一里 weather.等级 初始化为 1 之后没有任何写入方，
// 是个孤儿字段；而 sleep() 的「恶劣天气」又要调用方凭空判断。
// 这里给出唯一定义：从 LLM 写的天气描述里按关键词解出等级，>= 6 即恶劣。
const WEATHER_LEVELS = [
  [10, ['白化天', '白毛风']],
  [9, ['暴风雪', '雪暴']],
  [8, ['雷暴', '冰雹']],
  [7, ['暴雨', '大雪', '狂风']],
  [6, ['大风', '强风', '降雪', '雨夹雪']],
  [5, ['小雨', '阵雨', '霜冻']],
  [4, ['雾', '阴沉', '低云']],
  [3, ['阴天', '转阴天']],
  [2, ['多云', '微风']],
  [1, ['晴', '无风', '晴朗']],
]

const 认不出时的等级 = 4

export function weatherLevel(描述) {
  if (typeof 描述 !== 'string' || !描述) return 认不出时的等级
  let 最高 = 0
  for (const [级, 词表] of WEATHER_LEVELS) {
    if (级 <= 最高) continue
    if (词表.some((w) => 描述.includes(w))) 最高 = 级
  }
  return 最高 || 认不出时的等级
}

export function isHarshWeather(weather) {
  return !!weather && weather.等级 >= 6
}
