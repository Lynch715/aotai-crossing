// 2026-08-13 审计修复的回归测试。每个 test 对应报告里的一个问题编号。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTurn, turnSeed } from '../src/turn.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'
import { checkEnding } from '../src/engine/ending.js'
import { validateProposal } from '../src/llm/validate.js'
import { buildSystemPrompt, buildUserMessage } from '../src/llm/prompt.js'
import { parseTurn } from '../src/llm/parser.js'
import { actionsViewModel } from '../src/ui/screen-game.js'

function 局面(over = {}) {
  const s = createInitialState({
    种子: 42, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'linxiaoya', 好感: 62 }],
    背包: [{ gearId: 'staple_food', 档: '主流', 数量: 14 }],
    金钱: 4320,
  })
  s.clock = { day: 4, slot: '早' }
  s.place = { nodeId: 'shuiwozi', 海拔: 3100 }
  s.pc.体力 = 100
  s.flags.高海拔过夜数 = 2
  Object.assign(s, over)
  return s
}

const 极简回复 = async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' })
const 假配置 = { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' }

// ── #1 掷骰种子 ────────────────────────────────────────────────────

test('#1 回合种子随时钟推进而变化，同一时钟恒定', () => {
  const s = 局面()
  const a = turnSeed(s)
  assert.equal(turnSeed(s), a, '同一时钟应得同一种子')
  s.clock = { day: 4, slot: '中' }
  const b = turnSeed(s)
  s.clock = { day: 5, slot: '早' }
  const c = turnSeed(s)
  assert.ok(new Set([a, b, c]).size === 3, `种子应逐回合变化：${[a, b, c]}`)
})

test('#1 连跑十个回合，勉强档的掷骰点数不再是同一个数', async () => {
  const s = 局面()
  const 点数 = new Set()
  for (let i = 0; i < 10 && s.phase !== '结局'; i++) {
    const r = await runTurn({
      state: s, journal: createJournal(),
      // 经验门槛 43 → 差 5 → 62%，恒落掷骰档
      选中项: { id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 43 }, cost: {} },
      config: 假配置, streamImpl: 极简回复,
    })
    if (r.ok && r.判定.roll !== null) 点数.add(r.判定.roll)
  }
  assert.ok(点数.size > 1, `十个回合掷出的点数全都一样：${[...点数]}`)
})

// ── #3 cost 结算 ──────────────────────────────────────────────────

test('#3 选项申报的体力代价真的会扣（与基础步进取大，不叠加）', async () => {
  const s = 局面()
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '重活', 类型: '徒步', require: {}, cost: { 体力: 30 } },
    config: 假配置, streamImpl: 极简回复,
  })
  assert.equal(s.pc.体力, 70, `应按 cost 30 扣（大于基础步进），实为 ${100 - s.pc.体力}`)
})

test('#3 金钱代价从现金里扣，且不扣成负数', async () => {
  const s = 局面()
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '雇背工', 类型: '徒步', require: {}, cost: { 金钱: 500 } },
    config: 假配置, streamImpl: 极简回复,
  })
  assert.equal(s.money, 4320 - 500)
})

test('#3 时段代价额外推进时钟', async () => {
  const s = 局面()
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '绕远路', 类型: '徒步', require: {}, cost: { 时段: 1 } },
    config: 假配置, streamImpl: 极简回复,
  })
  assert.equal(s.clock.slot, '晚', '早 + 基础1格 + 代价1格 = 晚')
})

// ── #12 判定失败要付出代价 ─────────────────────────────────────────

test('#12 判定失败比成功多扣体力', async () => {
  const 跑一次 = async (require) => {
    const s = 局面()
    await runTurn({
      state: s, journal: createJournal(),
      选中项: { id: 'A', 文本: '试', 类型: '高危', require, cost: {} },
      config: 假配置, streamImpl: 极简回复,
    })
    return s.pc.体力
  }
  const 成功后 = await 跑一次({})           // 无门槛必成
  const 失败后 = await 跑一次({ 经验: 90 }) // 差 52 必败
  assert.ok(失败后 < 成功后, `失败(${失败后})应比成功(${成功后})更伤`)
})

// ── #7 断粮有后果 ─────────────────────────────────────────────────

test('#7 断粮之夜按欠缺份数扣体力', async () => {
  const s = 局面()
  s.pack = []
  s.carry.当前 = 0
  s.clock = { day: 4, slot: '晚' }
  s.pc.体力 = 50
  const r = await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: 假配置, streamImpl: 极简回复,
  })
  // 步进 -6，露天睡 +12，欠 2 份主粮 -16 → 40
  assert.equal(s.pc.体力, 40, `断粮惩罚没生效：${s.pc.体力}`)
  assert.ok(r.ok)
})

// ── #8 入队 ───────────────────────────────────────────────────────

const 回复带 = (state尾段) => async () => ({
  text: `[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n${state尾段}`,
})

test('#8 模型报了入队，引擎真的让人入队，且同回合可给新人好感', async () => {
  const s = 局面()
  const j = createJournal()
  const r = await runTurn({
    state: s, journal: j,
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: 假配置,
    streamImpl: 回复带('{"入队":[{"npc":"猛蛇过江","因":"雷公庙相遇"}],"好感":[{"npc":"猛蛇过江","delta":3}]}'),
  })
  assert.ok(r.ok)
  const 蛇 = s.party.find((p) => p.npcId === 'mengshe')
  assert.ok(蛇 && 蛇.在队, '猛蛇过江没有入队')
  assert.ok(蛇.好感 > 0, '新人应有初始好感')
  assert.ok(j.关键事件.some((e) => e.文本.includes('加入')), '入队应记入档案')
})

test('#8 队伍满 4 人后入队被驳回；离队者不能回归', () => {
  const s = 局面()
  s.party.push({ npcId: 'wangdapeng', 好感: 30, 状态: '正常', 在队: true })
  s.party.push({ npcId: 'zhoutao', 好感: 30, 状态: '正常', 在队: false })
  const v = validateProposal(s, {
    入队: [{ npc: '踏雪', 因: 'x' }, { npc: '猛蛇过江', 因: 'y' }, { npc: '周涛', 因: 'z' }],
  })
  // 在队 3 人 → 踏雪入队后满 4 → 猛蛇过江被拒；周涛已离队不可回归
  assert.equal(v.入队.length, 1)
  assert.equal(v.入队[0].npcId, 'taxue')
  assert.ok(v.warnings.some((w) => w.includes('满')), '缺队伍已满警告')
  assert.ok(v.warnings.some((w) => w.includes('不可逆')), '缺离队不可逆警告')
})

// ── #4 伤病 ───────────────────────────────────────────────────────

test('#4 模型报的新伤入册，拖两天走向失败遇险', async () => {
  const s = 局面()
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: 假配置,
    streamImpl: 回复带('{"伤病":{"新增":[{"名称":"左腿骨裂","严重度":"重"}]}}'),
  })
  assert.equal(s.pc.伤病.length, 1)
  assert.equal(s.pc.伤病[0].严重度, '重')
  s.clock.day += 2
  const e = checkEnding(s)
  assert.ok(e && e.type === '失败遇险', '重伤拖两天应致失败遇险')
})

test('#4 处理伤病需要医药包，处理会消耗耗材', () => {
  const s = 局面()
  s.pc.伤病 = [{ 名称: '左膝扭伤', 严重度: '轻', 起始day: 3, 已处理: false }]
  const 没药 = validateProposal(s, { 伤病: { 已处理: ['左膝扭伤'] } })
  assert.equal(没药.伤病已处理.length, 0)
  assert.ok(没药.warnings.some((w) => w.includes('医药包')))

  s.pack.push({ gearId: 'first_aid', 档: '基础', 数量: 1, 单重: 0.6, 余量: 100 })
  const 有药 = validateProposal(s, { 伤病: { 已处理: ['左膝扭伤'] } })
  assert.deepEqual(有药.伤病已处理, ['左膝扭伤'])
})

test('#4 护膝把膝部重伤降为轻伤', () => {
  const s = 局面()
  s.pack.push({ gearId: 'knee_brace', 档: '通用', 数量: 1, 单重: 0.15, 余量: 100 })
  const v = validateProposal(s, { 伤病: { 新增: [{ 名称: '右膝挫伤', 严重度: '重' }] } })
  assert.equal(v.伤病新增[0].严重度, '轻')
  assert.ok(v.warnings.some((w) => w.includes('护膝')))
})

test('#4 一回合最多新增一处伤病', () => {
  const v = validateProposal(局面(), {
    伤病: { 新增: [{ 名称: '甲', 严重度: '轻' }, { 名称: '乙', 严重度: '轻' }] },
  })
  assert.equal(v.伤病新增.length, 1)
})

// ── #5/#6 原生操作可用性 ──────────────────────────────────────────

test('#5 求救按钮只在有求救设备时可用', () => {
  const s = 局面()
  assert.equal(actionsViewModel(s).求救.可用, false)
  s.pack.push({ gearId: 'sat_phone', 档: '租用', 数量: 1, 单重: 0.4, 余量: 100 })
  assert.equal(actionsViewModel(s).求救.可用, true)
})

test('#6 热食可用性看炉、餐、气三样', () => {
  const s = 局面()
  assert.equal(actionsViewModel(s).热食.可用, false)
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 3, 单重: 0.2, 余量: 100 })
  assert.equal(actionsViewModel(s).热食.可用, true)
  s.pack.find((p) => p.gearId === 'stove').余量 = 4
  assert.equal(actionsViewModel(s).热食.可用, false, '气罐见底且无备用罐时应不可用')
})

// ── #11 NPC 初始状态入 state ──────────────────────────────────────

test('#11 队友初始状态照抄人物表，不再一律「正常」', () => {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '甲', 职业: '乙', 年龄: 30, 性别: '男', 性格: 'renside', 外貌: '丙', 技能: [], 户外经验: 10 },
    队友: [{ npcId: 'wangdapeng', 好感: 30, 状态: '膝盖旧伤复发' }],
    背包: [], 金钱: 100,
  })
  assert.equal(s.party[0].状态, '膝盖旧伤复发')
})

// ── #2 上下文与 prompt ────────────────────────────────────────────

test('#2 最近回合以字符串拼入 user message，不出现 [object Object]', () => {
  const s = 局面()
  const m = buildUserMessage({
    state: s, journal: createJournal(), 既成事实: {},
    最近回合: ['【第一回合】\n剧情甲\n（玩家选了「走」，判定成功）'],
  })
  assert.ok(m.includes('剧情甲'))
  assert.ok(!m.includes('[object Object]'))
})

test('伤病与入队规则写进了 system prompt；主角伤病出现在 user message', () => {
  const sys = buildSystemPrompt()
  assert.ok(sys.includes('"入队"'), 'system prompt 缺入队字段示例')
  assert.ok(sys.includes('"伤病"'), 'system prompt 缺伤病字段示例')
  const s = 局面()
  s.pc.伤病 = [{ 名称: '左膝扭伤', 严重度: '轻', 起始day: 3, 已处理: false }]
  const m = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('左膝扭伤'), 'user message 缺主角伤病')
})

// ── 无害口误静默忽略，不再每回合喊「提议被拦下」 ──────────────────

test('模型把主角填进说话人/好感是常见口误，静默忽略、零警告', () => {
  const s = 局面()
  const v = validateProposal(s, {
    说话人: '周野',
    好感: [{ npc: '周野', delta: 3 }, { npc: '林晓雅', delta: 2 }],
  })
  assert.equal(v.说话人, null)
  assert.equal(v.好感变更.length, 1, '真队友的好感仍应生效')
  assert.equal(v.warnings.length, 0, `不该有警告：${v.warnings}`)
})

test('去向建议填当前所在地 = 原地不动，静默忽略、零警告', () => {
  const s = 局面()
  const v = validateProposal(s, { 去向建议: '水窝子营地' })
  assert.equal(v.去向, null)
  assert.equal(v.warnings.length, 0, `不该有警告：${v.warnings}`)
})

// ── parser 段落别名 ───────────────────────────────────────────────

test('段落别名：[万象] 与 [选项] 也认', () => {
  const r = parseTurn('[剧情]\n甲\n\n[万象]\n1. 乙\n\n[选项]\nA. 丙\n\n<<<STATE>>>\n{}')
  assert.deepEqual(r.万象, ['乙'])
  assert.equal(r.选项.length, 1)
})

test('以段落名开头的正文行不会被误吃成标记', () => {
  const r = parseTurn('[剧情]\n选项摆在眼前，你却在想别的。\n\n[下回选项]\nA. 丙\n\n<<<STATE>>>\n{}')
  assert.ok(r.剧情.includes('选项摆在眼前'), `正文被吃掉了：${r.剧情}`)
  assert.equal(r.选项.length, 1)
})
