import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTurn, STATE_MARKER } from '../src/llm/parser.js'

const 正常输出 = `[剧情标题]
刃脊上的三十米

[剧情]
林晓雅蹲下把登山杖收短，回头喊："岩哥，这段我先过还是你先过？"风把她后半句吹散了。陈岩用杖尖在碎石上敲了两下，声音发闷。"底下是虚的，一个一个来，间距拉开十米。"

[鳌太万象]
1. 后队两个背影在雾里停了很久，似乎在争执要不要下撤。
2. 风向由西转北，云在往山脊这边压。
3. 石缝里卡着半截红色路标带，褪色严重。
4. 对讲机里断续传出呼叫，听不清位置。

[下回选项]
A. 让陈岩先过，你压后照看林晓雅
B. 提出原路退回水窝子等风停
C. 你打头阵，用绳子做保护
D. 在原地扎营等天亮

${STATE_MARKER}
{"好感":[{"npc":"林晓雅","delta":3,"因":"你退后让她先过"}],
 "记忆":["D4晚 麦秸岭 你逞强打头阵失败，陈岩当众制止"],
 "伏笔":{"新增":[],"已收":["石缝路标带"]},
 "选项":[{"id":"A","类型":"社交","require":{"好感":{"林晓雅":40}},"cost":{"体力":8}}]}`

test('正常输出：四段俱全', () => {
  const r = parseTurn(正常输出)
  assert.deepEqual(r.errors, [])
  assert.equal(r.标题, '刃脊上的三十米')
  assert.ok(r.剧情.includes('岩哥'))
  assert.ok(!r.剧情.includes('[鳌太万象]'), '正文串进了下一段')
  assert.equal(r.万象.length, 4)
  assert.equal(r.万象[0], '后队两个背影在雾里停了很久，似乎在争执要不要下撤。')
  assert.equal(r.选项.length, 4)
  assert.deepEqual(r.选项[0], { id: 'A', 文本: '让陈岩先过，你压后照看林晓雅' })
  assert.equal(r.选项[3].id, 'D')
})

test('正常输出：STATE 解析出对象', () => {
  const r = parseTurn(正常输出)
  assert.equal(r.state.好感[0].npc, '林晓雅')
  assert.equal(r.state.好感[0].delta, 3)
  assert.equal(r.state.记忆.length, 1)
  assert.deepEqual(r.state.伏笔.已收, ['石缝路标带'])
  assert.equal(r.state.选项[0].require.好感['林晓雅'], 40)
})

test('STATE 缺失：正文照常解析，state 为 null 并报错', () => {
  const 无尾段 = 正常输出.split(STATE_MARKER)[0]
  const r = parseTurn(无尾段)
  assert.equal(r.state, null)
  assert.ok(r.errors.some((e) => e.includes('STATE')))
  assert.equal(r.标题, '刃脊上的三十米')
  assert.equal(r.万象.length, 4)
  assert.equal(r.选项.length, 4)
})

test('STATE JSON 被截断：正文保留，state 为 null', () => {
  const 截断 = `${正常输出.split(STATE_MARKER)[0]}${STATE_MARKER}\n{"好感":[{"npc":"林晓雅","delt`
  const r = parseTurn(截断)
  assert.equal(r.state, null)
  assert.ok(r.errors.some((e) => e.includes('JSON')))
  assert.ok(r.剧情.includes('岩哥'), '正文不该因尾段崩掉而丢失')
})

test('STATE 被 markdown 代码围栏包裹：能剥掉', () => {
  const 围栏 = `${正常输出.split(STATE_MARKER)[0]}${STATE_MARKER}
\`\`\`json
{"好感":[],"记忆":["测试"],"选项":[]}
\`\`\``
  const r = parseTurn(围栏)
  assert.equal(r.state.记忆[0], '测试')
  assert.deepEqual(r.errors, [])
})

test('无语言标注的围栏同样能剥', () => {
  const 围栏 = `[剧情]\n正文\n\n${STATE_MARKER}\n\`\`\`\n{"记忆":["x"]}\n\`\`\``
  assert.equal(parseTurn(围栏).state.记忆[0], 'x')
})

test('模型用了全角引号：修复后仍能解析', () => {
  const 全角 = `[剧情]\n正文\n\n${STATE_MARKER}\n{“记忆”:[“天气转坏”],“好感”:[]}`
  const r = parseTurn(全角)
  assert.equal(r.state.记忆[0], '天气转坏')
  assert.ok(r.errors.some((e) => e.includes('全角')), '应记一条已修复的提示')
})

test('正文里恰好出现 STATE 标记：取最后一个', () => {
  const 干扰 = `[剧情]
陈岩说："别管那个 ${STATE_MARKER} 标记，那是对讲机杂音。"

${STATE_MARKER}
{"记忆":["真正的尾段"]}`
  const r = parseTurn(干扰)
  assert.equal(r.state.记忆[0], '真正的尾段')
  assert.ok(r.剧情.includes('对讲机杂音'))
})

test('段落标记用全角方括号也认', () => {
  const 全角标记 = `【剧情标题】\n标题在此\n\n【剧情】\n正文在此\n\n【下回选项】\nA. 甲\nB. 乙`
  const r = parseTurn(全角标记)
  assert.equal(r.标题, '标题在此')
  assert.equal(r.剧情, '正文在此')
  assert.equal(r.选项.length, 2)
})

test('万象用短横线或圆点列举也认', () => {
  const r = parseTurn(`[鳌太万象]\n- 甲\n- 乙\n• 丙\n\n[下回选项]\nA. 选项`)
  assert.deepEqual(r.万象, ['甲', '乙', '丙'])
})

test('选项用顿号或右括号分隔也认', () => {
  const r = parseTurn(`[下回选项]\nA、甲选项\nB) 乙选项\nC.丙选项\nD．丁选项`)
  assert.equal(r.选项.length, 4)
  assert.equal(r.选项[0].文本, '甲选项')
  assert.equal(r.选项[1].文本, '乙选项')
  assert.equal(r.选项[2].文本, '丙选项')
  assert.equal(r.选项[3].文本, '丁选项')
})

test('选项标号用全角字母也认', () => {
  // 模型在中文语境下真会打全角字母；只认 ASCII 会解析出 0 个选项而整回合降级
  const r = parseTurn(`[下回选项]\nＡ．甲选项\nＢ、乙选项\nＣ) 丙选项\nｄ. 丁选项`)
  assert.equal(r.选项.length, 4)
  assert.deepEqual(r.选项.map((o) => o.id), ['A', 'B', 'C', 'D'])
  assert.equal(r.选项[0].文本, '甲选项')
  assert.equal(r.选项[3].文本, '丁选项')
})

test('标记和首句挤在同一行时，整段不会静默消失', () => {
  const r = parseTurn(`[剧情] 林晓雅蹲下把登山杖收短\n她回头喊了一句\n\n[鳌太万象] 后队在雾里停了很久\n2. 风向由西转北\n\n[下回选项]\nA. 甲`)
  assert.ok(r.剧情.includes('登山杖'), '标记同行的首句丢了')
  assert.ok(r.剧情.includes('回头喊'), '同行标记之后的整段也丢了')
  assert.deepEqual(r.万象, ['后队在雾里停了很久', '风向由西转北'])
  assert.equal(r.选项.length, 1)
})

test('半截选项行不会变成文本为分隔符的假选项', () => {
  const r = parseTurn(`[下回选项]\nA.\nB. 有正文的选项`)
  assert.equal(r.选项.length, 1, `不该收下半截行，实得 ${JSON.stringify(r.选项)}`)
  assert.equal(r.选项[0].id, 'B')
})

test('JSON 字符串值里出现 STATE 标记也不切错位置', () => {
  const r = parseTurn(`[剧情]\n正文\n\n[下回选项]\nA. 甲\n\n${STATE_MARKER}\n{"记忆":["队友说别管那个 ${STATE_MARKER} 标记"]}`)
  assert.ok(r.state, `尾段该解析成功，实际 errors: ${r.errors}`)
  assert.ok(r.state.记忆[0].includes(STATE_MARKER))
})

test('缺少标题段时标题为空串，不报错', () => {
  const r = parseTurn(`[剧情]\n只有正文\n\n[下回选项]\nA. 甲`)
  assert.equal(r.标题, '')
  assert.equal(r.剧情, '只有正文')
})

test('完全没有段落标记：整段当正文，并报错', () => {
  const r = parseTurn('模型今天不听话，直接写了一大段没有任何标记的散文。')
  assert.ok(r.剧情.includes('散文'))
  assert.equal(r.选项.length, 0)
  assert.ok(r.errors.some((e) => e.includes('选项')))
})

test('空输入与非字符串输入都不炸', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    const r = parseTurn(bad)
    assert.equal(typeof r, 'object')
    assert.ok(Array.isArray(r.errors) && r.errors.length > 0)
    assert.equal(r.state, null)
  }
})

test('万象超过 4 条时全部保留，由上层决定截断', () => {
  const r = parseTurn(`[鳌太万象]\n1. 甲\n2. 乙\n3. 丙\n4. 丁\n5. 戊`)
  assert.equal(r.万象.length, 5)
})

test('选项编号乱序时按出现顺序保留原编号', () => {
  const r = parseTurn(`[下回选项]\nB. 乙\nA. 甲`)
  assert.deepEqual(r.选项.map((o) => o.id), ['B', 'A'])
})

test('STATE 不是对象（是数组或裸字符串）时判为无效', () => {
  assert.equal(parseTurn(`[剧情]\n甲\n\n${STATE_MARKER}\n[1,2,3]`).state, null)
  assert.equal(parseTurn(`[剧情]\n甲\n\n${STATE_MARKER}\n"就一句话"`).state, null)
})

test('parseTurn 从不抛异常', () => {
  const 恶意 = [
    `${STATE_MARKER}`,
    `${STATE_MARKER}\n{`,
    `[剧情]${STATE_MARKER}${STATE_MARKER}`,
    '['.repeat(500),
    `[下回选项]\n` + 'A. 甲\n'.repeat(300),
  ]
  for (const s of 恶意) {
    assert.doesNotThrow(() => parseTurn(s), `炸在: ${s.slice(0, 30)}`)
  }
})

// ══════════════════════════════════════════════════════════════
// 真模型跑偏实录
//
// 此前解析器的测试全是我们自己写的规整格式，从没测过真模型实际会
// 怎么偏。上线后第一次真跑就撞上了：正文残缺、选项为 0、掉进降级，
// 玩家看到四个来路不明的兜底选项。
//
// 下面每一条都是真实会发生的偏法，一条都不许再退化。
// ══════════════════════════════════════════════════════════════

const 齐活 = (r) => !!(r.剧情 && r.选项.length && r.state !== null)

test('跑偏①：整个回复被 markdown 围栏包住', () => {
  const r = parseTurn('```\n[剧情]\n甲乙丙。\n\n[下回选项]\nA. 走\n\n<<<STATE>>>\n{"选项":[]}\n```')
  assert.ok(齐活(r), `解析不全：选项${r.选项.length} STATE${r.state !== null}`)
})

test('跑偏②：用 ## 当段落标记而非方括号', () => {
  const r = parseTurn('## 剧情\n甲乙丙。\n\n## 下回选项\nA. 走\n\n<<<STATE>>>\n{"选项":[]}')
  assert.ok(齐活(r), `解析不全：选项${r.选项.length}`)
})

test('跑偏③：STATE 标记被加了粗体', () => {
  const r = parseTurn('[剧情]\n甲乙丙。\n\n[下回选项]\nA. 走\n\n**<<<STATE>>>**\n{"选项":[]}')
  assert.ok(r.state !== null, '一对星号就让整段结算丢了')
})

test('跑偏④：选项写成 1. 2. 而非 A. B.，按序映射到 A-D', () => {
  const r = parseTurn('[剧情]\n甲。\n\n[下回选项]\n1. 走\n2. 停\n3. 歇\n4. 看\n\n<<<STATE>>>\n{}')
  assert.equal(r.选项.length, 4)
  assert.deepEqual(r.选项.map((o) => o.id), ['A', 'B', 'C', 'D'])
  assert.equal(r.选项[0].文本, '走')
})

test('跑偏⑤：选项用圈号 ①②③④', () => {
  const r = parseTurn('[剧情]\n甲。\n\n[下回选项]\n① 走\n② 停\n\n<<<STATE>>>\n{}')
  assert.deepEqual(r.选项.map((o) => o.id), ['A', 'B'])
})

test('跑偏⑥：选项文案被加粗，星号要剥掉', () => {
  const r = parseTurn('[剧情]\n甲。\n\n[下回选项]\n**A. 走**\n\n<<<STATE>>>\n{}')
  assert.equal(r.选项.length, 1)
  assert.equal(r.选项[0].文本, '走', `星号没剥干净：${r.选项[0].文本}`)
})

test('跑偏⑦：混合偏法——## 标题 + 数字选项 + 粗体 STATE', () => {
  const r = parseTurn('## 剧情\n甲乙丙。\n\n## 下回选项\n1. 走\n2. 停\n\n**<<<STATE>>>**\n{"选项":[]}')
  assert.ok(齐活(r), `混合偏法解析不全：选项${r.选项.length} STATE${r.state !== null}`)
})

test('跑偏⑧：段落名后跟中文冒号', () => {
  const r = parseTurn('剧情：\n甲乙丙。\n\n下回选项：\nA. 走\n\n<<<STATE>>>\n{}')
  assert.ok(r.剧情.includes('甲乙丙'), `正文丢了：${JSON.stringify(r.剧情)}`)
  assert.equal(r.选项.length, 1)
})

test('被截断时老实报错，不假装成功', () => {
  const r = parseTurn('[剧情]\n陈岩用杖尖敲了敲碎石，声音发')
  assert.equal(r.state, null)
  assert.ok(r.errors.some((e) => e.includes('STATE')), '没点出 STATE 缺失')
})
