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
  const hit = ROUTE.find((n) => n.名称 === t || n.名称.startsWith(t))
  return hit ? hit.id : null
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
      if (typeof 值 !== 'number') continue
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
  const out = { 好感变更: [], 记忆: [], 伏笔: { 新增: [], 已收: [] }, 选项: [], 去向: null, warnings: [] }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return out

  for (const item of Array.isArray(proposal.好感) ? proposal.好感 : []) {
    if (!item || typeof item !== 'object') continue
    const npcId = resolveNpc(item.npc)
    if (!npcId) {
      out.warnings.push(`好感提议引用了未知人物「${item.npc}」，已驳回`)
      continue
    }
    if (!state.party.some((p) => p.npcId === npcId && p.在队)) {
      out.warnings.push(`${item.npc} 不在队，好感提议已驳回`)
      continue
    }
    if (typeof item.delta !== 'number' || !Number.isFinite(item.delta)) {
      out.warnings.push(`${item.npc} 的 delta 不是数字，已驳回`)
      continue
    }
    out.好感变更.push({ npcId, delta: item.delta, 重大: item.重大 === true, 因: item.因 || '' })
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
    out.warnings.push(...warnings)
    out.选项.push({ id, 类型: opt.类型 || '徒步', require, cost: opt.cost || {} })
  }

  if (proposal.去向建议) {
    const id = resolveNode(proposal.去向建议)
    if (id && isAdjacent(state.place.nodeId, id)) {
      out.去向 = id
    } else {
      out.warnings.push(`去向建议「${proposal.去向建议}」不是当前位置的合法相邻节点，已驳回`)
    }
  }

  return out
}
