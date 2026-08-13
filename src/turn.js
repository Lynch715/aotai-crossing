import { snapshot, restore, consumeItem } from './engine/state.js'
import { makeRng } from './engine/rng.js'
import { judgeOption } from './engine/threshold.js'
import { applyStepCost, advanceTimeSlot, stepStaminaCost, 调整体力 } from './engine/consume.js'
import { applyAffinityDelta, initialAffinity } from './engine/affinity.js'
import { npcLeaves, npcJoins } from './engine/party.js'
import { checkEnding, applyEnding } from './engine/ending.js'
import { recordNode, recordEvent, addForeshadow, resolveForeshadow, compressJournal } from './engine/journal.js'
import { getNode } from './data/route.js'
import { getNpc } from './data/npcs.js'
import { buildSystemPrompt, buildUserMessage, buildRepairMessage } from './llm/prompt.js'
import { parseTurn } from './llm/parser.js'
import { validateProposal, clampRequire, clampCost, weatherLevel } from './llm/validate.js'
import { streamChat } from './llm/client.js'

export const MAX_REPAIR = 2

// 尾段彻底解析不出来时的兜底选项。宁可玩法单调，也不能让游戏卡死。
// 字段与正常选项同形：UI 渲染和回传 选中项 时不必区分两种形状。
export const FALLBACK_OPTIONS = [
  { id: 'A', 文本: '继续按原计划前进', 类型: '徒步', require: {}, cost: {} },
  { id: 'B', 文本: '原地休整，恢复体力', 类型: '徒步', require: {}, cost: {} },
  { id: 'C', 文本: '找同伴聊两句', 类型: '社交', require: {}, cost: {} },
  { id: 'D', 文本: '清点装备和剩余补给', 类型: '徒步', require: {}, cost: {} },
]

function 就地覆盖(target, source) {
  for (const k of Object.keys(target)) delete target[k]
  Object.assign(target, source)
}

const 时段表 = ['早', '中', '晚']
const 判定失败惩罚 = 5
const 处理伤病耗材 = 25

// 每回合的掷骰种子 = 存档种子 + 回合序号。回合序号从时钟推导——时钟每回合
// 必进一格、永不回头，天然就是回合计数器。
// 绝不能用「最近回合数组的长度」这类会封顶的东西做偏移：数组封顶在 4 之后
// 每回合种子相同、每回合又只掷一次骰，掷出的就永远是同一个数——
// 所有「勉强 70%」的选项从第 5 回合起要么永远成功要么永远失败。
export function turnSeed(state) {
  const 回合序号 = (state.clock.day - 1) * 时段表.length + Math.max(0, 时段表.indexOf(state.clock.slot))
  return (state.meta.随机种子 + 回合序号) >>> 0
}

// 跑完一整个回合。约定：
// - 判定与硬资源结算在请求之前完成，LLM 拿到的是既成事实
// - 请求彻底失败 → 整体回滚，玩家的选择不被消费
// - 尾段解析不出来 → 正文保留、不结算、给兜底选项，游戏继续
export async function runTurn({
  state, journal, 选中项, 最近回合 = [], config,
  onDelta, streamImpl = streamChat, rng, signal,
}) {
  // 已经落幕的局不再推进。引擎不拦的话，UI 多点一次就会又算出一个结局对象。
  if (state.phase === '结局') {
    return { ok: false, 降级: false, error: { kind: 'ended', 提示: '这一局已经结束了。' }, ending: state.ending }
  }

  const snap = snapshot(state)
  const 档案快照 = JSON.stringify(journal)

  try {
    // —— 判定先行 ——
    // 防御性重夹：选项的 require/cost 本该是上回合 validateProposal 夹取过的版本，
    // 但那全靠 UI 自觉存对东西。这里再夹一次，夹取就与调用方的纪律无关了。
    const { require: 净门槛 } = clampRequire(选中项.类型, 选中项.require)
    const { cost: 净代价 } = clampCost(选中项.cost)
    选中项 = { ...选中项, require: 净门槛, cost: 净代价 }

    // rng 缺省时按「存档种子 + 回合序号」推导（见 turnSeed），保证同一存档
    // 重放一致，且每回合掷出的点数各不相同。
    const 判定 = judgeOption(选中项, state, rng || makeRng(turnSeed(state)))
    const 体力前 = state.pc.体力
    const 金钱前 = state.money

    // —— 硬资源结算：LLM 完全不参与 ——
    // 选项申报的 cost 是「这一步总共多累」，与基础步进消耗取大，不叠加——
    // 叠加会把每个 cost 都变相加价一个基础步进，跟界面上标的价对不上。
    const 基础步进 = stepStaminaCost(state)
    applyStepCost(state)
    if (typeof 净代价.体力 === 'number' && 净代价.体力 > 基础步进) {
      调整体力(state, -(净代价.体力 - 基础步进))
    }
    if (typeof 净代价.金钱 === 'number' && 净代价.金钱 > 0) {
      state.money = Math.max(0, state.money - 净代价.金钱)
    }
    // 判定失败不能白失败——否则成功与失败在引擎层是等价的，
    // 「明码标价的概率」就没有任何分量。
    if (判定.outcome === 'fail') 调整体力(state, -判定失败惩罚)

    // 时段推进：1 个基础时段 + 选项申报的额外时段。跨天连锁（睡眠、日粮、
    // 断粮惩罚）全在 advanceTimeSlot 里，这里只收集要告诉模型的事实。
    const 推进备注 = []
    const 推进次数 = 1 + (typeof 净代价.时段 === 'number' ? Math.max(0, Math.floor(净代价.时段)) : 0)
    for (let i = 0; i < 推进次数; i++) {
      const r = advanceTimeSlot(state)
      if (r.跨天 && r.欠缺 > 0) 推进备注.push(`断粮：今天少吃了 ${r.欠缺} 份主粮，体力额外受损`)
      if (r.跨天 && state.flags.失温连败 > 0) 推进备注.push(`夜里睡袋扛不住低温，出现失温征兆（连续 ${state.flags.失温连败} 晚）`)
    }
    if (金钱前 !== state.money) 推进备注.push(`花掉 ¥${金钱前 - state.money}`)

    const 既成事实 = {
      选择: `${选中项.id} ${选中项.文本 || ''}`.trim(),
      判定: 判定.outcome === 'success' ? '成功' : '失败',
      原因: 判定.reasons[0] || '',
      已结算: [`体力 ${体力前}→${state.pc.体力}｜推进到第${state.clock.day}天${state.clock.slot}`, ...推进备注].join('｜'),
    }

    // —— 请求 ——
    const system = buildSystemPrompt()
    const user = buildUserMessage({ state, journal, 既成事实, 最近回合 })
    const { text, finish, reasoning } = await streamImpl({
      config, onDelta, signal,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    })

    let parsed = parseTurn(text)
    let 最终原文 = text

    // —— 正文彻底缺失就整回合重写一次 ——
    // 解析层能从散落文本里回收漏标记的正文；走到这里还是空，说明模型真的
    // 一个字正文都没写（只给了万象/选项/STATE）。这不是格式问题而是内容
    // 缺失，只补尾段救不回来——重发完整请求一次，两次都空才认命。
    if (!parsed.剧情.trim()) {
      const 重写 = await streamImpl({
        config, onDelta, signal,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      })
      const 再解析 = parseTurn(重写.text)
      if (再解析.剧情.trim()) {
        parsed = 再解析
        最终原文 = 重写.text
        parsed.errors.push('第一次回复没有正文，已整回合重写')
      }
    }

    // —— 尾段崩了就补救：只重发尾段，不重写正文 ——
    let 补救次数 = 0
    while (parsed.state === null && 补救次数 < MAX_REPAIR) {
      补救次数++
      const 已生成正文 = 最终原文
      const 补救 = await streamImpl({
        config, signal,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildRepairMessage(已生成正文) },
        ],
      })
      const 再解析 = parseTurn(补救.text)
      if (再解析.state !== null) {
        parsed = { ...parsed, state: 再解析.state }
        break
      }
    }

    const 结果 = {
      ok: true, 降级: false, 判定,
      标题: parsed.标题, 剧情: parsed.剧情, 万象: parsed.万象,
      选项: parsed.选项, warnings: [...parsed.errors], ending: null, 原文: 最终原文,
      finish: finish ?? null, reasoning: reasoning ?? 0,
    }

    // finish_reason === 'length' 是被 max_tokens 截断的铁证。
    // 不点破的话，正文缺一半、STATE 没了，只能靠猜。
    if (finish === 'length') {
      结果.warnings.push(`模型回复被 max_tokens 截断（finish_reason=length）${reasoning ? `，其中思考内容 ${reasoning} 字` : ''}——调大「最大输出」再试`)
    } else if (reasoning > 0) {
      结果.warnings.push(`模型输出了 ${reasoning} 字思考内容（不显示，但占用输出预算）`)
    }

    // —— 降级：正文保留，本回合不结算 ——
    if (parsed.state === null) {
      结果.降级 = true
      结果.选项 = FALLBACK_OPTIONS.map((o) => ({ ...o }))
      结果.warnings.push(`STATE 补救 ${MAX_REPAIR} 次仍失败，本回合不结算`)
      结果.ending = checkEnding(state)
      if (结果.ending) applyEnding(state, 结果.ending)
      return 结果
    }

    // —— 原子应用 ——
    const v = validateProposal(state, parsed.state)
    结果.warnings.push(...v.warnings)

    // 入队先于好感应用——同一回合里模型常常「入队 + 给新人好感」一起报。
    for (const 入 of v.入队) {
      const npc = getNpc(入.npcId)
      const 成功 = npcJoins(state, journal, 入.npcId, {
        // 初始好感沿用捏人性格匹配的那套算法，途中相遇不例外
        好感: initialAffinity(state.pc.性格, 入.npcId),
        状态: npc?.状态 || '正常',
      })
      if (成功) recordEvent(journal, state.clock, `${npc ? npc.名称 : 入.npcId}加入了队伍${入.因 ? `：${入.因}` : ''}`)
    }

    for (const c of v.好感变更) applyAffinityDelta(state, c.npcId, c.delta, { 重大: c.重大 })
    结果.说话人 = v.说话人
    for (const 离 of v.离队) {
      npcLeaves(state, journal, 离.npcId, 离.因)
    }
    // 伤病：新伤入册（起始day 用于「重伤拖 2 天致死」的结局判定），
    // 处理旧伤要消耗医药包耗材——validate 已确认包里有医药包。
    for (const w of v.伤病新增) {
      state.pc.伤病.push({ 名称: w.名称, 严重度: w.严重度, 起始day: state.clock.day, 已处理: false })
      recordEvent(journal, state.clock, `${state.pc.名字}${w.严重度 === '重' ? '重伤' : '受伤'}：${w.名称}`)
    }
    for (const 名 of v.伤病已处理) {
      const w = state.pc.伤病.find((x) => x.名称 === 名 && !x.已处理)
      if (w) {
        w.已处理 = true
        consumeItem(state, 'first_aid', 处理伤病耗材)
      }
    }

    for (const m of v.记忆) recordEvent(journal, state.clock, m)
    for (const f of v.伏笔.新增) addForeshadow(journal, f)
    for (const f of v.伏笔.已收) resolveForeshadow(journal, f)

    if (v.去向) {
      state.place.nodeId = v.去向
      state.place.海拔 = getNode(v.去向).海拔
      recordNode(journal, v.去向)
    }
    if (parsed.state.天气建议) {
      // 这是唯一不经 validateProposal 的 LLM 字段（纯展示、不参与任何判定），
      // 但仍要截断——模型偶尔会把整段天气描写塞进来。
      // 先按完整描述解析等级，再截断显示文本。反过来的话，模型写了长句时
      // 关键词会被切掉——「…傍晚可能暴风雪」截到 40 字只剩「多云」，
      // 9 级暴风雪静默降成 2 级，没有任何报错。
      const 全文 = String(parsed.state.天气建议)
      state.weather = { 状态: 全文.slice(0, 40), 等级: weatherLevel(全文) }
    }

    // LLM 申报的门槛挂回选项上，供下回合判定与置灰使用
    for (const o of 结果.选项) {
      const 申报 = v.选项.find((x) => x.id === o.id)
      if (申报) {
        o.类型 = 申报.类型
        o.require = 申报.require
        o.cost = 申报.cost
      } else {
        o.类型 = '徒步'
        o.require = {}
        o.cost = {}
      }
    }

    compressJournal(journal)

    结果.ending = checkEnding(state)
    if (结果.ending) applyEnding(state, 结果.ending)

    return 结果
  } catch (err) {
    // 铁律：任何故障都不能留下半应用的脏状态
    就地覆盖(state, restore(snap))
    就地覆盖(journal, JSON.parse(档案快照))
    return { ok: false, 降级: false, error: err, warnings: [err.提示 || err.message] }
  }
}
