import { snapshot, restore } from './engine/state.js'
import { makeRng } from './engine/rng.js'
import { judgeOption } from './engine/threshold.js'
import { applyStepCost, advanceSlot, dailyUpkeep, sleep } from './engine/consume.js'
import { applyAffinityDelta } from './engine/affinity.js'
import { npcLeaves } from './engine/party.js'
import { checkEnding, applyEnding } from './engine/ending.js'
import { recordNode, recordEvent, addForeshadow, resolveForeshadow, compressJournal } from './engine/journal.js'
import { getNode } from './data/route.js'
import { buildSystemPrompt, buildUserMessage, buildRepairMessage } from './llm/prompt.js'
import { parseTurn } from './llm/parser.js'
import { validateProposal, clampRequire, clampCost, weatherLevel, isHarshWeather } from './llm/validate.js'
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

// 跑完一整个回合。约定：
// - 判定与硬资源结算在请求之前完成，LLM 拿到的是既成事实
// - 请求彻底失败 → 整体回滚，玩家的选择不被消费
// - 尾段解析不出来 → 正文保留、不结算、给兜底选项，游戏继续
export async function runTurn({
  state, journal, 选中项, 最近回合 = [], config,
  onDelta, streamImpl = streamChat, rng,
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

    // rng 缺省时按存档种子推导，而不是退化成恒定 0.5。
    // spec 承诺「同一存档重放结果一致」，一个常量默认值会让这条承诺静默失效，
    // 而且失效得毫无声响——调用方永远不会发现自己忘了传。
    const 判定 = judgeOption(选中项, state, rng || makeRng(state.meta.随机种子))
    const 体力前 = state.pc.体力
    const 日前 = state.clock.day

    applyStepCost(state)
    advanceSlot(state)
    if (state.clock.day !== 日前) {
      // 跨天 = 过了一夜。睡眠是体力唯一的大额回复（+25），也是高山适应与
      // 失温判定的唯一触发点——不在这里调 sleep()，三件事会同时失效：
      // 体力只减不增、3400m 以上永远吃未适应惩罚、失温结局永远走不到。
      // 恶劣与否一律按 weather.等级 判（≥6 即恶劣），不让调用方各猜各的。
      sleep(state, { 恶劣天气: isHarshWeather(state.weather) })
      dailyUpkeep(state)
    }

    const 既成事实 = {
      选择: `${选中项.id} ${选中项.文本 || ''}`.trim(),
      判定: 判定.outcome === 'success' ? '成功' : '失败',
      原因: 判定.reasons[0] || '',
      已结算: `体力 ${体力前}→${state.pc.体力}｜推进到第${state.clock.day}天${state.clock.slot}`,
    }

    // —— 请求 ——
    const system = buildSystemPrompt()
    const user = buildUserMessage({ state, journal, 既成事实, 最近回合 })
    const { text, finish, reasoning } = await streamImpl({
      config, onDelta,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    })

    let parsed = parseTurn(text)

    // —— 尾段崩了就补救：只重发尾段，不重写正文 ——
    let 补救次数 = 0
    while (parsed.state === null && 补救次数 < MAX_REPAIR) {
      补救次数++
      const 已生成正文 = text
      const 补救 = await streamImpl({
        config,
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
      选项: parsed.选项, warnings: [...parsed.errors], ending: null, 原文: text,
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

    for (const c of v.好感变更) applyAffinityDelta(state, c.npcId, c.delta, { 重大: c.重大 })
    结果.说话人 = v.说话人
    for (const 离 of v.离队) {
      npcLeaves(state, journal, 离.npcId, 离.因)
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
