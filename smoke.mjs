// 端到端冒烟：造一个第 4 天麦秸岭的局面，判定一个必败选项，
// 把既成事实发给真实 API，解析并校验返回。
// 用法：AOTAI_KEY=sk-xxx node smoke.mjs [preset] [model]
import { createInitialState } from './src/engine/state.js'
import { createJournal, recordNode, recordEvent, addForeshadow, updateNpcStatus } from './src/engine/journal.js'
import { judgeOption } from './src/engine/threshold.js'
import { applyStepCost, stepStaminaCost } from './src/engine/consume.js'
import { makeRng } from './src/engine/rng.js'
import { buildSystemPrompt, buildUserMessage } from './src/llm/prompt.js'
import { streamChat, PRESETS } from './src/llm/client.js'
import { parseTurn } from './src/llm/parser.js'
import { validateProposal } from './src/llm/validate.js'
import { runTurn } from './src/turn.js'

const key = process.env.AOTAI_KEY
if (!key) {
  console.error('请设置 AOTAI_KEY 环境变量')
  process.exit(1)
}

const preset = PRESETS.find((p) => p.id === (process.argv[2] || 'deepseek'))
if (!preset) {
  console.error(`未知预设。可选：${PRESETS.map((p) => p.id).join(', ')}`)
  process.exit(1)
}
const config = { baseURL: preset.baseURL, apiKey: key, model: process.argv[3] || preset.默认模型 }

// —— 造局面 ——
const state = createInitialState({
  种子: 42, 季节: '秋季',
  pc: { 名字: '周野', 职业: '户外器材工程师', 年龄: 28, 性别: '男', 性格: 'renside',
        外貌: '偏瘦，晒得黑，左手虎口有旧疤', 技能: ['装备维修', '路线规划', '生火'], 户外经验: 38 },
  队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'linxiaoya', 好感: 62 }],
  背包: [
    { gearId: 'backpack', 档: '主流', 数量: 1 }, { gearId: 'tent', 档: '主流', 数量: 1 },
    { gearId: 'sleeping_bag', 档: '主流', 数量: 1 }, { gearId: 'staple_food', 档: '主流', 数量: 5 },
    { gearId: 'stove', 档: '主流', 数量: 1 }, { gearId: 'freeze_dried', 档: '主流', 数量: 3 },
  ],
  金钱: 4320,
})
state.clock = { day: 4, slot: '中' }
state.place = { nodeId: 'maijieling', 海拔: 3500 }
state.weather = { 状态: '大风', 等级: 6 }
state.pc.体力 = 50
state.flags.高海拔过夜数 = 2

const journal = createJournal()
recordNode(journal, 'tangkou'); recordNode(journal, 'yingdi2900')
recordNode(journal, 'shuiwozi'); recordNode(journal, 'maijieling')
recordEvent(journal, { day: 2, slot: '晚' }, '王大鹏膝盖旧伤复发，你分了他布洛芬')
recordEvent(journal, { day: 3, slot: '中' }, '水窝子遇到独行的沈冰，没能同行')
addForeshadow(journal, '石缝里那截褪色的红色路标带，还没人去查')
addForeshadow(journal, '对讲机里断续传出的呼叫，未确认来源')
updateNpcStatus(journal, 'linxiaoya', '轻度高反')
updateNpcStatus(journal, 'chenyan', '正常')

// —— 判定先行 ——
const 选项C = { id: 'C', 类型: '高危', require: { 经验: 60 }, cost: { 体力: 20 } }
const 判定 = judgeOption(选项C, state, makeRng(state.meta.随机种子))
const 消耗 = stepStaminaCost(state)
const 体力前 = state.pc.体力
applyStepCost(state)
state.clock.slot = '晚'

console.log('=== 判定（调用 LLM 之前已完成）===')
console.log(`选项 C 门槛经验 60，当前 ${state.pc.户外经验} → 差距 ${判定.gap}，成功率 ${判定.chance}`)
console.log(`结果：${判定.outcome === 'success' ? '成功' : '失败'}`)
console.log(`体力 ${体力前} → ${state.pc.体力}（消耗 ${消耗}）\n`)

// —— 组装并发送 ——
const messages = [
  { role: 'system', content: buildSystemPrompt() },
  { role: 'user', content: buildUserMessage({
      state, journal,
      既成事实: {
        选择: 'C 你打头阵，用绳子做保护',
        判定: 判定.outcome === 'success' ? '成功' : '失败',
        原因: 判定.reasons[0] || '',
        已结算: `中→晚｜体力 ${体力前}→${state.pc.体力}｜位置不变`,
      },
      最近回合: ['（上一回合：队伍在麦秸岭下方休整，陈岩提醒过刃脊要一个一个来。）'],
  }) },
]

console.log(`=== 请求 ${preset.名称} / ${config.model} ===`)
console.log(`system ${messages[0].content.length} 字，user ${messages[1].content.length} 字\n`)

const t0 = Date.now()
let 首字延迟 = null
const { text } = await streamChat({
  config, messages,
  onDelta: (d) => {
    if (首字延迟 === null) 首字延迟 = Date.now() - t0
    process.stdout.write(d)
  },
})
console.log(`\n\n=== 用时 ${Date.now() - t0}ms，首字 ${首字延迟}ms ===\n`)

// —— 解析与校验 ——
const parsed = parseTurn(text)
console.log('=== 解析 ===')
console.log(`标题：${parsed.标题 || '(空)'}`)
console.log(`正文：${parsed.剧情.length} 字`)
console.log(`万象：${parsed.万象.length} 条`)
console.log(`选项：${parsed.选项.map((o) => o.id).join(' ') || '(无)'}`)
console.log(`STATE：${parsed.state ? '已解析' : '缺失/失败'}`)
if (parsed.errors.length) console.log(`解析问题：\n  ${parsed.errors.join('\n  ')}`)

if (parsed.state) {
  const v = validateProposal(state, parsed.state)
  console.log('\n=== 校验 ===')
  console.log(`好感变更：${v.好感变更.map((c) => `${c.npcId} ${c.delta > 0 ? '+' : ''}${c.delta}`).join('、') || '无'}`)
  console.log(`记忆：${v.记忆.length} 条｜新伏笔：${v.伏笔.新增.length}｜收伏笔：${v.伏笔.已收.length}`)
  console.log(`选项申报：${v.选项.map((o) => `${o.id}(${o.类型})`).join(' ') || '无'}`)
  console.log(`去向：${v.去向 || '未提议或不合法'}`)
  if (v.warnings.length) console.log(`校验警告：\n  ${v.warnings.join('\n  ')}`)
}

// —— 判定门 ——
const 关键项 = [
  ['正文 200 字以上', parsed.剧情.length >= 200],
  ['万象 4 条', parsed.万象.length === 4],
  ['选项 4 个', parsed.选项.length === 4],
  ['STATE 解析成功', parsed.state !== null],
  ['选项带 require 申报', !!parsed.state && Array.isArray(parsed.state.选项) && parsed.state.选项.length > 0],
]
console.log('\n=== 冒烟结论 ===')
for (const [名, 过] of 关键项) console.log(`${过 ? '✓' : '✗'} ${名}`)
const 零件全绿 = 关键项.every(([, 过]) => 过)
// —— 走完整编排再跑一回合，验证判定→请求→解析→校验→原子应用这条线 ——
console.log('\n\n=== 完整编排 runTurn ===')
const 体力前2 = state.pc.体力
const 时段前2 = state.clock.slot
const r2 = await runTurn({
  state, journal, config,
  选中项: { id: 'B', 类型: '徒步', 文本: '退回水窝子等风停', require: { 经验: 25 }, cost: { 体力: 14 } },
  最近回合: [text],
  rng: makeRng(7),
  onDelta: (d) => process.stdout.write(d),
})

console.log('\n')
if (!r2.ok) {
  console.log(`✗ 编排失败：${r2.error.提示 || r2.error.message}`)
  console.log(`  回滚校验：体力 ${state.pc.体力}（应为 ${体力前2}）、时段 ${state.clock.slot}（应为 ${时段前2}）`)
} else {
  console.log(`降级：${r2.降级 ? '是' : '否'}｜选项 ${r2.选项.length} 个｜位置 ${state.place.nodeId}`)
  console.log(`好感：${state.party.map((p) => `${p.npcId} ${p.好感}`).join('、')}`)
  console.log(`档案：事件 ${journal.关键事件.length} 条、未收伏笔 ${journal.未收伏笔.length} 条`)
  if (r2.warnings.length) console.log(`警告：\n  ${r2.warnings.join('\n  ')}`)
  console.log(`结局：${r2.ending ? r2.ending.type : '未触发'}`)
  console.log(`\n${r2.降级 ? '△ 走了降级路径——尾段两次补救都没成，检查 system prompt 的协议段' : '✓ 完整链路通'}`)
}

process.exit(零件全绿 && r2.ok ? 0 : 1)
