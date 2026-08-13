import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTurn, FALLBACK_OPTIONS, MAX_REPAIR, ensureProgressOption } from '../src/turn.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'
import { STATE_MARKER } from '../src/llm/parser.js'
import { gapFor, UNREACHABLE } from '../src/engine/threshold.js'

function 局面() {
  const s = createInitialState({
    种子: 42, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'linxiaoya', 好感: 62 }],
    背包: [{ gearId: 'staple_food', 档: '主流', 数量: 5 }],
    金钱: 4320,
  })
  s.clock = { day: 4, slot: '中' }
  s.place = { nodeId: 'maijieling', 海拔: 3500 }
  s.pc.体力 = 50
  s.flags.高海拔过夜数 = 2
  return s
}

const 正文 = `[剧情标题]
刃脊上的三十米

[剧情]
陈岩用杖尖敲了敲碎石，声音发闷。

[鳌太万象]
1. 甲
2. 乙
3. 丙
4. 丁

[下回选项]
A. 让陈岩先过
B. 退回水窝子
C. 强行推进
D. 原地扎营`

const 好尾段 = `${STATE_MARKER}
{"好感":[{"npc":"林晓雅","delta":3}],
 "记忆":["D4晚 麦秸岭 判定失败"],
 "伏笔":{"新增":["雾里的人影"],"已收":[]},
 "去向建议":"水窝子营地",
 "选项":[{"id":"A","类型":"社交","require":{"好感":{"林晓雅":40}},"cost":{"体力":8}}]}`

const 好回复 = `${正文}\n\n${好尾段}`

function 假客户端(...响应) {
  let i = 0
  const 调用 = []
  const fn = async ({ messages }) => {
    调用.push(messages)
    const r = 响应[Math.min(i, 响应.length - 1)]
    i++
    if (r instanceof Error) throw r
    return { text: r }
  }
  fn.调用 = 调用
  return fn
}

function 跑(state, journal, over = {}) {
  return runTurn({
    state, journal,
    选中项: { id: 'C', 类型: '高危', require: { 经验: 60 }, cost: { 体力: 20 } },
    最近回合: [],
    config: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' },
    streamImpl: 假客户端(好回复),
    ...over,
  })
}

test('顺利一回合：正文、选项、结算全部落地', async () => {
  const s = 局面()
  const j = createJournal()
  const r = await 跑(s, j)

  assert.equal(r.ok, true)
  assert.equal(r.降级, false)
  assert.equal(r.标题, '刃脊上的三十米')
  assert.equal(r.选项.length, 4)
  assert.equal(s.party.find((p) => p.npcId === 'linxiaoya').好感, 65)
  assert.equal(j.关键事件.length, 1)
  assert.deepEqual(j.未收伏笔, ['雾里的人影'])
})

test('判定先行：选项 C 差距 22，必败，且体力先扣掉', async () => {
  const s = 局面()
  const r = await 跑(s, createJournal())
  assert.equal(r.判定.outcome, 'fail')
  assert.equal(r.判定.gap, 22)
  assert.ok(s.pc.体力 < 50, '硬资源应在请求前就扣掉')
})

test('既成事实在请求发出前就写进了 user message', async () => {
  const 客户端 = 假客户端(好回复)
  await 跑(局面(), createJournal(), { streamImpl: 客户端 })
  const user = 客户端.调用[0][1].content
  assert.ok(user.includes('失败'))
  assert.ok(user.includes('既成事实'))
})

test('时段推进：中 → 晚', async () => {
  const s = 局面()
  await 跑(s, createJournal())
  assert.deepEqual(s.clock, { day: 4, slot: '晚' })
})

test('跨天时扣每日主粮', async () => {
  const s = 局面()
  s.clock = { day: 4, slot: '晚' }
  await 跑(s, createJournal())
  assert.equal(s.clock.day, 5)
  assert.equal(s.pack.find((p) => p.gearId === 'staple_food').数量, 3)
})

test('麦秸岭晚间前往水窝子：先抵达营地再过夜，不在出发地露宿', async () => {
  const s = 局面()
  s.clock = { day: 1, slot: '晚' }
  s.pc.体力 = 50
  s.pack.push(
    { gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 },
    { gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 },
    { gearId: 'bag_liner', 档: '通用', 数量: 1, 单重: 0.3, 余量: 100 },
  )
  const 客户端 = 假客户端(好回复)
  const r = await 跑(s, createJournal(), {
    streamImpl: 客户端,
    选中项: { id: 'D', 文本: '沿路标稳妥前往水窝子营地', 类型: '徒步', require: {}, cost: {}, targetNodeId: 'shuiwozi' },
  })

  assert.equal(r.ok, true)
  assert.deepEqual(s.clock, { day: 2, slot: '早' })
  assert.equal(s.place.nodeId, 'shuiwozi')
  assert.equal(s.pc.体力, 65, '应按水窝子正规有水营地回复，而不是在麦秸岭露宿')
  assert.equal(s.flags.失温连败, 0)
  assert.ok(客户端.调用[0][1].content.includes('先抵达水窝子营地'))
  assert.ok(客户端.调用[0][1].content.includes('扎营、过夜'))
  assert.ok(客户端.调用[0][1].content.includes('水窝子是大营地'), '跨夜营地事件应在抵达回合演出')
})

test('合法去向被应用，海拔跟着更新（判定成功的徒步回合才移动）', async () => {
  const s = 局面()
  await 跑(s, createJournal(), {
    选中项: { id: 'B', 文本: '继续走', 类型: '徒步', require: {}, cost: {} },
  })
  assert.equal(s.place.nodeId, 'shuiwozi')
  assert.equal(s.place.海拔, 3100)
})

test('模型漏写去向时，玩家点引擎保底推进仍会移动', async () => {
  const s = 局面()
  const 无去向 = 好回复.replace('"去向建议":"水窝子营地"', '"去向建议":""')
  await 跑(s, createJournal(), {
    streamImpl: 假客户端(无去向),
    选中项: { id: 'D', 文本: '沿路标稳妥前往水窝子营地', 类型: '徒步', require: {}, cost: {}, targetNodeId: 'shuiwozi' },
  })
  assert.equal(s.place.nodeId, 'shuiwozi')
})

test('四个模型选项都不保证移动时，引擎替换出一个可执行的主线选项', () => {
  const s = 局面()
  const options = [
    { id: 'A', 文本: '聊聊', 类型: '社交', require: {}, cost: {} },
    { id: 'B', 文本: '观察云层', 类型: '徒步', require: {}, cost: {} },
    { id: 'C', 文本: '原地等待', 类型: '徒步', require: { 经验: 99 }, cost: {} },
    { id: 'D', 文本: '清点背包', 类型: '徒步', require: {}, cost: {} },
  ]
  const fixed = ensureProgressOption(options, s)
  const safe = fixed.find((o) => o.targetNodeId)
  assert.equal(safe.targetNodeId, 'shuiwozi')
  assert.equal(safe.类型, '徒步')
  assert.deepEqual(safe.require, {})
})

test('万仙阵迷路由引擎结算：扣体力、记次数、当回合不移动', async () => {
  const s = 局面()
  s.place = { nodeId: 'wanxianzhen', 海拔: 3560 }
  s.weather = { 状态: '浓雾大风', 等级: 7 }
  const 到拔仙台 = 好回复.replace('"去向建议":"水窝子营地"', '"去向建议":"拔仙台"')
  const r = await 跑(s, createJournal(), {
    rng: () => 0,
    streamImpl: 假客户端(到拔仙台),
    选中项: { id: 'A', 文本: '穿过石阵', 类型: '徒步', require: {}, cost: {}, targetNodeId: 'baxiantai' },
  })
  assert.equal(r.ok, true)
  assert.equal(s.place.nodeId, 'wanxianzhen')
  assert.equal(s.flags.迷路次数, 1)
  assert.equal(s.flags.恶劣天气暴露次数, 1)
  assert.ok(r.判定.outcome === 'success')
  assert.ok(s.pc.体力 <= 25, `迷路与恶劣天气没有形成实质代价：${s.pc.体力}`)
})

test('判定失败的回合不移动——横切没成怎么会已经到了对面', async () => {
  const s = 局面()
  // 默认选中项是必败的高危（差 22 点经验）
  const r = await 跑(s, createJournal())
  assert.equal(r.判定.outcome, 'fail')
  assert.equal(s.place.nodeId, 'maijieling', '判定失败却移动了')
})

test('社交回合不移动——喂口水不该把人挪到下一个路段', async () => {
  const s = 局面()
  await 跑(s, createJournal(), {
    选中项: { id: 'A', 文本: '给林晓雅递水', 类型: '社交', require: {}, cost: {} },
  })
  assert.equal(s.place.nodeId, 'maijieling', '社交回合却移动了')
})

test('不合法的去向被驳回，位置不动', async () => {
  const 坏去向 = 好回复.replace('"去向建议":"水窝子营地"', '"去向建议":"下板寺"')
  const s = 局面()
  const r = await 跑(s, createJournal(), { streamImpl: 假客户端(坏去向) })
  assert.equal(s.place.nodeId, 'maijieling')
  assert.ok(r.warnings.some((w) => w.includes('去向')))
})

test('尾段缺失：补救一次拿到 STATE，正文不重复', async () => {
  const 客户端 = 假客户端(正文, 好尾段)
  const s = 局面()
  const r = await 跑(s, createJournal(), { streamImpl: 客户端 })

  assert.equal(客户端.调用.length, 2)
  assert.equal(r.降级, false)
  assert.equal(r.标题, '刃脊上的三十米', '正文应沿用第一次的，不被补救结果覆盖')
  assert.equal(s.party.find((p) => p.npcId === 'linxiaoya').好感, 65)
})

test('补救请求里带上了已生成正文，且只要尾段', async () => {
  const 客户端 = 假客户端(正文, 好尾段)
  await 跑(局面(), createJournal(), { streamImpl: 客户端 })
  const 补救 = 客户端.调用[1][1].content
  assert.ok(补救.includes('刃脊上的三十米'))
  assert.ok(补救.includes(STATE_MARKER))
})

test(`补救 ${MAX_REPAIR} 次仍失败 → 降级：正文保留、不结算、给兜底选项`, async () => {
  const 客户端 = 假客户端(正文)
  const s = 局面()
  const j = createJournal()
  const 好感前 = s.party.find((p) => p.npcId === 'linxiaoya').好感
  const r = await 跑(s, j, { streamImpl: 客户端 })

  assert.equal(客户端.调用.length, 1 + MAX_REPAIR)
  assert.equal(r.ok, true, '降级不等于失败，游戏要能继续')
  assert.equal(r.降级, true)
  assert.ok(r.剧情.includes('碎石'), '正文必须保留')
  assert.deepEqual(r.选项.map((o) => o.id), FALLBACK_OPTIONS.map((o) => o.id))
  assert.equal(s.party.find((p) => p.npcId === 'linxiaoya').好感, 好感前, '降级时不结算好感')
  assert.equal(j.关键事件.length, 0, '降级时不写记忆')
})

test('降级时硬资源仍然是扣掉的（那是前端算的，与 LLM 无关）', async () => {
  const s = 局面()
  await 跑(s, createJournal(), { streamImpl: 假客户端(正文) })
  assert.ok(s.pc.体力 < 50)
  assert.equal(s.clock.slot, '晚')
})

test('网络整体失败 → 回滚到回合开始前，玩家的选择不被消费', async () => {
  const s = 局面()
  const j = createJournal()
  const 体力前 = s.pc.体力
  const 时段前 = s.clock.slot

  const err = new Error('boom')
  err.kind = 'network'
  const r = await 跑(s, j, { streamImpl: 假客户端(err) })

  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'network')
  assert.equal(s.pc.体力, 体力前, '失败必须整体回滚')
  assert.equal(s.clock.slot, 时段前)
  assert.equal(j.关键事件.length, 0)
})

test('回滚是就地改写传入的 state 对象（调用方持有同一引用）', async () => {
  const s = 局面()
  const 引用 = s
  const err = new Error('boom')
  await 跑(s, createJournal(), { streamImpl: 假客户端(err) })
  assert.equal(引用.pc.体力, 50)
  assert.equal(引用.clock.slot, '中')
})

test('校验越权提议：不在队的人的好感被驳回，其余照常应用', async () => {
  const 越权 = 好回复.replace(
    '"好感":[{"npc":"林晓雅","delta":3}]',
    '"好感":[{"npc":"林晓雅","delta":3},{"npc":"王大鹏","delta":9}]'
  )
  const s = 局面()
  const r = await 跑(s, createJournal(), { streamImpl: 假客户端(越权) })
  assert.equal(s.party.find((p) => p.npcId === 'linxiaoya').好感, 65)
  assert.ok(r.warnings.some((w) => w.includes('王大鹏')))
})

test('好感变化被夹到 ±5', async () => {
  const 暴涨 = 好回复.replace('"delta":3', '"delta":40')
  const s = 局面()
  await 跑(s, createJournal(), { streamImpl: 假客户端(暴涨) })
  assert.equal(s.party.find((p) => p.npcId === 'linxiaoya').好感, 67)
})

test('走到下板寺会触发结局并扣罚款', async () => {
  const 到终点 = 好回复.replace('"去向建议":"水窝子营地"', '"去向建议":"下板寺"')
  const s = 局面()
  s.place = { nodeId: 'tianyuandifang', 海拔: 3510 }
  const r = await 跑(s, createJournal(), {
    streamImpl: 假客户端(到终点),
    选中项: { id: 'B', 文本: '走完最后一段', 类型: '徒步', require: {}, cost: {} },
  })
  assert.equal(r.ending.type, '成功穿越')
  assert.equal(s.phase, '结局')
  assert.equal(s.money, 4320 - 5000 < 0 ? 0 : 4320 - 5000)
})

test('体力耗尽会触发失败遇险', async () => {
  const s = 局面()
  s.pc.体力 = 3
  const r = await 跑(s, createJournal(), { streamImpl: 假客户端(好回复) })
  assert.equal(r.ending.type, '失败遇险')
  assert.equal(s.phase, '结局')
})

test('onDelta 被透传给客户端，用于打字机上屏', async () => {
  let 透传到 = null
  await 跑(局面(), createJournal(), {
    onDelta: () => {},
    streamImpl: async ({ onDelta }) => ((透传到 = onDelta), { text: 好回复 }),
  })
  assert.equal(typeof 透传到, 'function')
})

test('已结束的局不再推进', async () => {
  const s = 局面()
  s.phase = '结局'
  s.ending = { type: '成功穿越', 原因: '走到了下板寺' }
  let 调用了 = false
  const r = await runTurn({
    state: s, journal: createJournal(), 选中项: { id: 'A', 文本: '继续', 类型: '徒步' },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => { 调用了 = true; return { text: '' } },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error.kind, 'ended')
  assert.equal(调用了, false, '结束后不该再花钱调模型')
})

test('选项门槛在判定前会被重新夹取，不靠调用方自觉', async () => {
  const s = 局面()
  s.pc.户外经验 = 38
  // UI 若错传了未夹取的原始提议：社交类经验门槛上限是 30，5000 应被夹到 30
  const r = await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '搭话', 类型: '社交', require: { 经验: 5000 }, cost: { 体力: -50 } },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' }),
  })
  // 夹到 30 后差距只有 -8（已达标），而非 4962
  assert.equal(r.判定.gap, 0, `门槛没被重夹，gap = ${r.判定.gap}`)
})

test('不传 rng 也必须按存档种子复现，而不是退化成恒定 0.5', async () => {
  const 跑一局 = async (种子) => {
    const st = 局面()
    st.meta.随机种子 = 种子
    st.pc.户外经验 = 38
    return runTurn({
      state: st, journal: createJournal(),
      // 门槛 43 → 差距 5 → 成功率 0.62，正好落在掷骰档
      选中项: { id: 'A', 文本: '试试', 类型: '徒步', require: { 经验: 43 }, cost: {} },
      config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
      streamImpl: async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' }),
    })
  }
  // 同种子两次，结果必须一致
  const a1 = await 跑一局(11)
  const a2 = await 跑一局(11)
  assert.equal(a1.判定.roll, a2.判定.roll, '同种子掷骰不一致')

  // 不同种子应当掷出不同的点数——若默认值是常量 0.5，这里会相等
  const 点数 = new Set()
  for (const 种子 of [1, 2, 3, 4, 5, 6, 7, 8]) 点数.add((await 跑一局(种子)).判定.roll)
  assert.ok(点数.size > 1, `八个不同种子掷出同一个点数 ${[...点数]}，rng 默认值退化了`)
})

test('兜底选项与正常选项同形，UI 不必区分两种形状', () => {
  for (const o of FALLBACK_OPTIONS) {
    assert.ok(o.id && o.文本, '缺 id 或文本')
    assert.ok(o.类型, `${o.id} 缺类型`)
    assert.deepEqual(o.require, {}, `${o.id} 的 require 应为空对象而非 undefined`)
    assert.deepEqual(o.cost, {}, `${o.id} 的 cost 应为空对象而非 undefined`)
  }
})

test('模型报了离队，引擎真的让人离队', async () => {
  const s = 局面()
  const j = createJournal()
  const r = await runTurn({
    state: s, journal: j,
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({
      text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{"离队":[{"npc":"陈岩","因":"膝伤下撤"}]}',
    }),
  })
  assert.equal(r.ok, true)
  const 陈 = s.party.find((p) => p.npcId === 'chenyan')
  assert.equal(陈.在队, false, '模型说他走了，引擎却没让他走')
  assert.equal(陈.状态, '膝伤下撤')
})

test('离队后好感门槛不再为他放行', async () => {
  const s = 局面()
  // 陈岩初始好感 45，门槛 40 本该达标
  const { gap: 离队前 } = gapFor({ 好感: { chenyan: 40 } }, s)
  assert.equal(离队前, 0)

  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({
      text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{"离队":[{"npc":"陈岩","因":"下撤"}]}',
    }),
  })
  const { gap: 离队后 } = gapFor({ 好感: { chenyan: 40 } }, s)
  assert.equal(离队后, UNREACHABLE, '人都走了，门槛还放行')
})

test('LLM 提的天气会解析出等级，不再是孤儿字段', async () => {
  const s = 局面()
  const r = await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({
      text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{"天气建议":"转北风，夜间可能暴风雪"}',
    }),
  })
  assert.equal(r.ok, true)
  assert.equal(s.weather.等级, 9, `暴风雪应为 9 级，实为 ${s.weather.等级}`)
})

test('长天气描述先解析等级再截断，关键词不会被切掉', async () => {
  const s = 局面()
  // 44 字，关键词「暴风雪」在第 41 字——先截断再解析会静默降成 2 级
  const 长句 = '今日天气多云间晴，气温适宜，风力较小，较为舒适，请注意防晒并携带足够饮水，傍晚可能暴风雪'
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({
      text: `[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{"天气建议":"${长句}"}`,
    }),
  })
  assert.equal(s.weather.等级, 9, `等级被静默降级：${s.weather.等级}`)
  assert.ok(s.weather.状态.length <= 40, '显示文本仍应截断')
})

test('跨到第二天会睡一觉：回体力、累计高山适应', async () => {
  const s = 局面()
  s.clock = { day: 4, slot: '晚' }
  s.place = { nodeId: 'shuiwozi', 海拔: 3100 }
  s.pc.体力 = 40
  s.flags.高海拔过夜数 = 0
  s.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })

  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' }),
  })

  assert.equal(s.clock.day, 5, '应已跨天')
  assert.equal(s.flags.高海拔过夜数, 1, '3100m 营地过夜没累计适应')
  // 走一段扣体力，睡一觉回 25，净值应高于走完那一刻
  assert.ok(s.pc.体力 > 40 - 15, `睡眠没回体力：${s.pc.体力}`)
})

test('同一天内推进时段不会睡觉', async () => {
  const s = 局面()
  s.clock = { day: 4, slot: '早' }
  s.flags.高海拔过夜数 = 0
  await runTurn({
    state: s, journal: createJournal(),
    选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
    config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
    streamImpl: async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' }),
  })
  assert.equal(s.clock.slot, '中')
  assert.equal(s.flags.高海拔过夜数, 0, '没跨天却睡了')
})

test('恶劣天气按 weather.等级 判定，不靠调用方瞎猜', async () => {
  const 造 = (等级) => {
    const s = 局面()
    s.clock = { day: 4, slot: '晚' }
    s.place = { nodeId: 'shuiwozi', 海拔: 3100 }
    s.pc.体力 = 30
    s.weather = { 状态: 'x', 等级 }
    s.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
    s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
    return s
  }
  const 跑 = async (s) => {
    await runTurn({
      state: s, journal: createJournal(),
      选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
      config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
      streamImpl: async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' }),
    })
    return s.pc.体力
  }
  const 好天 = await 跑(造(2))
  const 恶劣 = await 跑(造(8))
  assert.ok(好天 > 恶劣, `恶劣天气(${恶劣}) 应比好天(${好天}) 回得少`)
})

test('冬季连续三夜没睡袋，主循环里真的走到失败遇险', async () => {
  const s = 局面()
  s.meta.季节 = '冬季'
  s.place = { nodeId: 'shuiwozi', 海拔: 3100 }
  s.pc.体力 = 100
  for (let i = 0; i < 3; i++) {
    s.clock = { day: 4 + i, slot: '晚' }
    await runTurn({
      state: s, journal: createJournal(),
      选中项: { id: 'A', 文本: '走', 类型: '徒步', require: {}, cost: {} },
      config: { apiKey: 'k', baseURL: 'https://x/v1', model: 'm' },
      streamImpl: async () => ({ text: '[剧情]\n甲\n\n[下回选项]\nA. 乙\n\n<<<STATE>>>\n{}' }),
    })
  }
  assert.equal(s.flags.失温连败, 3)
  assert.equal(s.phase, '结局', '三夜失温却没进结局')
})
