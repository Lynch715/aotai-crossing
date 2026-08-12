import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, buildUserMessage, buildRepairMessage } from '../src/llm/prompt.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal, recordNode, recordEvent, addForeshadow, updateNpcStatus } from '../src/engine/journal.js'
import { STATE_MARKER } from '../src/llm/parser.js'

function 状态() {
  const s = createInitialState({
    种子: 42, 季节: '秋季',
    pc: { 名字: '周野', 职业: '户外器材工程师', 年龄: 28, 性别: '男',
          性格: 'renside', 外貌: '偏瘦，晒得黑', 技能: ['装备维修'], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'linxiaoya', 好感: 62 }],
    背包: [{ gearId: 'staple_food', 档: '主流', 数量: 4 }],
    金钱: 4320,
  })
  s.clock = { day: 4, slot: '晚' }
  s.place = { nodeId: 'maijieling', 海拔: 3500 }
  s.weather = { 状态: '大风', 等级: 6 }
  s.pc.体力 = 41
  return s
}

function 档案() {
  const j = createJournal()
  recordNode(j, 'tangkou')
  recordNode(j, 'maijieling')
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝盖旧伤复发，你分了他布洛芬')
  addForeshadow(j, '对讲机里断续的呼叫，未确认来源')
  updateNpcStatus(j, 'linxiaoya', '轻度高反')
  return j
}

test('system prompt 含总则、静态数据、文风、协议四部分', () => {
  const p = buildSystemPrompt()
  assert.ok(p.includes('不得自创'), '缺总则')
  assert.ok(p.includes('麦秸岭') && p.includes('拔仙台'), '缺路线数据')
  assert.ok(p.includes('陈岩') && p.includes('猛蛇过江'), '缺人物数据')
  assert.ok(p.includes('冰爪') || p.includes('冻干'), '缺装备数据')
  assert.ok(p.includes('秋季') && p.includes('失温'), '缺四季数据')
  assert.ok(p.includes(STATE_MARKER), '缺协议说明')
})

test('system prompt 逐条落实文档的文风禁令', () => {
  const p = buildSystemPrompt()
  for (const 禁 of ['300', '口语', '文绉绉', '心理描写', '比喻', '上帝视角', '数值', '未卜先知']) {
    assert.ok(p.includes(禁), `文风约束缺少「${禁}」`)
  }
})

test('system prompt 含一个完整输出范例', () => {
  const p = buildSystemPrompt()
  assert.ok(p.includes('[剧情标题]'))
  assert.ok(p.includes('[鳌太万象]'))
  assert.ok(p.includes('[下回选项]'))
  assert.ok(p.includes('"选项"'), '范例里应展示 STATE 的选项申报格式')
})

test('system prompt 是稳定的（可命中 prompt cache）', () => {
  assert.equal(buildSystemPrompt(), buildSystemPrompt())
})

test('user message 含四个小节', () => {
  const m = buildUserMessage({
    state: 状态(), journal: 档案(),
    既成事实: { 选择: 'C 你打头阵，用绳子做保护', 判定: '失败', 原因: '户外经验不足',
                已结算: '中→晚｜体力 50→41｜干粮 −2｜位置不变' },
    最近回合: ['上一回合的正文'],
  })
  assert.ok(m.includes('【旅程档案】'))
  assert.ok(m.includes('【最近'))
  assert.ok(m.includes('【本回合既成事实】'))
  assert.ok(m.includes('【当前状态快照】'))
})

test('既成事实把判定结果说清楚', () => {
  const m = buildUserMessage({
    state: 状态(), journal: 档案(),
    既成事实: { 选择: 'C 你打头阵', 判定: '失败', 原因: '户外经验不足', 已结算: '体力 50→41' },
    最近回合: [],
  })
  assert.ok(m.includes('失败'))
  assert.ok(m.includes('户外经验不足'))
  assert.ok(m.includes('50→41'))
})

test('状态快照给出位置海拔天气负重现金，但不给好感数字', () => {
  const m = buildUserMessage({ state: 状态(), journal: 档案(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('麦秸岭'))
  assert.ok(m.includes('3500'))
  assert.ok(m.includes('大风'))
  assert.ok(m.includes('4320'))
  assert.ok(!/好感\s*[:：]?\s*\d/.test(m), '快照泄漏了数字好感')
  assert.ok(!m.includes('62'), '快照泄漏了林晓雅的好感值')
})

test('在队成员只报名字与状态词', () => {
  const m = buildUserMessage({ state: 状态(), journal: 档案(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('陈岩'))
  assert.ok(m.includes('林晓雅'))
})

test('最近回合原文按序拼入，超过 3 条只留最近 3 条', () => {
  const m = buildUserMessage({
    state: 状态(), journal: 档案(), 既成事实: {},
    最近回合: ['第一回合', '第二回合', '第三回合', '第四回合'],
  })
  assert.ok(!m.includes('第一回合'))
  assert.ok(m.includes('第二回合') && m.includes('第三回合') && m.includes('第四回合'))
})

test('最近回合为空时不产生空小节标题以外的噪音', () => {
  const m = buildUserMessage({ state: 状态(), journal: 档案(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('（无）') || !m.includes('【最近 0'))
})

test('补救消息只要 STATE，且带上已生成的正文', () => {
  const m = buildRepairMessage('已经写好的那段正文')
  assert.ok(m.includes('已经写好的那段正文'))
  assert.ok(m.includes(STATE_MARKER))
  assert.ok(m.includes('只') || m.includes('仅'), '应明确要求只输出尾段')
  assert.ok(!m.includes('[鳌太万象]'), '补救时不该再要求写正文段落')
})

test('user message 必须带上主角是谁——否则模型会照范例叫陈岩', () => {
  const s = 状态()
  s.pc.名字 = '沈遇'
  s.pc.职业 = '越野跑爱好者'
  s.pc.外貌 = '偏瘦，晒得黑'
  s.pc.技能 = ['装备维修', '生火']
  const m = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('沈遇'), '主角名字没进 prompt')
  assert.ok(m.includes('越野跑爱好者'), '职业没进 prompt')
  assert.ok(m.includes('偏瘦，晒得黑'), '外貌没进 prompt')
  assert.ok(m.includes('装备维修'), '技能没进 prompt')
  assert.ok(m.includes('【你扮演的人】'), '缺主角块标题')
})

test('性格翻成人话，不是把 id 丢给模型', () => {
  const s = 状态()
  s.pc.性格 = 'renside'
  const m = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('话不多'), `性格没翻译：${m.match(/性格：.*/)}`)
  assert.ok(!m.includes('renside'), '把内部 id 丢给模型了')
})

test('明确要求正文用主角的名字', () => {
  const s = 状态()
  s.pc.名字 = '沈遇'
  const m = buildUserMessage({ state: s, journal: createJournal(), 既成事实: {}, 最近回合: [] })
  assert.ok(m.includes('称呼主角'), '没告诉模型该怎么称呼主角')
})
