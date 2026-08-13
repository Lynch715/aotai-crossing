// 2026-08-13 审计修复的回归测试。每个 test 对应报告里的一个问题编号。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTurn, turnSeed } from '../src/turn.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'
import { checkEnding } from '../src/engine/ending.js'
import { validateProposal, resolveGear, clampRequire } from '../src/llm/validate.js'
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
  // 营地活动 -2，缺睡具只恢复 +4，失温 -8，欠 2 份主粮 -16 → 28
  assert.equal(s.pc.体力, 28, `断粮、露宿与失温惩罚没生效：${s.pc.体力}`)
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

// ── 夹取是护栏日常，不是要给玩家看的警告 ──────────────────────────

test('门槛/代价越界只进 微调，不进玩家可见的 warnings', () => {
  const v = validateProposal(局面(), {
    选项: [{ id: 'A', 类型: '徒步', require: { 经验: 15 }, cost: { 体力: 99 } }],
  })
  assert.equal(v.选项[0].require.经验, 20, '仍要夹取')
  assert.equal(v.warnings.length, 0, `夹取不该出现在 warnings：${v.warnings}`)
  assert.ok(v.微调.length >= 2, '夹取记录应进 微调')
})

// ── 开场回合有专门指引，不再两行白描甩四个选项 ────────────────────

test('第一回合的 user message 带开场指引，之后的回合不带', () => {
  const s = 局面()
  const 空档案 = createJournal()
  const m1 = buildUserMessage({ state: s, journal: 空档案, 既成事实: { 选择: 'start 出发上路！', 判定: '成功', 已结算: 'x' }, 最近回合: [] })
  assert.ok(m1.includes('【开场回合】'), '开场回合缺指引')

  const 有事档案 = createJournal()
  有事档案.关键事件.push({ day: 1, slot: '早', 文本: 'x' })
  const m2 = buildUserMessage({ state: s, journal: 有事档案, 既成事实: {}, 最近回合: [] })
  assert.ok(!m2.includes('【开场回合】'), '非开场回合不该带指引')
})

// ── 装备中文名解析：模型只见过中文名，不能因此每回合弹警告 ────────

test('resolveGear 认 id、认全名、认唯一命中的简称，拒绝歧义', () => {
  assert.equal(resolveGear('first_aid'), 'first_aid')
  assert.equal(resolveGear('综合医药包'), 'first_aid')
  assert.equal(resolveGear('医药包'), 'first_aid', '唯一命中的简称应该认')
  assert.equal(resolveGear('睡袋'), null, '「睡袋」命中三件装备，歧义必须驳回')
  assert.equal(resolveGear('查无此物'), null)
})

test('选项 require 里的中文装备名被解析成 id，零警告', () => {
  const { require, warnings } = clampRequire('社交', { 物品: ['综合医药包', '动力绳 20m'] })
  assert.deepEqual(require.物品, ['first_aid', 'rope'])
  assert.equal(warnings.length, 0, `不该有警告：${warnings}`)
})

test('system prompt 的装备清单带 id，模型才写得出 id', () => {
  const sys = buildSystemPrompt()
  assert.ok(sys.includes('[first_aid]'), '装备清单缺 id')
  assert.ok(sys.includes('[rope]'))
})

// ── 剧情连贯性：上下文不断档，选项扣住正文 ────────────────────────

test('最近回合随存档持久化，刷新后不断档；旧档缺该字段时安全回退', async () => {
  const { packSave, unpackSave } = await import('../src/ui/save.js')
  const s = 局面()
  const j = createJournal()
  const 回来 = unpackSave(packSave(s, j, ['第一回合的原文', '第二回合的原文']))
  assert.deepEqual(回来.最近回合, ['第一回合的原文', '第二回合的原文'])

  // 旧版存档没有 最近回合 字段——不能因此炸掉
  const 旧包 = JSON.stringify({ 版本: 1, 摘要: 'x', state: s, journal: j })
  assert.deepEqual(unpackSave(旧包).最近回合, [])
})

test('有上文时 user message 带续写指令，没上文时不带', () => {
  const s = 局面()
  const 有 = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: ['上回合原文'] })
  assert.ok(有.includes('必须从上面最后一回合的结尾处继续写'), '缺续写指令')
  const 无 = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: [] })
  assert.ok(!无.includes('必须从上面最后一回合的结尾处继续写'), '没上文不该有续写指令')
})

test('叙事人称统一为第二人称：叙述用「你」，禁止用名字或「我」叙事', () => {
  const sys = buildSystemPrompt()
  assert.ok(sys.includes('叙事人称铁律'))
  assert.ok(sys.includes('一律用第二人称「你」'))
  const s = 局面()
  const m = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('不要用「周野」叙事'), '主角块应明确禁止名字叙事')
  assert.ok(m.includes('只有对话里其他人可以喊「周野」'), '应放行对话内称名')
})

test('system prompt 有连贯性与选项扣题的硬规则', () => {
  const sys = buildSystemPrompt()
  assert.ok(sys.includes('连贯性'), '缺连贯性一节')
  assert.ok(sys.includes('不得另起新场景'))
  assert.ok(sys.includes('至少两个要点名本回合正文中出现过的'), '缺选项扣题规则')
})

// ── 偏离补齐：季节事件 / 筹钱 / 完成度 / 经验回馈 ─────────────────

test('季节事件按 节点+季节 触发，一局一次，登场人物已在队则跳过', async () => {
  const { pickEvent, EVENTS } = await import('../src/data/events.js')
  const s = 局面()
  s.place = { nodeId: 'aoshan', 海拔: 3475 }
  const e = pickEvent(s)
  assert.equal(e.id, 'meet_taxue', '鳌山至药王洞段应触发踏雪登场')

  s.flags.触发过的事件id = ['meet_taxue']
  assert.equal(pickEvent(s).id, 'aoshan_cloud', '人物事件触发后仍可演出该路段天气事件')

  s.flags.触发过的事件id = []
  s.party.push({ npcId: 'taxue', 好感: 30, 状态: '幸存', 在队: true })
  assert.equal(pickEvent(s).id, 'aoshan_cloud', '踏雪已在队就不再登场，但路段事件仍保留')

  // 季节匹配：冬季的东跑马梁是暴风雪，秋季不是
  const 冬 = 局面()
  冬.meta.季节 = '冬季'
  冬.place = { nodeId: 'dongpaomaliang', 海拔: 3450 }
  assert.equal(pickEvent(冬).id, 'dong_blizzard_dongpaomaliang')
  assert.ok(EVENTS.length >= 15, '事件表覆盖四季与人物登场')
})

test('事件指令注入 user message 并记入 flags，回合失败会回滚', async () => {
  const s = 局面()
  s.place = { nodeId: 'yingdi2800', 海拔: 2800 }
  const 收到 = []
  const r = await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '扎营', 类型: '徒步', require: {}, cost: {} },
    config: 假配置,
    streamImpl: async ({ messages }) => { 收到.push(messages[1].content); return { text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' } },
  })
  assert.ok(r.ok)
  assert.ok(收到[0].includes('本回合大事'), '事件块未注入')
  assert.ok(收到[0].includes('羚牛'), '2800营地应触发羚牛事件')
  assert.deepEqual(s.flags.触发过的事件id, ['lingniu_2800'])

  // 失败回滚：事件标记也要一并撤销
  const s2 = 局面()
  s2.place = { nodeId: 'yingdi2800', 海拔: 2800 }
  const err = new Error('boom')
  await runTurn({
    state: s2, journal: createJournal(),
    选中项: { id: 'A', 文本: '扎营', 类型: '徒步', require: {}, cost: {} },
    config: 假配置, streamImpl: async () => { throw err },
  })
  assert.deepEqual(s2.flags.触发过的事件id, [], '回滚后不该留下事件标记')
})

test('金钱变化：夹到 ±500、落账不穿底，非数字驳回', async () => {
  const v = validateProposal(局面(), { 金钱变化: { delta: 2000, 因: '帮工' } })
  assert.equal(v.金钱变化.delta, 500)
  assert.ok(v.微调.some((w) => w.includes('金钱')))
  const 坏 = validateProposal(局面(), { 金钱变化: { delta: '很多' } })
  assert.equal(坏.金钱变化, null)

  const s = 局面()
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '帮忙', 类型: '社交', require: {}, cost: {} },
    config: 假配置,
    streamImpl: 回复带('{"金钱变化":{"delta":300,"因":"帮别队修帐篷"}}'),
  })
  assert.equal(s.money, 4320 + 300, '筹到的钱应落账')
})

test('勉强档赌赢经验 +2 封顶 100，达标与失败不涨', async () => {
  const 跑一把 = async (require, rng) => {
    const s = 局面()
    await runTurn({
      state: s, journal: createJournal(),
      选中项: { id: 'A', 文本: '试', 类型: '徒步', require, cost: {} },
      config: 假配置, rng, streamImpl: 极简回复,
    })
    return s.pc.户外经验
  }
  assert.equal(await 跑一把({ 经验: 43 }, () => 0), 40, '差5点赌赢应 38→40')
  assert.equal(await 跑一把({}, () => 0), 38, '达标不涨')
  assert.equal(await 跑一把({ 经验: 43 }, () => 0.99), 38, '赌输不涨')
})

test('主线完成度：18 个决策节点对应六天，苗圃等价起点，下撤点隐藏', async () => {
  const { mainProgress } = await import('../src/data/route.js')
  assert.deepEqual(mainProgress('tangkou'), { 序号: 1, 总数: 18 })
  assert.deepEqual(mainProgress('miaopu'), { 序号: 1, 总数: 18 })
  assert.deepEqual(mainProgress('baxiantai'), { 序号: 14, 总数: 18 })
  assert.equal(mainProgress('hetaoping'), null)
  const { gameViewModel } = await import('../src/ui/screen-game.js')
  const s = 局面()
  assert.equal(gameViewModel({ state: s, 回合: null, 说话人: null }).顶栏.行程, '行程 6/18')
})

// ── 七阶段路线重组 ────────────────────────────────────────────────

test('决策节点压缩接进主线，子地点留在叙事内，苗圃有直插盆景园的近路', async () => {
  const { isAdjacent } = await import('../src/data/route.js')
  assert.ok(isAdjacent('shuiwozi', 'feijiliang1'))
  assert.ok(isAdjacent('feijiliang1', 'feijiliang3'))
  assert.ok(isAdjacent('feijiliang3', 'yingdi2800'))
  assert.ok(isAdjacent('jiuchongshihai2', 'dongyuan'))
  assert.ok(isAdjacent('miaopu', 'yingdi2900'), '苗圃近路：跳过火烧坡')
  assert.ok(isAdjacent('miaopu', 'huoshaopo'), '苗圃也可走经典线')
  assert.ok(!isAdjacent('shuiwozi', 'feijiliang3'), '不能跳过飞机梁入口')
})

test('旧档迁移 v1→v3：老节点 id 映射到当前决策节点，并补风险记账', async () => {
  const { migrateSave } = await import('../src/ui/save.js')
  const 老包 = {
    版本: 1, 摘要: 'x',
    state: { place: { nodeId: 'feijiliang', 海拔: 3450 }, pc: { 体力: 66 }, flags: {} },
    journal: { 已过节点: ['tangkou', 'jiuchongshihai'] },
  }
  const r = migrateSave(老包)
  assert.ok(r.可用 && r.迁移过)
  assert.equal(r.包.state.place.nodeId, 'feijiliang1')
  assert.deepEqual(r.包.journal.已过节点, ['tangkou', 'jiuchongshihai2'])
  assert.equal(r.包.state.flags.最低体力, 66)
  assert.equal(r.包.state.flags.迷路次数, 0)
  assert.equal(r.包.state.flags.恶劣天气暴露次数, 0)
})

test('阶段事件：西源必提示石海，拔仙台演出登顶≠通关', async () => {
  const { pickEvent } = await import('../src/data/events.js')
  const s = 局面()
  s.place = { nodeId: 'xiyuan', 海拔: 3100 }
  assert.equal(pickEvent(s).id, 'xiyuan_warning')
  s.place = { nodeId: 'baxiantai', 海拔: 3767 }
  assert.ok(pickEvent(s).指令.includes('登顶不等于安全'))
  s.place = { nodeId: 'jiuchongshihai2', 海拔: 3400 }
  assert.ok(pickEvent(s).指令.includes('两条路线'), '石海中段应有路线抉择')
})

test('下撤按钮只在分叉点出现；接待站才有补给', () => {
  const s = 局面() // 在水窝子
  const a = actionsViewModel(s)
  assert.deepEqual(a.下撤列表.map((x) => x.nodeId), ['hetaoping'], '水窝子可南撤核桃坪')
  assert.equal(a.补给.在接待站, false)

  s.place = { nodeId: 'yingdi2800', 海拔: 2800 }
  const b = actionsViewModel(s)
  assert.deepEqual(b.下撤列表.map((x) => x.nodeId).sort(), ['hetaoping', 'songpingsi'], '2800 双向下撤')

  s.place = { nodeId: 'dayehai', 海拔: 3590 }
  const c = actionsViewModel(s)
  assert.equal(c.补给.在接待站, true)
  assert.equal(c.补给.可用, true, '现金 4320 足够 ¥200 补给')
  s.money = 100
  assert.equal(actionsViewModel(s).补给.可用, false, '现金不足应禁用')

  s.place = { nodeId: 'maijieling', 海拔: 3500 }
  assert.equal(actionsViewModel(s).下撤列表.length, 0, '非分叉点无下撤按钮')
})

test('结算页称号与硬核数字', async () => {
  const { endingViewModel } = await import('../src/ui/screen-ending.js')
  const s = 局面()
  s.phase = '结局'
  s.clock.day = 6
  s.flags.最低体力 = 11
  s.pc.伤病 = [{ 名称: '左膝扭伤', 严重度: '轻', 起始day: 3, 已处理: true }]
  s.ending = { type: '成功穿越', 原因: '走到了下板寺', 罚款: 5000 }
  const vm = endingViewModel(s, createJournal())
  assert.equal(vm.称号, '秦岭老驴')
  assert.equal(vm.回顾.最低体力, 11)
  assert.equal(vm.回顾.受伤次数, 1)
  assert.equal(vm.回顾.剩余主粮, 14)

  s.ending = { type: '被救援', 原因: 'x' }
  assert.equal(endingViewModel(s, createJournal()).称号, '捡回一条命')
})

// ── 节奏控制：一回合最多 2 个时段，代价明码标价 ───────────────────

test('时段代价夹到 1——一回合最多早→晚，绝不跨天', async () => {
  const s = 局面() // 第4天 早
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '冲刺', 类型: '徒步', require: {}, cost: { 时段: 3 } },
    config: 假配置, streamImpl: 极简回复,
  })
  assert.equal(s.clock.day, 4, '不许跨天')
  assert.equal(s.clock.slot, '晚', '早 + 基础1 + 夹取后的1 = 晚')
})

test('选项代价明码标价', async () => {
  const { costLabel } = await import('../src/ui/screen-game.js')
  assert.equal(costLabel({ 体力: 14, 时段: 1 }), '耗体力约14、多耗一个时段')
  assert.equal(costLabel({ 体力: 6 }), '耗体力约6')
  assert.equal(costLabel({}), '')
  const { optionDisplay } = await import('../src/ui/screen-game.js')
  const o = optionDisplay({ id: 'A', 文本: 'x', 类型: '徒步', require: {}, cost: { 体力: 12, 时段: 1 } }, 局面())
  assert.equal(o.代价文案, '耗体力约12、多耗一个时段')
})

test('system prompt 有节奏铁律', () => {
  const sys = buildSystemPrompt()
  assert.ok(sys.includes('节奏铁律'))
  assert.ok(sys.includes('私自过夜'))
  assert.ok(sys.includes('一笔带过两个路段') || sys.includes('相邻的下一个地点'))
})

// ── parser 段落别名 ───────────────────────────────────────────────

test('段落别名：[万象] 与 [选项] 也认', () => {
  const r = parseTurn('[剧情]\n甲\n\n[万象]\n1. 乙\n\n[选项]\nA. 丙\n\n<<<STATE>>>\n{}')
  assert.deepEqual(r.万象, ['乙'])
  assert.equal(r.选项.length, 1)
})

test('漏写 [剧情] 标记时，从散落文本回收正文，不再一片空白', () => {
  const r = parseTurn('陈岩把杖插进碎石里，试了试才敢下脚。\n\n[鳌太万象]\n1. 乙\n\n[下回选项]\nA. 丙\n\n<<<STATE>>>\n{}')
  assert.ok(r.剧情.includes('陈岩'), `正文被丢弃了：「${r.剧情}」`)
  assert.equal(r.选项.length, 1)
  assert.deepEqual(r.万象, ['乙'])
})

test('模型一个字正文都没写时，整回合重写一次', async () => {
  const s = 局面()
  const 无正文 = '[鳌太万象]\n1. 乙\n\n[下回选项]\nA. 丙\n\n<<<STATE>>>\n{}'
  const 有正文 = '[剧情]\n重写后的正文\n\n[下回选项]\nA. 丙\n\n<<<STATE>>>\n{}'
  let 调用 = 0
  const r = await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: 假配置,
    streamImpl: async () => ({ text: [无正文, 有正文][Math.min(调用++, 1)] }),
  })
  assert.equal(调用, 2, '应重写一次')
  assert.ok(r.剧情.includes('重写后的正文'))
})

test('模型两次都没写正文 → 引擎保底段落，正文区绝不空白', async () => {
  const s = 局面()
  const 无正文 = '[鳌太万象]\n1. 乙\n\n[下回选项]\nA. 丙\n\n<<<STATE>>>\n{}'
  let 调用 = 0
  const r = await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '继续赶路', 类型: '徒步', require: {}, cost: {} },
    config: 假配置,
    streamImpl: async () => { 调用++; return { text: 无正文 } },
  })
  assert.equal(调用, 2)
  assert.ok(r.ok)
  assert.ok(r.剧情.trim().length > 20, `正文区不能空白：「${r.剧情}」`)
  assert.ok(r.剧情.includes('继续赶路'), '保底段落应提到玩家的选择')
  assert.ok(r.warnings.some((w) => w.includes('保底')), '应有保底警告供排查')
})

test('以段落名开头的正文行不会被误吃成标记', () => {
  const r = parseTurn('[剧情]\n选项摆在眼前，你却在想别的。\n\n[下回选项]\nA. 丙\n\n<<<STATE>>>\n{}')
  assert.ok(r.剧情.includes('选项摆在眼前'), `正文被吃掉了：${r.剧情}`)
  assert.equal(r.选项.length, 1)
})
