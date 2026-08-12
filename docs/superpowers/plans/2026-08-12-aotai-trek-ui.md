# 穿越鳌太线 · 计划三：徒步阶段与主界面

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接上徒步阶段的回合循环，做出双栏仪表盘 + 立绘舞台 + 剧情流 + 选项区的主界面与结局页——完成后从捏人一路走到结局，是一个能玩完的完整游戏。

**Architecture:** 延续计划二：纯视图模型（可测）+ 薄渲染层（手验）。主界面按区块拆成独立的视图模型函数，各自可测；渲染层只摆 DOM。全程 `textContent`，禁止把动态数据拼进 `innerHTML`——LLM 正文会上屏，而 API key 就在同源 `localStorage`。

**Tech Stack:** 原生 ES 模块 + `node --test` + `build.mjs` 拼接为单文件。无 npm 依赖。

---

## 现状

计划一（引擎与 LLM 层，16 模块）与计划二（引擎补完 + 准备三屏）均已合并进 master，**379 个测试全绿**。`dist/穿越鳌太线.html` 双击可开，能走完 配置 → 捏人 → 掷季节 → 抽卡 → 采购 → 出发，写入自动存档。12 张真人立绘已就位并验证顶替占位。

点「确认出发」目前只会提示「计划三将接上徒步阶段」。本计划把这句提示换成真游戏。

**唯一尚未验证的假设**：`smoke.mjs` 还没对真实 API 跑过，没有任何模型被实际要求遵守混合协议。这不阻塞本计划的实现，但**在本计划完工前必须跑一次**，否则主界面做得再漂亮也可能在第一个真回合就散架。

---

## 代码风格约束（延续前两个计划，务必遵守）

`build.mjs` 靠行首正则剥离模块语法并把所有模块拼进同一个作用域，因此 `src/` 下所有文件必须：

1. **只用具名导出**，禁止 `export default`、禁止 `export { a, b }` 集中导出
2. **导入必须单行**，行尾不得有注释
3. 行首的 `import` / `export` 前不得有缩进
4. **模块顶层不得有同名标识符**（含私有常量）。命名带模块前缀。**动手前先跑** `grep -rnE "^const |^export const |^export function " src/ | sort` 核对——前两个计划各撞过一次，一次是 `失温连败上限`，一次是 `SLOTS`
5. 新增 `src/*.js` 必须登记进 `MODULE_ORDER`

## 渲染安全（不可协商）

> **动态数据只能经 `setText()` 落地。任何把变量拼进 `innerHTML` 的写法都是缺陷。** 唯一例外是本地生成的立绘 SVG，必须显式标注 `// portrait-svg-safe`。`test/dom.test.js` 的护栏会扫描 `src/ui` 全目录。

本计划把 LLM 写的正文直接摆上屏幕，是整个项目里注入风险最高的一处。**不要图省事。**

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/turn.js` | 修改。日切时调 `sleep`，闭合 `isHarshWeather` 的调用链 |
| `src/ui/screen-game.js` | **新增。** 主界面的全部视图模型：左栏面板、立绘舞台、选项显示 |
| `src/ui/prose.js` | **新增。** 剧情分段与打字机的纯逻辑 |
| `src/ui/screen-ending.js` | **新增。** 结局页视图模型 |
| `src/ui/app.js` | 修改。接上徒步回合循环与自动存档 |
| `src/index.html` | 修改。补 `screen-game` 与 `screen-ending` 容器 |
| `src/styles.css` | 修改。双栏布局、立绘舞台、剧情流、选项区、结局页 |

---

## 阶段一 · 闭合夜间阶段

### Task 1: 日切时真的睡一觉

计划二留下的明确预警：`isHarshWeather(state.weather)` 定义好了（等级 ≥6 即恶劣），`sleep(state, { 恶劣天气 })` 也在，但 **`turn.js` 根本没调用过 `sleep()`**。

后果是三件事同时失效：

- 体力永远只减不加（睡眠是最大的一笔回复：+25）
- `flags.高海拔过夜数` 永不增长 → **高山适应永远达不成**，3400m 以上永远吃 −2 惩罚
- `flags.失温连败` 永不增长 → 计划二刚接好的「失败遇险」结局又变回死代码

而 `isHarshWeather` 会成为第三个死代码（前两个是 `失温连败` 和 `party.js`，都是这样被发现的）。

**Files:**
- Modify: `src/turn.js`
- Test: `test/turn.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

在 `test/turn.test.js` 末尾追加：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/turn.test.js`
Expected: FAIL — 高海拔过夜数仍为 0，体力只减不增

- [ ] **Step 3: 写实现**

`src/turn.js` 的导入行改为：

```js
import { applyStepCost, advanceSlot, dailyUpkeep, sleep } from './engine/consume.js'
```

并把 `validate.js` 的导入补上 `isHarshWeather`：

```js
import { validateProposal, clampRequire, clampCost, weatherLevel, isHarshWeather } from './llm/validate.js'
```

把时段推进那三行替换为：

```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 验证三条死代码全部活了**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs'
const t = readFileSync('src/turn.js', 'utf8')
for (const [名, 串] of [['sleep 被调用', 'sleep(state'], ['isHarshWeather 被调用', 'isHarshWeather(state.weather'], ['npcLeaves 被调用', 'npcLeaves(state']]) {
  console.log((t.includes(串) ? '✓ ' : '✗ ') + 名)
}
"
```

Expected：三项全 `✓`。这三个函数分别在三次评审里被发现「写了但没人调」，这一步是它们最终闭合的证明。

- [ ] **Step 6: 提交**

```bash
git add src/turn.js test/turn.test.js
git commit -m "feat: 日切时真的睡一觉，闭合最后一处死代码

turn.js 一直没调用 sleep()，导致三件事同时失效：体力只减不增、
高山适应永不达成（3400m 以上永远吃 -2 惩罚）、失温连败永不增长
（计划二刚接好的失败遇险结局又变回死代码）。isHarshWeather 也
因此成了第三个没人调的函数。

现在跨天即过夜，恶劣与否一律按 weather.等级 判。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 阶段二 · 主界面

### Task 2: 剧情分段与打字机

计划二留下的明确预警：**`textContent` 会把换行折叠成空格**。`src/styles.css` 里没有任何 `white-space` 规则，直接 `setText(节点, 剧情)` 会让「段落一\n\n段落二」渲染成「段落一 段落二」，LLM 精心分的段全没了。

正确做法不是退回 `innerHTML`，而是按段切开、每段一个 `<p>`。

**Files:**
- Create: `src/ui/prose.js`
- Modify: `build.mjs`
- Test: `test/prose.test.js`

- [ ] **Step 1: 写失败的测试**

`test/prose.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitParagraphs, typewriterFrames, TYPE_CHARS_PER_FRAME } from '../src/ui/prose.js'

test('按空行切段', () => {
  assert.deepEqual(splitParagraphs('甲\n\n乙\n\n丙'), ['甲', '乙', '丙'])
})

test('单换行不切段——LLM 常在一段里手动折行', () => {
  assert.deepEqual(splitParagraphs('甲\n乙'), ['甲 乙'])
})

test('多余空行不产生空段', () => {
  assert.deepEqual(splitParagraphs('甲\n\n\n\n乙'), ['甲', '乙'])
})

test('首尾空白被清掉', () => {
  assert.deepEqual(splitParagraphs('\n\n  甲  \n\n'), ['甲'])
})

test('空输入给空数组而不是 [""]', () => {
  assert.deepEqual(splitParagraphs(''), [])
  assert.deepEqual(splitParagraphs('   \n\n  '), [])
  assert.deepEqual(splitParagraphs(null), [])
})

test('打字机逐帧推进，末帧等于全文', () => {
  const 全文 = '陈岩用杖尖敲了敲碎石。'
  const 帧 = typewriterFrames(全文)
  assert.equal(帧[帧.length - 1], 全文)
  assert.ok(帧.length > 1, '至少要有多帧才叫打字机')
})

test('打字机每帧只增不减，且严格递增', () => {
  const 帧 = typewriterFrames('这是一段用来验证打字机推进的文字，足够长。')
  for (let i = 1; i < 帧.length; i++) {
    assert.ok(帧[i].length > 帧[i - 1].length, `第 ${i} 帧没有推进`)
    assert.ok(帧[i].startsWith(帧[i - 1]), `第 ${i} 帧不是前一帧的延长`)
  }
})

test('帧数按每帧字数换算，不会一字一帧拖死长文', () => {
  const 长文 = '啊'.repeat(600)
  const 帧 = typewriterFrames(长文)
  assert.equal(帧.length, Math.ceil(600 / TYPE_CHARS_PER_FRAME))
})

test('空文本不产生帧', () => {
  assert.deepEqual(typewriterFrames(''), [])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/prose.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/prose.js`：

```js
// 剧情文本的纯逻辑。DOM 无关，因此可测。
//
// 为什么要有 splitParagraphs：textContent 会把换行折叠成空格，
// 直接 setText(节点, 剧情) 会让 LLM 分好的段全糊成一坨。
// 解法不是退回 innerHTML（正文是 LLM 写的，注入风险最高的一处），
// 而是按段切开、每段一个 <p>，全程留在 textContent 里。

export const TYPE_CHARS_PER_FRAME = 3

export function splitParagraphs(文本) {
  if (typeof 文本 !== 'string') return []
  return 文本
    .split(/\n\s*\n/)
    .map((段) => 段.trim().replace(/\s*\n\s*/g, ' '))
    .filter((段) => 段.length > 0)
}

// 打字机队列。流式分块是忽快忽慢的——有时一次来 50 字，直接上屏会一顿一顿。
// 这个队列把网络来的内容存起来，由渲染层按固定节奏匀速抽出，显示就稳了。
//
// 不做「拿完整文本切帧」那种设计：live 路径由 onDelta 驱动，而存档里不保存
// 正文（packSave 只存 state 与 journal），根本没有重放这条路——那样的函数
// 会没有调用方。这个项目已经出过三次「写了但没人调」了。
export function createTypewriter(每帧字数 = TYPE_CHARS_PER_FRAME) {
  let 缓冲 = ''
  let 已出 = 0
  return {
    push(块) {
      if (typeof 块 === 'string') 缓冲 += 块
    },
    // 抽一帧：返回本帧应显示的全文；没有新内容则返回 null，渲染层据此停表
    tick() {
      if (已出 >= 缓冲.length) return null
      已出 = Math.min(缓冲.length, 已出 + 每帧字数)
      return 缓冲.slice(0, 已出)
    },
    done() {
      return 已出 >= 缓冲.length
    },
    // 玩家点「跳过」时一次吐完
    flush() {
      已出 = 缓冲.length
      return 缓冲
    },
    text() {
      return 缓冲
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/prose.test.js`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 在 `'src/ui/dom.js',` 之后加入 `'src/ui/prose.js',`。

```bash
git add src/ui/prose.js test/prose.test.js build.mjs
git commit -m "feat: 剧情分段与打字机的纯逻辑

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 主界面视图模型

主界面三块：左栏仪表盘、立绘舞台、剧情与选项区。全部逻辑在这里算清楚，渲染层只摆 DOM。

**选项显示是本任务的重点。** 设计承诺是「玩家能看懂自己为什么失败」——达标显 ✓、勉强标黄写概率、差太远置灰写差多少。这要求在**玩家点击之前**就把门槛比对算出来（用 `gapFor`，不掷骰），点击时才真正 `judgeOption` 掷骰。两者用同一套差距计算，所以显示的概率和实际概率一致，不会骗人。

**Files:**
- Create: `src/ui/screen-game.js`
- Modify: `build.mjs`
- Test: `test/screen-game.test.js`

- [ ] **Step 1: 写失败的测试**

`test/screen-game.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelViewModel, optionDisplay, stageViewModel, gameViewModel } from '../src/ui/screen-game.js'
import { createInitialState } from '../src/engine/state.js'
import { UNREACHABLE } from '../src/engine/threshold.js'

function 局面() {
  const s = createInitialState({
    种子: 42, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: ['装备维修'], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'linxiaoya', 好感: 62 }],
    背包: [{ gearId: 'backpack', 档: '主流', 数量: 1 }, { gearId: 'staple_food', 档: '主流', 数量: 5 }],
    金钱: 4320,
  })
  s.clock = { day: 4, slot: '中' }
  s.place = { nodeId: 'maijieling', 海拔: 3500 }
  s.weather = { 状态: '大风', 等级: 6 }
  s.pc.体力 = 41
  return s
}

test('左栏带出角色、体力、负重、现金', () => {
  const vm = panelViewModel(局面())
  assert.equal(vm.名字, '周野')
  assert.equal(vm.体力, 41)
  assert.equal(vm.现金, 4320)
  assert.ok(vm.负重.当前 > 0)
  assert.equal(vm.负重.上限, 30)
})

test('负重接近上限时标黄，超了标红', () => {
  const s = 局面()
  assert.equal(panelViewModel(s).负重.档, '正常')
  s.carry.当前 = 27
  assert.equal(panelViewModel(s).负重.档, '偏重')
  s.carry.当前 = 31
  assert.equal(panelViewModel(s).负重.档, '超重')
})

test('体力低于 20 要给出警示——那是判定额外加 10 点难度的门槛', () => {
  const s = 局面()
  s.pc.体力 = 19
  const vm = panelViewModel(s)
  assert.equal(vm.体力告警, true)
  s.pc.体力 = 20
  assert.equal(panelViewModel(s).体力告警, false)
})

test('同行者带好感与分级标签，离队的不出现', () => {
  const s = 局面()
  const vm = panelViewModel(s)
  assert.equal(vm.同行者.length, 2)
  const 林 = vm.同行者.find((p) => p.npcId === 'linxiaoya')
  assert.equal(林.好感, 62)
  assert.ok(林.分级, '缺好感分级标签')

  s.party.find((p) => p.npcId === 'chenyan').在队 = false
  assert.equal(panelViewModel(s).同行者.length, 1)
})

test('背包按余量给出告警项', () => {
  const s = 局面()
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 12 })
  const vm = panelViewModel(s)
  const 炉 = vm.背包.find((i) => i.gearId === 'stove')
  assert.equal(炉.余量告警, true, '余量 12% 应告警')
})

test('选项达标：可点、无警示', () => {
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 30 } }, 局面())
  assert.equal(d.可点, true)
  assert.equal(d.档, '达标')
  assert.equal(d.概率文案, '')
})

test('选项勉强：可点、标黄、写出概率', () => {
  // 经验 38，门槛 43 → 差 5 → 0.62
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 43 } }, 局面())
  assert.equal(d.可点, true)
  assert.equal(d.档, '勉强')
  assert.ok(d.概率文案.includes('62'), `概率没写对：${d.概率文案}`)
})

test('选项差太远：置灰、写明差多少', () => {
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 60 } }, 局面())
  assert.equal(d.可点, false)
  assert.equal(d.档, '不可达')
  assert.ok(d.理由.includes('22'), `没写出差多少：${d.理由}`)
})

test('缺物品的选项置灰，理由点名缺什么', () => {
  const d = optionDisplay({ id: 'A', 文本: '爬', 类型: '徒步', require: { 物品: ['rope'] } }, 局面())
  assert.equal(d.可点, false)
  assert.ok(d.理由.includes('rope') || d.理由.includes('绳'), `理由没点名缺件：${d.理由}`)
})

test('理由首条是真正卡住玩家的那一条', () => {
  // 经验差 7、体力差 20 → 卡住的是体力
  const d = optionDisplay({ id: 'A', 文本: '走', 类型: '徒步', require: { 经验: 45, 体力: 61 } }, 局面())
  assert.ok(d.理由.includes('体力'), `首条理由应为体力：${d.理由}`)
})

test('无门槛的选项一律可点', () => {
  const d = optionDisplay({ id: 'B', 文本: '休整', 类型: '徒步' }, 局面())
  assert.equal(d.可点, true)
  assert.equal(d.档, '达标')
})

test('立绘舞台只列在队的人，说话人高亮', () => {
  const vm = stageViewModel(局面(), 'linxiaoya')
  assert.equal(vm.人物.length, 2)
  assert.equal(vm.人物.find((p) => p.npcId === 'linxiaoya').说话中, true)
  assert.equal(vm.人物.find((p) => p.npcId === 'chenyan').说话中, false)
})

test('没有说话人时无人高亮', () => {
  const vm = stageViewModel(局面(), null)
  assert.ok(vm.人物.every((p) => !p.说话中))
})

test('gameViewModel 把三块拼齐，并带出时间地点天气', () => {
  const vm = gameViewModel({
    state: 局面(),
    回合: { 标题: '刃脊上的三十米', 剧情: '甲\n\n乙', 万象: ['一', '二', '三', '四'],
            选项: [{ id: 'A', 文本: '走', 类型: '徒步', require: {} }] },
    说话人: 'chenyan',
  })
  assert.ok(vm.面板)
  assert.ok(vm.舞台)
  assert.equal(vm.标题, '刃脊上的三十米')
  assert.deepEqual(vm.段落, ['甲', '乙'])
  assert.equal(vm.万象.length, 4)
  assert.equal(vm.选项.length, 1)
  assert.equal(vm.顶栏.地点, '麦秸岭')
  assert.equal(vm.顶栏.海拔, 3500)
  assert.ok(vm.顶栏.时间.includes('第4天'))
  assert.ok(vm.顶栏.天气.includes('大风'))
})

test('gameViewModel 对空回合不炸——首次进入徒步阶段时还没有回合数据', () => {
  const vm = gameViewModel({ state: 局面(), 回合: null, 说话人: null })
  assert.deepEqual(vm.段落, [])
  assert.deepEqual(vm.选项, [])
  assert.ok(vm.面板, '面板不该因为没有回合就消失')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/screen-game.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/screen-game.js`：

```js
import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'
import { getGear } from '../data/gear.js'
import { activeParty } from '../engine/party.js'
import { affinityLabel } from '../engine/affinity.js'
import { gapFor, successChance } from '../engine/threshold.js'
import { splitParagraphs } from './prose.js'

const GAME_负重偏重线 = 0.88
const GAME_体力告警线 = 20
const GAME_余量告警线 = 20

export function panelViewModel(state) {
  const 比 = state.carry.当前 / state.carry.上限
  const 档 = state.carry.当前 > state.carry.上限 ? '超重' : 比 >= GAME_负重偏重线 ? '偏重' : '正常'

  return {
    名字: state.pc.名字,
    职业: state.pc.职业,
    年龄: state.pc.年龄,
    性别: state.pc.性别,
    户外经验: state.pc.户外经验,
    体力: state.pc.体力,
    体力告警: state.pc.体力 < GAME_体力告警线,
    负重: { 当前: state.carry.当前, 上限: state.carry.上限, 比: Math.min(1, 比), 档 },
    现金: state.money,
    同行者: activeParty(state).map((p) => {
      const npc = getNpc(p.npcId)
      return { npcId: p.npcId, 名称: npc ? npc.名称 : p.npcId, 好感: p.好感, 分级: affinityLabel(p.好感), 状态: p.状态 }
    }),
    背包: state.pack.map((i) => {
      const g = getGear(i.gearId)
      return {
        gearId: i.gearId,
        名称: g ? g.名称 : i.gearId,
        数量: i.数量,
        余量: i.余量,
        余量告警: typeof i.余量 === 'number' && i.余量 <= GAME_余量告警线,
        每日消耗: g && typeof g.每日消耗 === 'number' && g.每日消耗 > 0 ? g.每日消耗 : null,
      }
    }),
  }
}

// 点击之前就把门槛比对算出来，用的是 judgeOption 同一套 gapFor——
// 所以界面上写的概率和真掷骰时的概率一致，不会骗人。
// 「玩家能看懂自己为什么失败」是整套判定设计的前提。
export function optionDisplay(option, state) {
  const { gap, reasons } = gapFor(option.require, state)
  const chance = successChance(gap)

  if (chance >= 1) {
    return { ...option, 可点: true, 档: '达标', 概率文案: '', 理由: '' }
  }
  if (chance <= 0) {
    return { ...option, 可点: false, 档: '不可达', 概率文案: '', 理由: reasons[0] || '条件不足' }
  }
  return {
    ...option,
    可点: true,
    档: '勉强',
    概率文案: `勉强 · 约 ${Math.round(chance * 100)}%`,
    理由: reasons[0] || '',
  }
}

export function stageViewModel(state, 说话人) {
  return {
    人物: activeParty(state).map((p) => {
      const npc = getNpc(p.npcId)
      return {
        npcId: p.npcId,
        名称: npc ? npc.名称 : p.npcId,
        状态: p.状态,
        说话中: p.npcId === 说话人,
      }
    }),
  }
}

export function gameViewModel({ state, 回合, 说话人 }) {
  const node = getNode(state.place.nodeId)
  return {
    顶栏: {
      时间: `第${state.clock.day}天 ${state.clock.slot}`,
      地点: node ? node.名称 : state.place.nodeId,
      海拔: state.place.海拔,
      天气: `${state.weather.状态} ${state.weather.等级}级`,
    },
    面板: panelViewModel(state),
    舞台: stageViewModel(state, 说话人),
    标题: 回合 ? 回合.标题 || '' : '',
    段落: 回合 ? splitParagraphs(回合.剧情) : [],
    万象: 回合 && Array.isArray(回合.万象) ? 回合.万象 : [],
    选项: 回合 && Array.isArray(回合.选项) ? 回合.选项.map((o) => optionDisplay(o, state)) : [],
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/screen-game.test.js`
Expected: PASS，15 个测试全绿

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/screen-game.js',`。

```bash
git add src/ui/screen-game.js test/screen-game.test.js build.mjs
git commit -m "feat: 主界面视图模型，选项门槛明码标价

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 结局页

三种结局（文档定死）：失败遇险、被救援、成功穿越（罚款 5000）。结局页要给出旅程回顾——走过的节点、关键事件、最终好感。

**Files:**
- Create: `src/ui/screen-ending.js`
- Modify: `build.mjs`
- Test: `test/screen-ending.test.js`

- [ ] **Step 1: 写失败的测试**

`test/screen-ending.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endingViewModel } from '../src/ui/screen-ending.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal, recordNode, recordEvent } from '../src/engine/journal.js'
import { FINE_AMOUNT } from '../src/engine/ending.js'

function 收场(type) {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 72 }, { npcId: 'linxiaoya', 好感: 31 }],
    背包: [], 金钱: 4320,
  })
  s.clock = { day: 7, slot: '晚' }
  s.phase = '结局'
  s.ending = { type, 原因: '测试' }
  const j = createJournal()
  recordNode(j, 'tangkou'); recordNode(j, 'shuiwozi'); recordNode(j, 'maijieling')
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝伤复发')
  return { s, j }
}

test('三种结局各有标题与定性', () => {
  for (const t of ['失败遇险', '被救援', '成功穿越']) {
    const { s, j } = 收场(t)
    const vm = endingViewModel(s, j)
    assert.ok(vm.标题, `${t} 缺标题`)
    assert.equal(vm.type, t)
    assert.ok(['惨败', '生还', '完成'].includes(vm.定性), `${t} 定性不合法：${vm.定性}`)
  }
})

test('成功穿越要写明罚款 5000——文档定死的', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.罚款, FINE_AMOUNT)
  assert.ok(vm.说明.includes(String(FINE_AMOUNT)), '说明里没写出罚款金额')
})

test('失败与被救援不罚款', () => {
  for (const t of ['失败遇险', '被救援']) {
    assert.equal(endingViewModel(收场(t).s, 收场(t).j).罚款, 0)
  }
})

test('回顾列出走过的节点，用中文名不是 id', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.回顾.节点.length, 3)
  assert.ok(vm.回顾.节点.includes('麦秸岭'), `节点没转中文名：${vm.回顾.节点}`)
})

test('回顾列出关键事件与天数', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.回顾.事件.length, 1)
  assert.equal(vm.回顾.天数, 7)
})

test('最终好感按高到低排，带分级标签', () => {
  const { s, j } = 收场('成功穿越')
  const vm = endingViewModel(s, j)
  assert.equal(vm.回顾.好感[0].名称, '陈岩')
  assert.equal(vm.回顾.好感[0].好感, 72)
  assert.ok(vm.回顾.好感[0].分级.includes('爱慕'), `72 应是爱慕档：${vm.回顾.好感[0].分级}`)
})

test('没有结局时返回 null，而不是编一个出来', () => {
  const { s, j } = 收场('成功穿越')
  s.phase = '徒步'
  s.ending = null
  assert.equal(endingViewModel(s, j), null)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/screen-ending.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/screen-ending.js`：

```js
import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'
import { affinityLabel } from '../engine/affinity.js'
import { FINE_AMOUNT } from '../engine/ending.js'

const ENDING_文案 = {
  失败遇险: { 标题: '你没能走下来', 定性: '惨败',
    说明: '山不会为谁破例。这一次，鳌太线留下了你。' },
  被救援: { 标题: '救援队找到了你', 定性: '生还',
    说明: '你活着下了山。代价是这趟没走完，以及一笔说不清的人情。' },
  成功穿越: { 标题: '你走完了鳌太线', 定性: '完成',
    说明: `你从下板寺走出景区大门，等着你的是一张 ${FINE_AMOUNT} 元的罚单。穿越鳌太线是违规的——但你确实走完了。` },
}

export function endingViewModel(state, journal) {
  if (state.phase !== '结局' || !state.ending) return null
  const 文案 = ENDING_文案[state.ending.type]
  if (!文案) return null

  return {
    type: state.ending.type,
    标题: 文案.标题,
    定性: 文案.定性,
    说明: 文案.说明,
    原因: state.ending.原因 || '',
    罚款: state.ending.type === '成功穿越' ? FINE_AMOUNT : 0,
    回顾: {
      天数: state.clock.day,
      节点: (journal.已过节点 || []).map((id) => {
        const n = getNode(id)
        return n ? n.名称 : id
      }),
      事件: (journal.关键事件 || []).map((e) => e.文本 || String(e)),
      好感: [...state.party]
        .sort((a, b) => b.好感 - a.好感)
        .map((p) => {
          const npc = getNpc(p.npcId)
          return { npcId: p.npcId, 名称: npc ? npc.名称 : p.npcId, 好感: p.好感, 分级: affinityLabel(p.好感), 在队: p.在队 }
        }),
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/screen-ending.test.js`
Expected: PASS，7 个测试全绿。

**若「回顾列出走过的节点」失败**，先确认 `journal` 里存节点的字段名——去 `src/engine/journal.js` 看 `recordNode` 写的是哪个键，按实际的改，不要改断言。

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/screen-ending.js',`。

```bash
git add src/ui/screen-ending.js test/screen-ending.test.js build.mjs
git commit -m "feat: 结局页视图模型与旅程回顾

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 阶段三 · 串联

### Task 5: 主界面渲染层与回合循环

把前四个任务接上 DOM，串成能玩的循环：**出发 → 徒步回合（点选项 → 调 LLM → 打字机上屏 → 刷新面板）→ 结局页**。

渲染层刻意做薄，所有分支都已在视图模型里测过。

**Files:**
- Modify: `src/ui/app.js`, `src/index.html`, `src/styles.css`
- Test: 无自动化测试（DOM 层靠手动验证）

- [ ] **Step 1: 补屏幕容器**

`src/index.html` 的 `#app` 里追加两个容器：

```html
  <section id="screen-game" class="screen"></section>
  <section id="screen-ending" class="screen"></section>
```

- [ ] **Step 2: 写样式**

`src/styles.css` 追加。要点：

- `.game-layout` 双栏 `display:flex`，左栏固定 200px，右栏 `flex:1`
- `.stage` 立绘舞台横向排列，`.stage-figure.speaking` 亮起、其余降到 `opacity:.45`
- `.prose p` 段间距，**不要**用 `white-space:pre-wrap`（Task 2 已按段切开，用 `<p>` 才是正解）
- `.option` 三档视觉：达标正常、勉强 `border-color:var(--warn)`、不可达 `opacity:.45` 且 `cursor:not-allowed`
- 手机宽度下 `.game-layout` 改为纵向堆叠

- [ ] **Step 3: 写渲染与循环**

`src/ui/app.js` 追加。要点：

- `APP出发` 末尾改为 `router.go('game')`，不再提示「计划三将接上」
- `renderGame(router)`：读 `gameViewModel`，摆左栏、舞台、剧情、万象、选项
- 点选项 → 调 `runTurn`。`onDelta` 只把分块 `push` 进 `createTypewriter()` 队列，**不直接上屏**；另起一个 30–50ms 的 `setInterval` 调 `tick()` 匀速吐字。网络分块忽快忽慢，直接上屏会一顿一顿。
- 每次 `tick()` 拿到全文后用 `splitParagraphs` 重新分段渲染，每段一个 `el('p')` + `setText`。**全程不碰 innerHTML**
- 提供「跳过」：调 `flush()` 一次吐完
- 回合结束：刷新面板、写自动存档、若 `state.phase === '结局'` 则 `router.go('ending')`
- 请求中禁用全部选项，避免连点发两次
- 出错时把 `r.error.提示` 显示在剧情区上方，并保留重试按钮——**不消费玩家的选择**

**渲染安全**：正文、万象、选项文案、人物名全部经 `setText`。护栏测试会扫。

- [ ] **Step 4: 构建并在浏览器里手动验证**

Run: `npm run build`，然后 `open dist/穿越鳌太线.html`

**必须真的点一遍**：

| 项 | 期望 |
|---|---|
| 出发 | 直接进主界面，不再提示计划三 |
| 左栏 | 体力/负重条随回合变化；负重接近 30kg 变黄；体力 <20 出告警 |
| 立绘舞台 | 在队的人都在；说话人亮起、其他人变暗 |
| 剧情 | 打字机逐字出；**空行真的分成了段落**，不是糊成一坨 |
| 选项 | 达标可点；勉强标黄写「约 62%」；不可达置灰写「差 22 点经验」 |
| 请求中 | 选项全部禁用，连点不会发两次 |
| 出错 | 显示人话提示，选择没被消费，可重试 |
| 结局 | 走到结局自动跳转，回顾列出节点/事件/最终好感 |
| 存档 | 每回合后刷新页面，进度还在 |
| 安全 | 让模型在正文里写 `<img src=x onerror=alert(1)>`，**不能弹窗** |

最后一项是全项目渲染安全约束的实地验证，**必须真的试**。

- [ ] **Step 5: 提交**

```bash
git add src/ui/app.js src/index.html src/styles.css
git commit -m "feat: 主界面渲染与徒步回合循环

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 对真实 API 跑通一整局

前面所有任务都用假模型验证过逻辑。这一步是**唯一一次真刀真枪**——用真实 API 从捏人玩到至少第 3 天，看这套混合协议在真模型手里到底成不成立。

**这是整个项目最大的未验证假设。** 到目前为止没有任何模型被实际要求遵守 `[剧情] / [鳌太万象] / [下回选项] / <<<STATE>>>` 这套格式。

**Files:**
- 视结果修改 `src/llm/prompt.js`

- [ ] **Step 1: 先跑冒烟脚本**

Run: `AOTAI_KEY=你的key npm run smoke`，再换一家 `npm run smoke siliconflow`

五项判定门任一 `✗`，按 `docs/superpowers/plans/2026-08-11-aotai-engine.md` 里 Task 18 的处置表修 system prompt，**改完重跑，直到两家都全绿**。

- [ ] **Step 2: 在浏览器里真玩一局**

填真 key，走完准备阶段，进徒步阶段玩到第 3 天。逐项记录：

| 观察点 | 记什么 |
|---|---|
| 正文字数 | 是否稳定在 300 字左右，有没有越写越长 |
| 万象 | 是否稳定 4 条 |
| 选项 | 是否稳定 4 个、是否都带了 require |
| 门槛合理性 | 有没有出现「喝口水需要经验 80」这种离谱定价；`console` 里的夹取 warning 有多少 |
| 数值一致性 | 面板上的体力/负重/好感与剧情叙述是否对得上 |
| 降级 | 有没有触发过 STATE 解析失败；触发时正文是否保留、游戏是否卡死 |
| 速度与成本 | 单回合首字延迟、总耗时；一局下来大致花了多少 token |
| **时序错乱** | 玩家在「晚」行动，但状态快照给模型看的已是次日早。模型会不会把傍晚的事写成早上？这是 T1 评审提出的疑点，只有真模型能验 |

- [ ] **Step 3: 按实测结果调 prompt**

只改 `src/llm/prompt.js`，每改一处都重跑冒烟确认没退化。常见调法见 Task 18 的处置表。

- [ ] **Step 4: 提交**

```bash
git add src/llm/prompt.js
git commit -m "fix: 按真实 API 实测结果调整 system prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] `npm test` 全绿，新增测试不少于 30 条
- [ ] `npm run build` 产出单文件 + assets，双击可开，控制台零报错
- [ ] 从捏人一路走到结局，全程不卡死
- [ ] 剧情空行真的分成段落，不是糊成一坨
- [ ] 选项三档视觉正确：达标可点 / 勉强标黄写概率 / 不可达置灰写差多少
- [ ] 让模型在正文里写 `<img src=x onerror=alert(1)>` 不弹窗
- [ ] 冬季连续三夜不带睡袋，主循环里真的走到「失败遇险」
- [ ] **至少两家厂商的冒烟五项全绿**
- [ ] `turn.js` 里 `sleep` / `isHarshWeather` / `npcLeaves` 三者都有调用点

## 不在本计划范围

立绘的表情/状态分层（`{npcId}_hurt.png`）、把 assets 烘焙成 base64 的真·单文件、存档导入导出的界面、海拔剖面地图。这些都是锦上添花，等真玩过几局再决定值不值得做。
