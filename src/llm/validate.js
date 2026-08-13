import { NPCS, getNpc } from '../data/npcs.js'
import { getGear, ALL_GEAR } from '../data/gear.js'
import { ROUTE, getNode, isAdjacent } from '../data/route.js'

// 门槛夹取表。LLM 现编的门槛不能超出这个范围，否则「喝口水」也要求经验 80。
export const CLAMP_TABLE = {
  社交: { 好感: 85, 经验: [0, 30] },
  徒步: { 好感: 60, 经验: [20, 75] },
  高危: { 好感: 70, 经验: [40, 90] },
}

const 合法选项id = new Set(['A', 'B', 'C', 'D'])

function 现有装备(state, gearId) {
  return Array.isArray(state?.pack) && state.pack.some((p) => p.gearId === gearId)
}

// LLM 用中文名指代装备，映射回 id；id 直传也认。
// 人物、地点早就有中文名解析，唯独装备漏了——而 prompt 的装备清单里
// 此前连 id 都没给过，模型只见过「综合医药包」这样的名字，根本写不出
// first_aid。结果是每回合都弹「选项引用了不存在的物品，已剔除」。
// 模糊匹配只在唯一命中时才认：「睡袋」同时命中三件装备，猜错等于
// 替模型改需求，宁可驳回。
export function resolveGear(name) {
  if (!name || typeof name !== 'string') return null
  const t = name.trim()
  if (getGear(t)) return t
  const 精确 = ALL_GEAR.find((g) => g.名称 === t)
  if (精确) return 精确.id
  const 候选 = ALL_GEAR.filter((g) => g.名称.includes(t))
  return 候选.length === 1 ? 候选[0].id : null
}

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
      const id = resolveGear(g)
      if (id) out.物品.push(id)
      else warnings.push(`选项引用了不存在的物品「${g}」，已剔除`)
    }
  }

  return { require: out, warnings }
}

const 入队上限 = 4
const 伤病名上限 = 12
const 合法严重度 = new Set(['轻', '重'])

// 把 LLM 的 STATE 提议过一遍筛子。所有越权都记 warning，但不打断——游戏要能继续。
export function validateProposal(state, proposal) {
  // warnings 是给玩家看的「真拦截」；微调 是护栏的日常工作（门槛/代价夹取），
  // 只进调试信息。混在一起的话，模型报个「经验:15」被夹到 20 这种鸡毛蒜皮
  // 也会让界面弹「本回合有 1 处提议被拦下」——狼来了喊多了，真警告没人看。
  const out = { 好感变更: [], 说话人: null, 离队: [], 入队: [], 伤病新增: [], 伤病已处理: [], 记忆: [], 伏笔: { 新增: [], 已收: [] }, 选项: [], 去向: null, warnings: [], 微调: [] }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return out
  // 「从不抛异常」得对 state 也成立，否则调用方传进半截状态时一样白屏。
  const 队伍 = Array.isArray(state?.party) ? state.party : []
  const 当前节点 = state?.place?.nodeId ?? null

  // —— 入队（先算：同一回合里模型常「入队 + 给新人好感/让新人说话」一起报，
  // 后面的在队判定要把本回合刚入队的人也算上）——
  const 新入队 = new Set()
  for (const item of Array.isArray(proposal.入队) ? proposal.入队 : []) {
    if (!item || typeof item !== 'object') continue
    const npcId = resolveNpc(item.npc)
    if (!npcId) {
      out.warnings.push(`入队提议里认不出这个人：${item.npc}`)
      continue
    }
    const 旧 = 队伍.find((p) => p.npcId === npcId)
    if (旧 && 旧.在队) {
      out.warnings.push(`${item.npc} 已经在队，忽略重复入队`)
      continue
    }
    if (旧 && !旧.在队) {
      out.warnings.push(`${item.npc} 已经离队，离队不可逆，入队提议已驳回`)
      continue
    }
    const 现有人数 = 队伍.filter((p) => p.在队).length + 新入队.size
    if (现有人数 >= 入队上限) {
      out.warnings.push(`队伍已满 ${入队上限} 人，${item.npc} 的入队提议已驳回`)
      continue
    }
    新入队.add(npcId)
    out.入队.push({ npcId, 因: String(item.因 || '').slice(0, 30) })
  }

  const 在队或将入队 = (npcId) =>
    队伍.some((p) => p.npcId === npcId && p.在队) || 新入队.has(npcId)

  // 主角名字出现在人物字段里是模型最高频的「口误」（几乎每回合都犯）。
  // 它无害——主角不是 NPC，没有好感也不上立绘舞台——静默忽略即可。
  // 记警告的话，玩家每回合都看到「本回合有 1 处提议被拦下」，狼来了喊多了，
  // 真出问题的警告反而没人看。
  const 是主角 = (名) => !!state?.pc?.名字 && String(名 || '').trim() === state.pc.名字

  for (const item of Array.isArray(proposal.好感) ? proposal.好感 : []) {
    if (!item || typeof item !== 'object') continue
    if (是主角(item.npc)) continue
    const npcId = resolveNpc(item.npc)
    if (!npcId) {
      out.warnings.push(`好感提议引用了未知人物「${item.npc}」，已驳回`)
      continue
    }
    if (!在队或将入队(npcId)) {
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
  if (typeof proposal.说话人 === 'string' && proposal.说话人.trim() && !是主角(proposal.说话人)) {
    const npcId = resolveNpc(proposal.说话人)
    if (!npcId) {
      out.warnings.push(`说话人认不出这个人：${proposal.说话人}`)
    } else if (!在队或将入队(npcId)) {
      out.warnings.push(`说话人 ${proposal.说话人} 不在队伍里`)
    } else {
      out.说话人 = npcId
    }
  }

  // —— 伤病。主角的伤病是「重伤拖 2 天致死」结局与医药包的唯一事件源。
  // 新增每回合最多一条（防模型一句话打断三根骨头）；处理必须包里真有医药包。
  const 伤病 = proposal.伤病
  if (伤病 && typeof 伤病 === 'object' && !Array.isArray(伤病)) {
    const 现有伤 = Array.isArray(state?.pc?.伤病) ? state.pc.伤病 : []
    let 已收新伤 = false
    for (const item of Array.isArray(伤病.新增) ? 伤病.新增 : []) {
      if (!item || typeof item !== 'object') continue
      const 名称 = String(item.名称 || '').trim().slice(0, 伤病名上限)
      if (!名称) continue
      if (!合法严重度.has(item.严重度)) {
        out.warnings.push(`伤病「${名称}」的严重度只能是 轻/重，已驳回`)
        continue
      }
      if (已收新伤) {
        out.warnings.push(`一回合最多新增一处伤病，「${名称}」已驳回`)
        continue
      }
      if (现有伤.some((w) => w.名称 === 名称 && !w.已处理)) {
        out.warnings.push(`「${名称}」已在伤病列表里，忽略重复`)
        continue
      }
      let 严重度 = item.严重度
      // 护膝对膝伤的抵抗：重伤降为轻伤。这是「膝伤类事件抵抗」这行商品说明
      // 兑现的地方——不在这里兑现，护膝就是 0.15kg 的死重。
      if (严重度 === '重' && 名称.includes('膝') && 现有装备(state, 'knee_brace')) {
        严重度 = '轻'
        out.warnings.push(`护膝挡了一下：「${名称}」由重伤降为轻伤`)
      }
      out.伤病新增.push({ 名称, 严重度 })
      已收新伤 = true
    }
    for (const 名 of Array.isArray(伤病.已处理) ? 伤病.已处理 : []) {
      const t = String(名 || '').trim()
      if (!t) continue
      if (!现有伤.some((w) => w.名称 === t && !w.已处理)) {
        out.warnings.push(`要处理的伤病「${t}」不存在或已处理，已驳回`)
        continue
      }
      if (!现有装备(state, 'first_aid')) {
        out.warnings.push(`包里没有医药包，无法处理「${t}」`)
        continue
      }
      out.伤病已处理.push(t)
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
    // 夹取是常态不是事故：数值收进 微调，只有「引用不存在的物品/人物」
    // 这类真问题才留在 warnings 里露脸
    for (const w of [...warnings, ...cw]) {
      if (w.includes('越界，夹到')) out.微调.push(w)
      else out.warnings.push(w)
    }
    out.选项.push({ id, 类型: opt.类型 || '徒步', require, cost })
  }

  if (proposal.去向建议) {
    const id = resolveNode(proposal.去向建议)
    if (id && id === 当前节点) {
      // 填了当前所在地 = 原地不动。这是模型的常见写法而非越权，静默忽略。
    } else if (id && 当前节点 && isAdjacent(当前节点, id)) {
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
