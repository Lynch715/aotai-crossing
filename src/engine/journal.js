import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'

export const MAX_EVENTS = 20

export function createJournal() {
  return { 已过节点: [], 关键事件: [], 未收伏笔: [], 已收伏笔: [], 人物状态: {} }
}

export function recordNode(journal, nodeId) {
  const 末尾 = journal.已过节点[journal.已过节点.length - 1]
  if (末尾 === nodeId) return journal
  journal.已过节点.push(nodeId)
  return journal
}

export function recordEvent(journal, clock, 文本) {
  if (!文本 || !文本.trim()) return journal
  journal.关键事件.push({ day: clock.day, slot: clock.slot, 文本: 文本.trim() })
  return journal
}

export function addForeshadow(journal, 文本) {
  if (!文本 || !文本.trim()) return journal
  const t = 文本.trim()
  if (!journal.未收伏笔.includes(t)) journal.未收伏笔.push(t)
  return journal
}

export function resolveForeshadow(journal, 文本) {
  const i = journal.未收伏笔.indexOf((文本 || '').trim())
  if (i === -1) return false
  journal.已收伏笔.push(journal.未收伏笔[i])
  journal.未收伏笔.splice(i, 1)
  return true
}

export function updateNpcStatus(journal, npcId, 状态) {
  journal.人物状态[npcId] = 状态
  return journal
}

// 上下文超限时压缩。事件截掉旧的，伏笔一条都不能丢——丢了故事就收不了线。
export function compressJournal(journal) {
  if (journal.关键事件.length > MAX_EVENTS) {
    journal.关键事件 = journal.关键事件.slice(-MAX_EVENTS)
  }
  return journal
}

// 渲染成发给 LLM 的档案片段。刻意只给状态词、不给数字好感——
// 文档禁止 LLM 开天眼，给它精确数值它就会在对话里漏出来。
export function renderJournal(journal) {
  const 节点名 = journal.已过节点.map((id) => (getNode(id) ? getNode(id).名称 : id))
  const 人物 = Object.entries(journal.人物状态).map(([id, st]) => {
    const npc = getNpc(id)
    return `${npc ? npc.名称 : id} ${st}`
  })

  const lines = ['【旅程档案】']
  lines.push(`  已过节点：${节点名.length ? 节点名.join(' → ') : '（尚未出发）'}`)

  lines.push('  关键事件：')
  if (journal.关键事件.length === 0) {
    lines.push('    （无）')
  } else {
    for (const e of journal.关键事件) lines.push(`    D${e.day}${e.slot} ${e.文本}`)
  }

  lines.push('  未收伏笔：')
  if (journal.未收伏笔.length === 0) {
    lines.push('    （无）')
  } else {
    for (const f of journal.未收伏笔) lines.push(`    ${f}`)
  }

  lines.push(`  人物：${人物.length ? 人物.join('｜') : '（无）'}`)
  return lines.join('\n')
}
