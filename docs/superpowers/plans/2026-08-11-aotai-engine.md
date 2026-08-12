# 穿越鳌太线 · 计划一：引擎与 LLM 层 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建成《穿越鳌太线》的前端权威引擎与 LLM 通信层——纯逻辑全部有测试覆盖，并能对着真实 API 跑通一个完整回合。

**Architecture:** 判定发生在调用 LLM 之前。前端 `engine/` 持有唯一权威状态并完成全部判定与结算，`llm/` 只负责把既成事实送出去、把返回的正文与结算提议解析回来并校验。两层通过纯数据交互，互不引用对方的内部结构。

**Tech Stack:** 纯前端零依赖。`src/` 用标准 ES module 开发（仅具名导出、导入写单行），`node --test` 直接 import 测试，`build.mjs` 按拓扑顺序剥掉 import/export 行后拼接成单文件。

**Spec:** `docs/superpowers/specs/2026-08-11-aotai-html-game-design.md`

**本计划不含**（留给计划二）：存档 `persist`、七块界面、单文件交付与烘焙脚本、12 份生图 prompt。

---

## 代码风格约束（构建脚本的前提，务必遵守）

`build.mjs` 靠正则剥离模块语法，因此 `src/` 下所有文件必须：

1. **只用具名导出**：`export function foo() {}` / `export const BAR = {}`。禁止 `export default`、禁止 `export { a, b }` 集中导出。
2. **导入必须单行**：`import { foo, bar } from './x.js'`。禁止跨行导入、禁止 `import * as ns`。
3. **模块顶层不得有同名标识符**：拼接后所有模块共享一个作用域，重名会直接覆盖。命名带模块前缀（如 `judgeOption`、`applyConsume`）。
4. 行首的 `import` / `export` 关键字前不得有缩进。
5. **模块私有常量也必须带模块前缀**。这是第 3 条最容易被忽略的一半——`const BY_ID = new Map(...)` 这种查表常量每个数据模块都想要一个，四个模块写四遍就是四重覆盖。一律写成 `ROUTE_BY_ID` / `NPC_BY_ID` / `GEAR_BY_ID` / `SEASON_BY_ID`。同理适用于 `SECTIONS`、`SLOTS`、`DEFAULTS` 这类通用名。

> 违反第 3、5 条不会静默：`test/build.test.js` 的「bundle 可求值」用例会在拼接产物里撞出 `Identifier 'X' has already been declared` 并失败。但**命名冲突要在写代码时就避免，别指望测试兜底**——等到第 12 个模块才发现，改动面就大了。

---

## 文件结构

```
package.json                 # type: module，test 脚本
build.mjs                    # 拓扑拼接 → dist/穿越鳌太线.html
smoke.mjs                    # 对着真实 API 跑一个回合的冒烟脚本
src/
  data/route.js              # ROUTE 24 节点（含水源、营地、下撤、相邻关系）
  data/npcs.js               # NPCS 10+2 人（含 4 维性格轴）、PERSONALITY_TAGS 玩家性格标签
  data/gear.js               # GEAR 原表 20 项（三档价）、EXTRA_GEAR 扩充 25 项
  data/seasons.js            # SEASONS 四季风险
  engine/rng.js              # 可复现 PRNG（mulberry32）
  engine/state.js            # 初始 state 工厂、快照、回滚、负重重算
  engine/threshold.js        # 门槛差距计算、成功率、掷骰判定
  engine/consume.js          # 时段消耗、回复、高山适应
  engine/affinity.js         # 好感夹取、性格轴初始好感
  engine/ending.js           # 三种结局判定
  engine/journal.js          # 旅程档案维护与超限压缩
  llm/parser.js              # 混合协议解析（标记正文 + 尾部 STATE JSON）
  llm/validate.js            # STATE 提议校验与夹取
  llm/prompt.js              # system prompt 与每回合 user message 组装
  llm/client.js              # OpenAI 兼容 fetch、SSE 流式、退避重试
  turn.js                    # 回合编排：判定→请求→解析→补救→校验→原子应用/回滚
test/
  build.test.js  route.test.js  npcs.test.js  gear.test.js  seasons.test.js
  rng.test.js  state.test.js  threshold.test.js  consume.test.js
  affinity.test.js  ending.test.js  journal.test.js
  parser.test.js  validate.test.js  prompt.test.js  client.test.js
  turn.test.js
  fixtures/                  # 真实模型返回的录制样本
```

`turn.js` 刻意放在 `src/` 顶层而不是 `engine/` 下：它是唯一同时依赖 `engine/` 与 `llm/` 的模块，这样「engine 不依赖 llm」这条边界才守得住。

---

## 阶段一 · 地基

### Task 1: 项目骨架与测试管线

**Files:**
- Create: `package.json`
- Create: `src/engine/rng.js`
- Test: `test/rng.test.js`

- [ ] **Step 1: 建 package.json**

```json
{
  "name": "aotai-crossing",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "build": "node build.mjs"
  }
}
```

> **注意**：`node --test test/`（带目录参数）在 Node v25 下会失败——目录路径被当成 CJS 模块加载。用无参数的 `node --test`，它按默认模式自动发现 `test/*.test.js`；这样 `npm test` 跑全部、`npm test -- test/x.test.js` 正好跑单个，与本计划后续各任务的命令一致。

- [ ] **Step 2: 写失败的测试**

`test/rng.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRng } from '../src/engine/rng.js'

test('同一种子产出同一序列', () => {
  const a = makeRng(12345)
  const b = makeRng(12345)
  const seqA = [a(), a(), a(), a(), a()]
  const seqB = [b(), b(), b(), b(), b()]
  assert.deepEqual(seqA, seqB)
})

test('不同种子产出不同序列', () => {
  const a = makeRng(1)
  const b = makeRng(2)
  assert.notEqual(a(), b())
})

test('产出值落在 [0, 1)', () => {
  const rng = makeRng(999)
  for (let i = 0; i < 1000; i++) {
    const v = rng()
    assert.ok(v >= 0 && v < 1, `越界: ${v}`)
  }
})

test('rollInt 落在闭区间内且可复现', () => {
  const rng = makeRng(7)
  const vals = []
  for (let i = 0; i < 200; i++) vals.push(rollInt(rng, 1, 6))
  assert.ok(vals.every((v) => v >= 1 && v <= 6))
  assert.ok(vals.includes(1) && vals.includes(6))

  const rngB = makeRng(7)
  const valsB = []
  for (let i = 0; i < 200; i++) valsB.push(rollInt(rngB, 1, 6))
  assert.deepEqual(vals, valsB)
})
```

在文件顶部把 `rollInt` 一并导入：`import { makeRng, rollInt } from '../src/engine/rng.js'`（替换掉上面只导入 `makeRng` 的那行）。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../src/engine/rng.js'`

- [ ] **Step 4: 写最小实现**

`src/engine/rng.js`：

```js
// 可复现伪随机数发生器（mulberry32）。
// 判定必须可复现：同一存档重放要得到同样的结果，否则存档回放和 bug 复现都做不了。
export function makeRng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 闭区间 [min, max] 内的整数
export function rollInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: PASS，4 个测试全绿

- [ ] **Step 6: 提交**

```bash
git add package.json src/engine/rng.js test/rng.test.js
git commit -m "feat: 项目骨架与可复现 PRNG"
```

---

### Task 2: 构建管线

**Files:**
- Create: `build.mjs`
- Create: `src/index.html`
- Test: `test/build.test.js`

- [ ] **Step 1: 写骨架 HTML**

`src/index.html`（构建时 `__STYLES__` 与 `__SCRIPT__` 会被替换；计划二再填充真实界面容器）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>穿越鳌太线</title>
<style>__STYLES__</style>
</head>
<body>
<div id="app"></div>
<script>__SCRIPT__</script>
</body>
</html>
```

- [ ] **Step 2: 写失败的测试**

`test/build.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripModuleSyntax, buildScript } from '../build.mjs'

test('剥掉行首 import 语句', () => {
  const src = "import { a } from './x.js'\nconst b = 1\n"
  assert.equal(stripModuleSyntax(src), 'const b = 1\n')
})

test('剥掉 export 关键字但保留声明', () => {
  const src = 'export function foo() {}\nexport const BAR = 1\n'
  assert.equal(stripModuleSyntax(src), 'function foo() {}\nconst BAR = 1\n')
})

test('不碰字符串里出现的 import/export 字样', () => {
  const src = 'const s = "  import x"\nconst t = "export y"\n'
  assert.equal(stripModuleSyntax(src), src)
})

test('拼接结果里不残留模块语法', () => {
  const out = buildScript()
  assert.ok(!/^import\s/m.test(out), '残留 import')
  assert.ok(!/^export\s/m.test(out), '残留 export')
})

test('拼接结果包含各模块的关键标识符', () => {
  const out = buildScript()
  for (const id of ['makeRng', 'rollInt']) {
    assert.ok(out.includes(id), `缺少 ${id}`)
  }
})

test('拼接结果被 IIFE 包裹', () => {
  const out = buildScript()
  assert.ok(out.trimStart().startsWith(';(function () {'))
  assert.ok(out.trimEnd().endsWith('})();'))
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- test/build.test.js`
Expected: FAIL — `Cannot find module '.../build.mjs'`

- [ ] **Step 4: 写实现**

`build.mjs`：

```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// 拓扑顺序：被依赖者在前。新增模块必须手动登记在此。
export const MODULE_ORDER = [
  'src/engine/rng.js',
]

// 只删真正的 import 语句（必须有 from 子句或裸副作用导入），
// 只剥真正的 export 声明（后面必须跟 function/const/let/var/class）。
//
// 为什么不用宽松的 /^import\s/ 和 /^export\s+/：模板字符串的续行也在列 0，
// 一旦某行以 "export 你的数据" 或 "import 一段说明" 开头就会被静默改写或整行删掉。
// Task 15 的 system prompt 是一大段多行模板，正好是重灾区，而且测试跑的是 src/
// 的 ESM 原文、不是拼接产物，这种损坏永远测不出来。
const IMPORT_LINE = /^import\s+[^'"]*from\s+['"][^'"]+['"];?\s*$|^import\s+['"][^'"]+['"];?\s*$/
const EXPORT_KEYWORD = /^export\s+(?=(async\s+)?(function|const|let|var|class)\s)/

export function stripModuleSyntax(source) {
  return source
    .split('\n')
    .filter((line) => !IMPORT_LINE.test(line))
    .map((line) => line.replace(EXPORT_KEYWORD, ''))
    .join('\n')
}

export function buildScript() {
  const bodies = MODULE_ORDER.map((rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    return `// ===== ${rel} =====\n${stripModuleSyntax(src)}`
  })
  return `;(function () {\n'use strict'\n${bodies.join('\n')}\n})();`
}

export function buildHtml() {
  const shell = readFileSync(join(ROOT, 'src/index.html'), 'utf8')
  return shell.replace('__STYLES__', '').replace('__SCRIPT__', buildScript())
}

// 仅在直接执行时写盘，被 import 时不产生副作用
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(join(ROOT, 'dist'), { recursive: true })
  const out = join(ROOT, 'dist/穿越鳌太线.html')
  writeFileSync(out, buildHtml(), 'utf8')
  console.log(`已生成 ${out}`)
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: PASS，全部测试绿（数量以实际为准，别照抄写死的数字）

- [ ] **Step 6: 跑一次真实构建**

Run: `npm run build`
Expected: 输出 `已生成 .../dist/穿越鳌太线.html`

- [ ] **Step 7: 把 dist 加进忽略并提交**

`.gitignore` 已含 `dist/`，确认后提交：

```bash
git add build.mjs src/index.html test/build.test.js
git commit -m "feat: 构建管线，多文件拼接为单文件"
```

---

**登记提醒：此后每新增一个 `src/` 模块，都必须把它的路径按拓扑顺序追加进 `build.mjs` 的 `MODULE_ORDER`。后续每个 Task 的提交步骤都包含这一动作。**

**实际实现比上面的片段多了四道加固（评审后追加，已落地在 `build.mjs`）：**

1. `IMPORT_LINE` 容忍行尾注释——`import { a } from './x.js' // 说明` 这种行若漏进产物，会让整个游戏在加载时 `SyntaxError`（产物 `<script>` 没有 `type="module"`）。
2. **产物求值冒烟测试**：`new Function(buildScript())()` 真跑一遍 bundle，并注入探针确认拼接后的函数可调用。这是此类静默损坏的结构性防线——比把正则写全更可靠，因为其余测试跑的都是 `src/` 的 ESM 原文，碰不到拼接产物。
3. `assertModuleOrderComplete()` 递归扫描 `src/`，发现未登记的 `.js` 就报错并点名路径。忘记登记不再是静默缺模块。
4. `buildHtml()` 校验 `__STYLES__` / `__SCRIPT__` 占位符存在，缺失即报错，不再静默产出无脚本的 HTML。

已端到端验证：忘记登记新模块 → 4 个测试失败；登记了但用了被禁的多行 import → 求值测试与残留检查双双失败。

---

## 阶段二 · 静态数据

> **数据保真防线（T4 期间加入，T5/T6 自动生效）**
>
> `test/source-fidelity.test.js` 会把数据模块里所有含中文的字符串字面量，逐条拿去
> `test/fixtures/source-text.txt`（源 .docx 抽出的纯文本）里做子串匹配，找不到就失败并点名。
>
> 起因：T4 的实现代理把 猛蛇过江 事迹里的弯引号 `“驴友引路”` 悄悄转成了直引号，
> 却在报告里声称已保留。结构性测试（数量、字段齐备）全绿，只有逐字比对能发现。
>
> **新增数据模块后，把路径加进该测试的 `受检模块` 数组。** 项目自造、源文档本就没有的
> 中文（如捏人性格标签）加进 `允许不在源文档中` 并写明理由——清单里若出现源文档其实有的
> 条目，另有一条测试会报错。

### Task 3: 路线数据

**Files:**
- Create: `src/data/route.js`
- Modify: `build.mjs`（`MODULE_ORDER` 追加）
- Test: `test/route.test.js`

- [ ] **Step 1: 写失败的测试**

`test/route.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTE, MAIN_PATH, getNode, isAdjacent } from '../src/data/route.js'

test('共 24 个节点', () => {
  assert.equal(ROUTE.length, 24)
})

test('每个节点字段齐备且类型合法', () => {
  const 合法类型 = new Set(['起点', '核心', '终点', '下撤'])
  for (const n of ROUTE) {
    assert.ok(n.id, `缺 id: ${JSON.stringify(n)}`)
    assert.ok(n.名称, `缺名称: ${n.id}`)
    assert.equal(typeof n.海拔, 'number', `海拔非数字: ${n.id}`)
    assert.ok(n.特征, `缺特征: ${n.id}`)
    assert.ok(n.危险, `缺危险: ${n.id}`)
    assert.ok(合法类型.has(n.类型), `类型非法: ${n.id} = ${n.类型}`)
    assert.equal(typeof n.有水源, 'boolean', `有水源非布尔: ${n.id}`)
    assert.equal(typeof n.可扎营, 'boolean', `可扎营非布尔: ${n.id}`)
  }
})

test('id 无重复', () => {
  const ids = ROUTE.map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('主路径从塘口村到下板寺，海拔最高点是拔仙台', () => {
  assert.equal(MAIN_PATH[0], 'tangkou')
  assert.equal(MAIN_PATH[MAIN_PATH.length - 1], 'xiabansi')
  const 最高 = ROUTE.reduce((a, b) => (a.海拔 > b.海拔 ? a : b))
  assert.equal(最高.id, 'baxiantai')
  assert.equal(最高.海拔, 3767)
})

test('getNode 取得到也取不到', () => {
  assert.equal(getNode('maijieling').名称, '麦秸岭')
  assert.equal(getNode('不存在'), undefined)
})

test('相邻判定：主路径上前后相邻，跨节点不相邻', () => {
  assert.ok(isAdjacent('maijieling', 'shuiwozi'))
  assert.ok(isAdjacent('shuiwozi', 'maijieling'), '相邻应对称')
  assert.ok(!isAdjacent('tangkou', 'baxiantai'))
})

test('原地不算相邻', () => {
  assert.ok(!isAdjacent('maijieling', 'maijieling'))
})

test('下撤点挂在 2800 营地与水窝子上', () => {
  assert.ok(isAdjacent('yingdi2800', 'hetaoping'))
  assert.ok(isAdjacent('shuiwozi', 'hetaoping'))
  assert.ok(isAdjacent('yingdi2800', 'songpingsi'))
})

test('苗圃是备用起点，与火烧坡相邻', () => {
  assert.equal(getNode('miaopu').类型, '起点')
  assert.ok(isAdjacent('miaopu', 'huoshaopo'))
})

test('有水源的节点至少覆盖三个主力营地', () => {
  for (const id of ['yingdi2900', 'shuiwozi', 'yingdi2800', 'xiyuan']) {
    assert.ok(getNode(id).有水源, `${id} 应有水源`)
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/route.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/data/route.js`。数据全部取自 `docs/source/穿越鳌太线.docx` 的路线表，海拔区间取中值：

```js
// 鳌太线路线节点。数据来自文档「鳌太线穿越途径地点详情」表，一字未改。
// 海拔给区间的（如火烧坡 2700-3000），取中值。
export const ROUTE = [
  { id: 'tangkou', 名称: '塘口村起点', 海拔: 1700, 类型: '起点', 有水源: true, 可扎营: true,
    特征: '传统登山口，村庄道路起点。', 危险: '无。' },
  { id: 'miaopu', 名称: '苗圃', 海拔: 1800, 类型: '起点', 有水源: true, 可扎营: true,
    特征: '另一常用进山口，有简易路。', 危险: '无。' },

  { id: 'huoshaopo', 名称: '火烧坡', 海拔: 2850, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '漫长陡峭的拔高路段，体力第一道考验。', 危险: '体力透支。' },
  { id: 'yingdi2900', 名称: '2900营地/盆景园', 海拔: 2900, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '高山草甸，第一个常见露营地，有水源。', 危险: '天气骤变，易失温。' },
  { id: 'aoshan', 名称: '鳌山导航架', 海拔: 3475, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '鳌山主峰标志，象征性高点，多雾大风。', 危险: '强风、能见度极低。' },
  { id: 'yaowangdong', 名称: '药王洞', 海拔: 3360, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '岩石下庇护点，可避风，附近有水源。', 危险: '拥挤，卫生问题。' },
  { id: 'maijieling', 名称: '麦秸岭', 海拔: 3500, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '刀刃状山脊，两侧陡峭，需小心横切。', 危险: '恐高、滑坠风险。' },
  { id: 'shuiwozi', 名称: '水窝子营地', 海拔: 3100, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '重要水源地，较大营地，可南北下撤。', 危险: '争夺营地、水源污染。' },
  { id: 'feijiliang', 名称: '飞机梁', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '连续巨石山梁，攀爬耗时，天气多变区。', 危险: '体力消耗大、易迷路、滑坠。' },
  { id: 'yingdi2800', 名称: '2800营地', 海拔: 2800, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '山谷中营地，关键决策点，有水源。', 危险: '野兽（羚牛）。' },
  { id: 'jinzita', 名称: '金字塔', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '同样艰难的石海路段，攀爬难度高。', 危险: '巨石不稳、天气恶劣。' },
  { id: 'xiyuan', 名称: '西源营地', 海拔: 3100, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '九重石海前的最后一个补给营地。', 危险: '气候恶劣，易发高反。' },
  { id: 'jiuchongshihai', 名称: '九重石海', 海拔: 3550, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '全程最大挑战，直接拔高近500米的石海。', 危险: '体力与意志极限，易受伤。' },
  { id: 'dongyuan', 名称: '东源营地/太白梁顶', 海拔: 3400, 类型: '核心', 有水源: false, 可扎营: true,
    特征: '登上石海后的山顶平台。', 危险: '极度疲劳，放松警惕。' },
  { id: 'wanxianzhen', 名称: '万仙阵', 海拔: 3560, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '大片石堆群，神秘震撼，极易迷路。', 危险: '全线路况最易迷路点。' },
  { id: 'leigongmiao', 名称: '雷公庙', 海拔: 3530, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '简陋石屋地标。', 危险: '破损严重，不宜庇护。' },
  { id: 'dongpaomaliang', 名称: '东跑马梁', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '广阔的高山草甸，天气极端。', 危险: '极易遇极端大风、暴雨、失温。' },
  { id: 'baxiantai', 名称: '拔仙台', 海拔: 3767, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '太白山主峰，秦岭最高点。', 危险: '高海拔，天气恶劣。' },

  { id: 'dayehai', 名称: '大爷海', 海拔: 3590, 类型: '终点', 有水源: true, 可扎营: true,
    特征: '高山湖泊，接待站，可补给。', 危险: '无。' },
  { id: 'dawengongmiao', 名称: '大文公庙', 海拔: 3490, 类型: '终点', 有水源: true, 可扎营: true,
    特征: '接待站，可食宿。', 危险: '无。' },
  { id: 'tianyuandifang', 名称: '天圆地方', 海拔: 3510, 类型: '终点', 有水源: true, 可扎营: false,
    特征: '景区索道上站，旅游区起点。', 危险: '无。' },
  { id: 'xiabansi', 名称: '下板寺', 海拔: 2800, 类型: '终点', 有水源: true, 可扎营: false,
    特征: '景区车站，常规徒步终点。', 危险: '无。' },

  { id: 'hetaoping', 名称: '核桃坪', 海拔: 1500, 类型: '下撤', 有水源: true, 可扎营: true,
    特征: '从2800营地或水窝子向南，路陡林密。', 危险: '迷路、蛇虫。' },
  { id: 'songpingsi', 名称: '嵩坪寺', 海拔: 1400, 类型: '下撤', 有水源: true, 可扎营: true,
    特征: '从2800营地向北，至黄柏塬方向。', 危险: '路程远，野兽出没。' },
]

// 主推进路径。玩家沿此序列前进，抵达 xiabansi 即「成功穿越」。
export const MAIN_PATH = [
  'tangkou', 'huoshaopo', 'yingdi2900', 'aoshan', 'yaowangdong', 'maijieling',
  'shuiwozi', 'feijiliang', 'yingdi2800', 'jinzita', 'xiyuan', 'jiuchongshihai',
  'dongyuan', 'wanxianzhen', 'leigongmiao', 'dongpaomaliang', 'baxiantai',
  'dayehai', 'dawengongmiao', 'tianyuandifang', 'xiabansi',
]

// 主路径之外的额外连接：备用起点、南北下撤线
const ROUTE_EXTRA_LINKS = [
  ['miaopu', 'huoshaopo'],
  ['shuiwozi', 'hetaoping'],
  ['yingdi2800', 'hetaoping'],
  ['yingdi2800', 'songpingsi'],
]

const ROUTE_BY_ID = new Map(ROUTE.map((n) => [n.id, n]))

export function getNode(id) {
  return ROUTE_BY_ID.get(id)
}

export function isAdjacent(fromId, toId) {
  if (fromId === toId) return false
  const i = MAIN_PATH.indexOf(fromId)
  const j = MAIN_PATH.indexOf(toId)
  if (i !== -1 && j !== -1 && Math.abs(i - j) === 1) return true
  return ROUTE_EXTRA_LINKS.some(
    ([a, b]) => (a === fromId && b === toId) || (a === toId && b === fromId)
  )
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/route.test.js`
Expected: PASS，13 个测试全绿

- [ ] **Step 5: 登记进构建顺序**

`build.mjs` 的 `MODULE_ORDER` 改为：

```js
export const MODULE_ORDER = [
  'src/data/route.js',
  'src/engine/rng.js',
]
```

- [ ] **Step 6: 跑全量测试确认构建测试仍绿**

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 7: 提交**

```bash
git add src/data/route.js test/route.test.js build.mjs
git commit -m "feat: 路线数据 24 节点与相邻关系"
```

---

### Task 4: 人物数据与性格轴

**Files:**
- Create: `src/data/npcs.js`
- Modify: `build.mjs`
- Test: `test/npcs.test.js`

- [ ] **Step 1: 写失败的测试**

`test/npcs.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NPCS, PERSONALITY_TAGS, RANDOM_POOL, getNpc } from '../src/data/npcs.js'

test('共 12 人：10 随机配角 + 2 重要配角', () => {
  assert.equal(NPCS.length, 12)
  assert.equal(RANDOM_POOL.length, 10)
  assert.equal(NPCS.filter((n) => n.重要).length, 2)
})

test('随机池不含两位重要配角', () => {
  assert.ok(!RANDOM_POOL.includes('taxue'))
  assert.ok(!RANDOM_POOL.includes('mengshe'))
})

test('每人字段齐备', () => {
  for (const n of NPCS) {
    assert.ok(n.id && n.名称 && n.职业 && n.性格 && n.状态, `字段缺失: ${n.id}`)
    assert.equal(typeof n.年龄, 'number', `年龄非数字: ${n.id}`)
    assert.ok(Array.isArray(n.技能) && n.技能.length > 0, `技能为空: ${n.id}`)
  }
})

test('每人有 4 维性格轴，取值只能是 -1/0/1', () => {
  for (const n of NPCS) {
    assert.equal(n.轴.length, 4, `轴维度不对: ${n.id}`)
    assert.ok(n.轴.every((v) => v === -1 || v === 0 || v === 1), `轴取值非法: ${n.id}`)
  }
})

test('玩家性格标签同样是 4 维轴，且至少 8 个', () => {
  assert.ok(PERSONALITY_TAGS.length >= 8)
  for (const t of PERSONALITY_TAGS) {
    assert.ok(t.id && t.文案)
    assert.equal(t.轴.length, 4)
    assert.ok(t.轴.every((v) => v === -1 || v === 0 || v === 1))
  }
})

test('文档原文照搬：踏雪与猛蛇过江保留事迹结局', () => {
  assert.ok(getNpc('taxue').事迹.includes('失联21天'))
  assert.ok(getNpc('mengshe').事迹.includes('64小时'))
})

test('开局带伤的三人状态与文档一致', () => {
  assert.equal(getNpc('wangdapeng').状态, '膝盖旧伤复发')
  assert.equal(getNpc('zhoutao').状态, '脚踝扭伤')
  assert.equal(getNpc('sunxiaojie').状态, '肠胃不适，腹泻')
})

test('getNpc 取不到返回 undefined', () => {
  assert.equal(getNpc('查无此人'), undefined)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/npcs.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/data/npcs.js`。性格轴四维含义：`[内敛↔外向, 谨慎↔冒进, 独行↔合群, 务实↔理想]`，`-1` 取前者、`+1` 取后者、`0` 中立。轴值由文档给的性格描述译出：

```js
// 人物数据。名字/年龄/职业/技能/性格/状态全部照搬文档，未增删。
// 轴 = [内敛↔外向, 谨慎↔冒进, 独行↔合群, 务实↔理想]，-1 前者 / +1 后者 / 0 中立
export const NPCS = [
  { id: 'chenyan', 名称: '陈岩', 年龄: 42, 职业: '地质勘探员',
    技能: ['野外定位', '岩石识别', '气象观察'],
    性格: '沉稳谨慎，寡言但可靠', 状态: '正常', 轴: [-1, -1, 0, -1], 重要: false },
  { id: 'linxiaoya', 名称: '林晓雅', 年龄: 28, 职业: '急诊科护士',
    技能: ['急救处理', '高原病症判断', '心理安抚'],
    性格: '细心富有同情心，偶尔焦虑', 状态: '正常', 轴: [0, -1, 1, 0], 重要: false },
  { id: 'wangdapeng', 名称: '王大鹏', 年龄: 50, 职业: '退役登山教练',
    技能: ['绳索技术', '路线规划', '危机决策'],
    性格: '严厉固执，经验主义，团队领袖气质', 状态: '膝盖旧伤复发', 轴: [1, -1, 1, -1], 重要: false },
  { id: 'liweiwei', 名称: '李薇薇', 年龄: 23, 职业: '户外博主',
    技能: ['摄影', '寻找信号', '快速获取网络信息'],
    性格: '乐观活泼，耐受力差，有时脱离现实', 状态: '轻度高反，情绪波动', 轴: [1, 1, 1, 1], 重要: false },
  { id: 'zhaozhiguo', 名称: '赵志国', 年龄: 45, 职业: '护林员',
    技能: ['动植物识别', '寻找水源', '追踪与反追踪'],
    性格: '孤僻熟悉山林，不擅与人沟通', 状态: '正常，但警惕性过高', 轴: [-1, 0, -1, -1], 重要: false },
  { id: 'zhoutao', 名称: '周涛', 年龄: 36, 职业: '越野跑爱好者',
    技能: ['超强耐力', '轻装快速移动', '地形记忆'],
    性格: '独行侠风格，缺乏团队合作意识', 状态: '脚踝扭伤', 轴: [-1, 1, -1, 0], 重要: false },
  { id: 'wujiaoshou', 名称: '吴教授', 年龄: 58, 职业: '大学历史教授',
    技能: ['人文地理知识', '讲故事鼓舞士气', '逻辑分析'],
    性格: '儒雅博学，体力弱，理论多于实践', 状态: '体力严重透支，感冒', 轴: [0, -1, 1, 1], 重要: false },
  { id: 'shenbing', 名称: '沈冰', 年龄: 30, 职业: '摄影师',
    技能: ['夜间与恶劣天气拍摄', '方向感极佳'],
    性格: '为镜头冒险，冷静到近乎冷漠', 状态: '正常，但沉迷拍摄脱队', 轴: [-1, 1, -1, 1], 重要: false },
  { id: 'sunxiaojie', 名称: '孙小杰', 年龄: 19, 职业: '大学生（登山社）',
    技能: ['装备维修', '生火', '背诵大量生存理论'],
    性格: '热情主动，经验不足，易慌张', 状态: '肠胃不适，腹泻', 轴: [1, 0, 1, 1], 重要: false },
  { id: 'hanmei', 名称: '韩梅', 年龄: 38, 职业: '私企老板（徒步爱好者）',
    技能: ['资源统筹', '强说服力', '携带大量高端补给'],
    性格: '强势目标导向，控制欲强，习惯用钱解决问题', 状态: '正常，但与他人摩擦不断', 轴: [1, 1, 1, -1], 重要: false },

  { id: 'taxue', 名称: '踏雪', 年龄: 29, 职业: '护士',
    技能: ['四季穿越经验', '基础医疗'],
    性格: '自信、坚韧、执着', 状态: '幸存', 轴: [0, 1, 0, 1], 重要: true,
    事迹: '冬季独穿，失联21天后奇迹生还。因暴风雪被困，靠强大意志和少量余粮支撑，最终循救援痕迹下山。' },
  { id: 'mengshe', 名称: '猛蛇过江', 年龄: 30, 职业: '骑行/户外博主',
    技能: ['极限耐力', '冬季生存'],
    性格: '偏执、追求极限、命硬', 状态: '严重冻伤后生还', 轴: [-1, 1, -1, 1], 重要: true,
    事迹: '冬季轻装单穿，未带帐篷睡袋。64小时不眠，在零下几十度中多次出现“驴友引路”等致命幻觉，险坠悬崖，靠不停跳跃防失温，最终双脚冻伤。' },
]

// 开局抽卡只从 10 位随机配角里抽，两位重要配角在途中遭遇
export const RANDOM_POOL = NPCS.filter((n) => !n.重要).map((n) => n.id)

// 捏人时可选的性格标签，轴含义与 NPC 一致
export const PERSONALITY_TAGS = [
  { id: 'renside', 文案: '话不多，认死理', 轴: [-1, -1, 0, -1] },
  { id: 'zilaishu', 文案: '自来熟，爱张罗', 轴: [1, 0, 1, 0] },
  { id: 'jinshen', 文案: '谨慎，凡事留三分', 轴: [0, -1, 0, -1] },
  { id: 'maoxian', 文案: '爱冒险，喜欢押注', 轴: [0, 1, 0, 1] },
  { id: 'dulai', 文案: '独来独往', 轴: [-1, 0, -1, 0] },
  { id: 'jiangyiqi', 文案: '讲义气，见不得人吃亏', 轴: [1, 0, 1, 1] },
  { id: 'zhixinshuju', 文案: '只信数据和装备', 轴: [-1, 0, 0, -1] },
  { id: 'weifengjing', 文案: '为风景可以吃苦', 轴: [1, 0, 0, 1] },
]

const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]))

export function getNpc(id) {
  return NPC_BY_ID.get(id)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/npcs.test.js`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 登记进构建顺序**

`build.mjs` 的 `MODULE_ORDER` 在 `src/data/route.js` 之后加入 `'src/data/npcs.js',`。

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 7: 提交**

```bash
git add src/data/npcs.js test/npcs.test.js build.mjs
git commit -m "feat: 人物数据 10+2 与四维性格轴"
```

---

### Task 5: 装备与物资数据

> **注意 spec 修订**：spec 第 7 节把文档原表记作「20 项」，实清点为 **21 项**（漏算了一项食物）。且 spec 估的 ¥11,000 未含 GPS 与卫星电话。按本任务的实际定价，原表中档全配为 **14.1kg / ¥14,375**，加扩充 25 项后合计 **30.15kg / ¥22,005**，对上 30kg 与 ¥10,000。结论不变且更强：钱只够买约 45%，重量恰好顶到上限。执行完本任务后需回头把 spec 第 7 节的这三个数字改准。

**Files:**
- Create: `src/data/gear.js`
- Modify: `build.mjs`
- Modify: `docs/superpowers/specs/2026-08-11-aotai-html-game-design.md`（订正数字）
- Test: `test/gear.test.js`

- [ ] **Step 1: 写失败的测试**

`test/gear.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GEAR, EXTRA_GEAR, ALL_GEAR, getGear, tierOf, midTierLoadout } from '../src/data/gear.js'

test('原表 21 项，扩充 25 项', () => {
  assert.equal(GEAR.length, 21)
  assert.equal(EXTRA_GEAR.length, 25)
  assert.equal(ALL_GEAR.length, 46)
})

test('id 全局唯一', () => {
  const ids = ALL_GEAR.map((g) => g.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('每项至少一个档次，档次含名称/价格/重量', () => {
  for (const g of ALL_GEAR) {
    assert.ok(g.档次.length >= 1, `无档次: ${g.id}`)
    for (const t of g.档次) {
      assert.ok(t.档, `档名缺失: ${g.id}`)
      assert.equal(typeof t.价格, 'number', `价格非数字: ${g.id}/${t.档}`)
      assert.equal(typeof t.重量, 'number', `重量非数字: ${g.id}/${t.档}`)
      assert.ok(t.价格 >= 0 && t.重量 >= 0, `负值: ${g.id}/${t.档}`)
    }
  }
})

test('多档物品越贵越轻', () => {
  for (const g of ALL_GEAR.filter((x) => x.档次.length > 1)) {
    for (let i = 1; i < g.档次.length; i++) {
      assert.ok(g.档次[i].价格 > g.档次[i - 1].价格, `价格未递增: ${g.id}`)
      assert.ok(g.档次[i].重量 <= g.档次[i - 1].重量, `重量未递减: ${g.id}`)
    }
  }
})

test('原表七大类齐全', () => {
  const 类别 = new Set(GEAR.map((g) => g.类别))
  for (const c of ['背负系统', '睡眠系统', '炊饮系统', '穿着系统', '关键装备', '医疗用品', '食物']) {
    assert.ok(类别.has(c), `缺类别: ${c}`)
  }
})

test('中档全配落在 14kg / ¥14,375 附近', () => {
  const { 总重, 总价 } = midTierLoadout()
  assert.ok(Math.abs(总重 - 14.1) < 0.05, `总重 ${总重}`)
  assert.equal(总价, 14375)
})

test('扩充物资合计 16.05kg / ¥7,630', () => {
  const 总重 = EXTRA_GEAR.reduce((s, g) => s + g.档次[0].重量, 0)
  const 总价 = EXTRA_GEAR.reduce((s, g) => s + g.档次[0].价格, 0)
  assert.ok(Math.abs(总重 - 16.05) < 0.05, `总重 ${总重}`)
  assert.equal(总价, 7630)
})

test('两条约束同时咬人：全配超 30kg 且远超 ¥10,000', () => {
  const 重 = midTierLoadout().总重 + EXTRA_GEAR.reduce((s, g) => s + g.档次[0].重量, 0)
  const 价 = midTierLoadout().总价 + EXTRA_GEAR.reduce((s, g) => s + g.档次[0].价格, 0)
  assert.ok(重 > 30, `全配总重 ${重} 应超 30kg`)
  assert.ok(价 > 20000, `全配总价 ${价} 应远超预算`)
})

test('水袋标注为免费可变量，装满 3kg', () => {
  const 水 = getGear('water_bladder')
  assert.equal(水.可变量, true)
  assert.equal(水.档次[0].价格, 120)
  assert.equal(水.档次[0].重量, 3.0)
})

test('每日消耗品标了消耗速率', () => {
  assert.equal(getGear('staple_food').每日消耗, 2)
})

test('tierOf 按档名取档，取不到返回 undefined', () => {
  assert.equal(tierOf('backpack', '主流').价格, 2000)
  assert.equal(tierOf('backpack', '不存在的档'), undefined)
})

test('季节专属物资标了适用季节', () => {
  assert.deepEqual(getGear('crampons').季节, ['春季', '冬季'])
  assert.deepEqual(getGear('mosquito_repellent').季节, ['夏季'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/gear.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/data/gear.js`。文档给价格区间的取中值、给重量区间的按档分配（越贵越轻）：

```js
// 装备物资。GEAR 为文档原表 21 项，价格取区间中值，重量按档分配（越贵越轻）。
// EXTRA_GEAR 为设计新增的可选物资，用于让 30kg 负重上限真正成为约束（见 spec 第 7 节）。
export const GEAR = [
  { id: 'backpack', 名称: '重装徒步背包（60-70L）', 类别: '背负系统', 档次: [
    { 档: '经济', 价格: 750, 重量: 2.5 }, { 档: '主流', 价格: 2000, 重量: 2.1 }, { 档: '轻量', 价格: 3200, 重量: 1.8 }] },

  { id: 'tent', 名称: '三季帐篷（双人）', 类别: '睡眠系统', 档次: [
    { 档: '经济', 价格: 550, 重量: 3.0 }, { 档: '主流', 价格: 1500, 重量: 2.4 }, { 档: '轻量', 价格: 3000, 重量: 1.8 }] },
  { id: 'sleeping_bag', 名称: '羽绒睡袋（舒适温标-5℃至-10℃）', 类别: '睡眠系统', 温标: -10, 档次: [
    { 档: '经济', 价格: 600, 重量: 1.5 }, { 档: '主流', 价格: 1500, 重量: 1.2 }, { 档: '轻量', 价格: 2500, 重量: 1.0 }] },
  { id: 'sleeping_pad', 名称: '蛋巢/充气防潮垫（R值≥3）', 类别: '睡眠系统', 档次: [
    { 档: '经济', 价格: 150, 重量: 0.6 }, { 档: '主流', 价格: 450, 重量: 0.5 }, { 档: '轻量', 价格: 800, 重量: 0.4 }] },

  { id: 'stove', 名称: '高山气罐炉头套装', 类别: '炊饮系统', 档次: [
    { 档: '经济', 价格: 115, 重量: 0.5 }, { 档: '主流', 价格: 300, 重量: 0.4 }, { 档: '轻量', 价格: 600, 重量: 0.3 }] },
  { id: 'cookset', 名称: '钛合金套锅（1-1.5L）', 类别: '炊饮系统', 档次: [
    { 档: '经济', 价格: 150, 重量: 0.3 }, { 档: '主流', 价格: 400, 重量: 0.25 }, { 档: '轻量', 价格: 700, 重量: 0.2 }] },
  { id: 'thermos', 名称: '保温水壶（1L）', 类别: '炊饮系统', 档次: [
    { 档: '经济', 价格: 75, 重量: 0.4 }, { 档: '主流', 价格: 225, 重量: 0.3 }, { 档: '专业', 价格: 400, 重量: 0.2 }] },

  { id: 'hardshell', 名称: '硬壳冲锋衣', 类别: '穿着系统', 档次: [
    { 档: '经济', 价格: 550, 重量: 0.6 }, { 档: '主流', 价格: 1750, 重量: 0.5 }, { 档: '专业', 价格: 3000, 重量: 0.4 }] },
  { id: 'midlayer', 名称: '保暖中层（羽绒/棉服）', 类别: '穿着系统', 档次: [
    { 档: '经济', 价格: 350, 重量: 0.5 }, { 档: '主流', 价格: 1050, 重量: 0.4 }, { 档: '轻量', 价格: 2000, 重量: 0.3 }] },

  { id: 'water_filter', 名称: '户外净水器/药片', 类别: '关键装备', 档次: [
    { 档: '经济', 价格: 75, 重量: 0.3 }, { 档: '主流', 价格: 300, 重量: 0.2 }, { 档: '专业', 价格: 600, 重量: 0.1 }] },
  { id: 'headlamp', 名称: '头灯（高流明）', 类别: '关键装备', 档次: [
    { 档: '经济', 价格: 75, 重量: 0.2 }, { 档: '主流', 价格: 300, 重量: 0.15 }, { 档: '专业', 价格: 600, 重量: 0.1 }] },
  { id: 'gps', 名称: '手持GPS/卫星信标', 类别: '关键装备', 求救设备: true, 档次: [
    { 档: '专业必备', 价格: 2500, 重量: 0.25 }] },

  { id: 'first_aid', 名称: '综合医药包', 类别: '医疗用品', 档次: [
    { 档: '基础', 价格: 75, 重量: 0.6 }, { 档: '专业户外', 价格: 350, 重量: 0.3 }] },
  { id: 'emergency_blanket', 名称: '应急保温毯', 类别: '医疗用品', 档次: [
    { 档: '基础', 价格: 20, 重量: 0.05 }] },
  { id: 'ibuprofen', 名称: '布洛芬/止痛药', 类别: '医疗用品', 档次: [
    { 档: '基础', 价格: 35, 重量: 0.05 }] },
  { id: 'ors', 名称: '口服补液盐', 类别: '医疗用品', 档次: [
    { 档: '基础', 价格: 20, 重量: 0.05 }] },
  { id: 'sat_phone', 名称: '卫星电话（租用）', 类别: '关键装备', 求救设备: true, 档次: [
    { 档: '租用', 价格: 750, 重量: 0.4 }] },

  { id: 'staple_food', 名称: '高能量棒/压缩干粮', 类别: '食物', 每日消耗: 2, 档次: [
    { 档: '经济', 价格: 150, 重量: 2.5 }, { 档: '主流', 价格: 400, 重量: 2.0 }] },
  { id: 'freeze_dried', 名称: '冻干速食餐', 类别: '食物', 热食: true, 档次: [
    { 档: '主流', 价格: 300, 重量: 1.2 }, { 档: '高端', 价格: 600, 重量: 0.8 }] },
  { id: 'trail_snack', 名称: '坚果、巧克力、牛肉干（路餐）', 类别: '食物', 冷食: true, 档次: [
    { 档: '通用', 价格: 150, 重量: 1.0 }] },
  { id: 'electrolyte', 名称: '功能饮料冲剂/葡萄糖粉', 类别: '食物', 档次: [
    { 档: '通用', 价格: 75, 重量: 0.4 }] },
]

// 扩充可选物资：合计 16.05kg / ¥7,630。每项只有一档。
export const EXTRA_GEAR = [
  { id: 'extra_staple', 名称: '额外主粮 +3 天', 类别: '扩充·补给', 每日消耗: 0,
    作用: '超期不断粮', 档次: [{ 档: '通用', 价格: 180, 重量: 1.2 }] },
  { id: 'extra_freeze_dried', 名称: '额外冻干餐 ×3', 类别: '扩充·补给', 热食: true,
    作用: '热食次数，体力回复', 档次: [{ 档: '通用', 价格: 200, 重量: 0.5 }] },
  { id: 'water_bladder', 名称: '3L 水袋', 类别: '扩充·补给', 可变量: true,
    作用: '无水源路段的保险；水本身免费，可 0-4L 滑动', 档次: [{ 档: '通用', 价格: 120, 重量: 3.0 }] },
  { id: 'extra_canister', 名称: '额外气罐 ×2', 类别: '扩充·补给',
    作用: '热食与烧水次数', 档次: [{ 档: '通用', 价格: 100, 重量: 0.5 }] },

  { id: 'rope', 名称: '动力绳 20m', 类别: '扩充·技术',
    作用: '麦秸岭/飞机梁保护，绳索类选项前置', 档次: [{ 档: '通用', 价格: 450, 重量: 1.6 }] },
  { id: 'harness', 名称: '安全带 + 主锁 + 扁带', 类别: '扩充·技术',
    作用: '绳索类选项前置', 档次: [{ 档: '通用', 价格: 500, 重量: 0.9 }] },
  { id: 'ice_axe', 名称: '冰镐', 类别: '扩充·技术', 季节: ['春季', '冬季'],
    作用: '雪坡自制动', 档次: [{ 档: '通用', 价格: 400, 重量: 0.6 }] },
  { id: 'crampons', 名称: '冰爪', 类别: '扩充·技术', 季节: ['春季', '冬季'],
    作用: '春冬季必备，缺则相关选项直接置灰', 档次: [{ 档: '通用', 价格: 400, 重量: 0.6 }] },
  { id: 'gaiters', 名称: '雪套', 类别: '扩充·技术', 季节: ['春季', '冬季'],
    作用: '防雪灌鞋致失温', 档次: [{ 档: '通用', 价格: 150, 重量: 0.25 }] },

  { id: 'down_jacket', 名称: '厚羽绒服（营地）', 类别: '扩充·保暖',
    作用: '营地保暖，夜间体力回复加成', 档次: [{ 档: '通用', 价格: 900, 重量: 0.6 }] },
  { id: 'bag_liner', 名称: '睡袋内胆', 类别: '扩充·保暖', 温标加成: 5,
    作用: '睡眠温标 +5℃', 档次: [{ 档: '通用', 价格: 150, 重量: 0.3 }] },
  { id: 'spare_socks', 名称: '备用干袜与内层 ×2', 类别: '扩充·保暖',
    作用: '湿身后可换，失温抵抗', 档次: [{ 档: '通用', 价格: 180, 重量: 0.35 }] },
  { id: 'camp_shoes', 名称: '营地鞋', 类别: '扩充·保暖',
    作用: '营地舒适度，脚部伤病抵抗', 档次: [{ 档: '通用', 价格: 150, 重量: 0.4 }] },
  { id: 'camp_stool', 名称: '便携折凳', 类别: '扩充·保暖',
    作用: '休整体力回复 +2', 档次: [{ 档: '通用', 价格: 120, 重量: 0.5 }] },

  { id: 'trekking_poles', 名称: '登山杖（一对）', 类别: '扩充·行动',
    作用: '每时段体力消耗 -1', 档次: [{ 档: '通用', 价格: 300, 重量: 0.5 }] },
  { id: 'knee_brace', 名称: '护膝', 类别: '扩充·行动',
    作用: '膝伤类事件抵抗', 档次: [{ 档: '通用', 价格: 120, 重量: 0.15 }] },
  { id: 'power_bank', 名称: '充电宝 + 备用电池', 类别: '扩充·行动',
    作用: '头灯与 GPS 续航，缺则夜间行动受限', 档次: [{ 档: '通用', 价格: 180, 重量: 0.4 }] },
  { id: 'radio', 名称: '对讲机（一对）', 类别: '扩充·行动',
    作用: '队伍走散时保留信息通道', 档次: [{ 档: '通用', 价格: 300, 重量: 0.35 }] },

  { id: 'camera', 名称: '相机', 类别: '扩充·社交', 好感加成: ['liweiwei', 'shenbing'],
    作用: '李薇薇、沈冰好感加成', 档次: [{ 档: '通用', 价格: 1800, 重量: 0.75 }] },
  { id: 'tripod', 名称: '三脚架', 类别: '扩充·社交',
    作用: '夜拍与合影，社交事件加成', 档次: [{ 档: '通用', 价格: 400, 重量: 1.2 }] },
  { id: 'booze_snacks', 名称: '小酒与零食', 类别: '扩充·社交',
    作用: '营地社交，全队好感', 档次: [{ 档: '通用', 价格: 100, 重量: 0.6 }] },
  { id: 'spare_meds', 名称: '给队友的备用药品', 类别: '扩充·社交',
    作用: '触发互助剧情', 档次: [{ 档: '通用', 价格: 100, 重量: 0.25 }] },

  { id: 'pole_repair', 名称: '帐篷杆修理包', 类别: '扩充·杂项',
    作用: '装备损坏事件的唯一解', 档次: [{ 档: '通用', 价格: 80, 重量: 0.2 }] },
  { id: 'mosquito_repellent', 名称: '防蚊液', 类别: '扩充·杂项', 季节: ['夏季'],
    作用: '夏季防蚊', 档次: [{ 档: '通用', 价格: 50, 重量: 0.15 }] },
  { id: 'sun_gear', 名称: '遮阳帽 + 墨镜', 类别: '扩充·杂项', 季节: ['春季', '夏季', '冬季'],
    作用: '夏季防晒，雪季防雪盲', 档次: [{ 档: '通用', 价格: 200, 重量: 0.2 }] },
]

export const ALL_GEAR = [...GEAR, ...EXTRA_GEAR]

const GEAR_BY_ID = new Map(ALL_GEAR.map((g) => [g.id, g]))

export function getGear(id) {
  return GEAR_BY_ID.get(id)
}

export function tierOf(gearId, 档名) {
  const g = GEAR_BY_ID.get(gearId)
  if (!g) return undefined
  return g.档次.find((t) => t.档 === 档名)
}

// 原表每项各取「中档」的合计，用于校验设计目标：中档全配 14.1kg / ¥14,375。
//
// 取档规则：优先取名为「主流」的档，没有则取第二便宜的档（单档物品取唯一档）。
// 不能简单按下标取 档次[1]——freeze_dried 没有经济档，它的档次是 [主流, 高端]，
// 按下标会取到高端档，合计变成 13.7kg / ¥14,675，与设计目标对不上。
export function midTierLoadout() {
  let 总重 = 0
  let 总价 = 0
  for (const g of GEAR) {
    const t = g.档次.find((x) => x.档 === '主流') ?? g.档次[Math.min(1, g.档次.length - 1)]
    总重 += t.重量
    总价 += t.价格
  }
  return { 总重: Math.round(总重 * 100) / 100, 总价 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/gear.test.js`
Expected: PASS，12 个测试全绿。若「中档全配」两条断言失败，说明某项档次顺序或数值抄错——按报错的实际值逐项对表核对，不要改断言迁就实现。

- [ ] **Step 5: 登记进构建顺序**

`build.mjs` 的 `MODULE_ORDER` 在 `src/data/npcs.js` 之后加入 `'src/data/gear.js',`。

- [ ] **Step 6: 订正 spec 里的三个数字**

编辑 `docs/superpowers/specs/2026-08-11-aotai-html-game-design.md` 第 7 节：

- 「文档原表 7 类 20 项照搬」→ 「文档原表 7 类 **21 项**照搬」
- 「按主流档满配约 ¥11,000+」→ 「按中档满配 **14.1kg / ¥14,375**」
- 合计一行的「约 **29–32kg / ¥18,600**」→ 「**30.15kg / ¥22,005**」，并把「只买得起约 54%」改为「**约 45%**」

- [ ] **Step 7: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 8: 提交**

```bash
git add src/data/gear.js test/gear.test.js build.mjs docs/superpowers/specs/2026-08-11-aotai-html-game-design.md
git commit -m "feat: 装备数据 21 原表 + 25 扩充，订正 spec 数字"
```

---

### Task 6: 四季数据

> **待调项（评审发现，不阻塞本任务）：冬季睡袋警告目前无法消除。**
>
> 装备表里最暖的睡袋是 `sleeping_bag` 温标 −10℃，加 `bag_liner` 也只到 −15℃，而冬季夜间设定为 −25℃。换言之**玩家无论怎么买，冬季都会一直看到这条警告**。一条永远消不掉的警告会训练玩家忽略所有警告，是实打实的体验缺陷。
>
> 根子在源文档自身：它的装备表只有一款 −10℃ 睡袋，四季表却给冬季推荐「极寒睡袋（−20℃以下）」，两张表本就对不上。
>
> 建议解法是给 `EXTRA_GEAR` 加一项「极寒睡袋 −20℃」。之所以现在不加：`EXTRA_GEAR` 的 25 项、16.05kg、¥7,630 三个数字被测试钉死，还流进了 spec 第 7 节的表格与结论，中途改动波及面大。**留到首轮试玩后统一调档时处理**（spec 第 7 节末尾已写明「具体数值以实测手感为准」）。

**Files:**
- Create: `src/data/seasons.js`
- Modify: `build.mjs`
- Test: `test/seasons.test.js`

- [ ] **Step 1: 写失败的测试**

`test/seasons.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SEASONS, getSeason, rollSeason, gearWarnings } from '../src/data/seasons.js'
import { makeRng } from '../src/engine/rng.js'

test('四季齐全且字段完整', () => {
  assert.equal(SEASONS.length, 4)
  for (const s of SEASONS) {
    assert.ok(s.id && s.名称 && s.月份, `字段缺失: ${s.id}`)
    assert.ok(s.主要风险.length > 0 && s.次要风险.length > 0 && s.推荐准备.length > 0)
    assert.equal(typeof s.夜间温度, 'number')
  }
})

test('冬季最冷，夏季最暖', () => {
  const 最冷 = SEASONS.reduce((a, b) => (a.夜间温度 < b.夜间温度 ? a : b))
  const 最暖 = SEASONS.reduce((a, b) => (a.夜间温度 > b.夜间温度 ? a : b))
  assert.equal(最冷.id, '冬季')
  assert.equal(最暖.id, '夏季')
})

test('rollSeason 同种子结果一致，且四季都能抽到', () => {
  assert.equal(rollSeason(makeRng(42)), rollSeason(makeRng(42)))
  const 抽到 = new Set()
  for (let i = 0; i < 400; i++) 抽到.add(rollSeason(makeRng(i)))
  assert.equal(抽到.size, 4)
})

test('冬季缺冰爪会报警告', () => {
  const w = gearWarnings('冬季', [])
  assert.ok(w.some((x) => x.includes('冰爪')))
})

test('冬季带齐了就不报那条警告', () => {
  const w = gearWarnings('冬季', ['crampons', 'ice_axe', 'gaiters'])
  assert.ok(!w.some((x) => x.includes('冰爪')))
})

test('夏季不因为缺冰爪报警告', () => {
  const w = gearWarnings('夏季', [])
  assert.ok(!w.some((x) => x.includes('冰爪')))
})

test('任何季节缺求救设备都报警告', () => {
  for (const s of ['春季', '夏季', '秋季', '冬季']) {
    assert.ok(gearWarnings(s, []).some((x) => x.includes('求救')), `${s} 未报求救警告`)
  }
  assert.ok(!gearWarnings('夏季', ['gps']).some((x) => x.includes('求救')))
})

test('睡袋温标不足会报警告', () => {
  assert.ok(gearWarnings('冬季', ['sleeping_bag']).some((x) => x.includes('温标')))
  assert.ok(!gearWarnings('夏季', ['sleeping_bag']).some((x) => x.includes('温标')))
})

test('睡袋温标从 gear.js 读取，不是硬编码', () => {
  // 冬季夜间 -25℃：睡袋 -10℃ 不够，加内胆后 -15℃ 仍不够，
  // 但警告文案里的数字必须随 gear.js 的数据变化，否则说明被写死了
  const 无内胆 = gearWarnings('冬季', ['sleeping_bag']).find((x) => x.includes('温标'))
  const 有内胆 = gearWarnings('冬季', ['sleeping_bag', 'bag_liner']).find((x) => x.includes('温标'))
  assert.ok(无内胆.includes('-10℃'), `无内胆文案: ${无内胆}`)
  assert.ok(有内胆.includes('-15℃'), `有内胆文案: ${有内胆}`)
})

test('getSeason 取不到返回 undefined', () => {
  assert.equal(getSeason('雨季'), undefined)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/seasons.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/data/seasons.js`。风险与推荐准备逐条照搬文档「四季穿越鳌太线风险对比」表：

```js
import { getGear } from './gear.js'

// 四季风险。主要风险/次要风险/推荐准备逐条照搬文档表格。
// 夜间温度为设计新增，用于判断睡袋温标是否够用。
export const SEASONS = [
  { id: '春季', 名称: '春季', 月份: '3–5月', 夜间温度: -8,
    主要风险: ['雪崩', '冰雪未融', '路面湿滑', '天气骤变（雨转雪）'],
    次要风险: ['能见度低', '水源冰冷', '野生动物活动频繁'],
    推荐准备: ['防滑冰爪', '雪套', '防风防水外层', '高热量食物', '卫星通讯设备'] },
  { id: '夏季', 名称: '夏季', 月份: '6–8月', 夜间温度: 5,
    主要风险: ['雷暴', '暴雨', '山洪', '滑坡', '蚊虫叮咬', '中暑'],
    次要风险: ['午后浓雾', '路径被植被覆盖', '水源污染风险'],
    推荐准备: ['防雨装备', '防蚊液', '遮阳帽', '净水设备', '雷电预警知识'] },
  { id: '秋季', 名称: '秋季', 月份: '9–11月', 夜间温度: -6,
    主要风险: ['大风', '霜冻', '昼夜温差极大（可达20℃以上）', '易失温'],
    次要风险: ['能见度降低（雾、霜）', '营地结冰', '部分水源干涸'],
    推荐准备: ['保暖睡袋（-10℃以下）', '防风帐篷', '保温水壶', '多层穿着系统', '早出发早扎营'] },
  { id: '冬季', 名称: '冬季', 月份: '12–2月', 夜间温度: -25,
    主要风险: ['极寒（-20℃至-30℃）', '暴风雪', '白化天', '冻伤', '失温', '路径完全被雪覆盖', '易迷路'],
    次要风险: ['日照时间短', '装备结冰', '呼吸结冰', '心理压力大'],
    推荐准备: ['极寒睡袋（-20℃以下）', '羽绒服+硬壳', '雪镜', '防冻液', '卫星电话', '团队协作绝不独行'] },
]

const SEASON_BY_ID = new Map(SEASONS.map((s) => [s.id, s]))

export function getSeason(id) {
  return SEASON_BY_ID.get(id)
}

export function rollSeason(rng) {
  return SEASONS[Math.floor(rng() * SEASONS.length)].id
}

// 采购界面的季节警告。ownedIds 为已选物资 id 数组。
export function gearWarnings(seasonId, ownedIds) {
  const season = SEASON_BY_ID.get(seasonId)
  if (!season) return []
  const owned = new Set(ownedIds)
  const 警告 = []

  if (!owned.has('gps') && !owned.has('sat_phone')) {
    警告.push('未携带任何求救设备（GPS信标或卫星电话）——失联后无法主动求救。')
  }

  if (seasonId === '春季' || seasonId === '冬季') {
    if (!owned.has('crampons')) 警告.push(`${season.名称}路面积雪结冰，未带冰爪，雪坡路段将无法通过。`)
    if (!owned.has('gaiters')) 警告.push(`${season.名称}雪深，未带雪套，雪灌进鞋里极易失温。`)
  }

  if (seasonId === '夏季' && !owned.has('mosquito_repellent')) {
    警告.push('夏季蚊虫叮咬频繁，未带防蚊液。')
  }

  // 温标一律从 gear.js 读，不在这里硬编码——否则改了装备表，警告还按老值算，
  // 而且没有任何测试会报错。温标越低越保暖；内胆的「温标加成」是保暖增量，
  // 所以从睡袋温标里再减去它。
  const 睡袋 = owned.has('sleeping_bag') ? getGear('sleeping_bag') : undefined
  if (!睡袋) {
    // 压根没带睡袋。只买内胆不买睡袋也走这条——内胆不能单独用。
    if (season.夜间温度 < 0) {
      警告.push(`${season.名称}夜间约 ${season.夜间温度}℃，没带睡袋，夜里根本扛不住。`)
    }
  } else {
    const 加成 = owned.has('bag_liner') ? (getGear('bag_liner')?.温标加成 ?? 0) : 0
    const 实际温标 = 睡袋.温标 - 加成
    if (season.夜间温度 < 实际温标) {
      警告.push(`${season.名称}夜间约 ${season.夜间温度}℃，睡袋温标 ${实际温标}℃ 不够用，夜里会冷醒甚至失温。`)
    }
  }

  return 警告
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/seasons.test.js`
Expected: PASS，13 个测试全绿

- [ ] **Step 5: 登记进构建顺序**

`build.mjs` 的 `MODULE_ORDER` 在 `src/data/gear.js` 之后加入 `'src/data/seasons.js',`。注意 `seasons.js` 不依赖 `rng.js`（`rollSeason` 接收 rng 作参数），顺序无所谓，但保持数据模块聚在一起。

- [ ] **Step 6: 跑全量测试**

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 7: 提交**

```bash
git add src/data/seasons.js test/seasons.test.js build.mjs
git commit -m "feat: 四季风险数据与采购警告"
```

---

## 阶段三 · 引擎

### Task 7: 权威状态

**Files:**
- Create: `src/engine/state.js`
- Modify: `build.mjs`
- Test: `test/state.test.js`

- [ ] **Step 1: 写失败的测试**

`test/state.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState, recalcCarry, addItem, removeItem,
  consumeItem, hasItem, snapshot, restore, STATE_VERSION,
} from '../src/engine/state.js'

function 基础状态() {
  return createInitialState({
    种子: 42,
    季节: '秋季',
    pc: { 名字: '周野', 职业: '户外器材工程师', 年龄: 28, 性别: '男',
          性格: 'renside', 外貌: '偏瘦，晒得黑', 技能: ['装备维修'], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 30 }, { npcId: 'linxiaoya', 好感: 28 }],
    背包: [{ gearId: 'backpack', 档: '主流', 数量: 1 }, { gearId: 'staple_food', 档: '主流', 数量: 1 }],
    金钱: 4320,
  })
}

test('初始状态字段齐备', () => {
  const s = 基础状态()
  assert.equal(s.meta.版本, STATE_VERSION)
  assert.equal(s.meta.季节, '秋季')
  assert.equal(s.meta.随机种子, 42)
  assert.equal(s.phase, '徒步')
  assert.deepEqual(s.clock, { day: 1, slot: '早' })
  assert.equal(s.place.nodeId, 'tangkou')
  assert.equal(s.place.海拔, 1700)
  assert.equal(s.pc.体力, 100)
  assert.equal(s.money, 4320)
  assert.equal(s.carry.上限, 30)
  assert.equal(s.party.length, 2)
  assert.equal(s.flags.已求救, false)
  assert.equal(s.flags.高海拔过夜数, 0)
  assert.equal(s.flags.失温连败, 0, '结局判定要读这个计数器，初始化时不能漏')
})

test('背包条目补齐单重，负重按单重×数量算', () => {
  const s = 基础状态()
  const 包 = s.pack.find((p) => p.gearId === 'backpack')
  assert.equal(包.单重, 2.1)
  // 背包 2.1 + 主流干粮 2.0 = 4.1
  assert.equal(s.carry.当前, 4.1)
})

test('addItem 累加数量并重算负重', () => {
  const s = 基础状态()
  addItem(s, 'ibuprofen', '基础', 1)
  assert.equal(s.carry.当前, 4.15)
  addItem(s, 'ibuprofen', '基础', 2)
  assert.equal(s.pack.find((p) => p.gearId === 'ibuprofen').数量, 3)
  assert.equal(s.carry.当前, 4.25)
})

test('removeItem 扣到 0 就摘出背包', () => {
  const s = 基础状态()
  removeItem(s, 'staple_food', 1)
  assert.equal(hasItem(s, 'staple_food'), false)
  assert.equal(s.carry.当前, 2.1)
})

test('removeItem 扣不出负数', () => {
  const s = 基础状态()
  removeItem(s, 'staple_food', 99)
  assert.equal(hasItem(s, 'staple_food'), false)
})

test('removeItem 对不存在的物品是安全的空操作', () => {
  const s = 基础状态()
  const 原重 = s.carry.当前
  removeItem(s, '查无此物', 1)
  assert.equal(s.carry.当前, 原重)
})

test('consumeItem 按余量百分比消耗，归零后摘出', () => {
  const s = 基础状态()
  addItem(s, 'stove', '主流', 1)
  assert.equal(consumeItem(s, 'stove', 8), true)
  assert.equal(s.pack.find((p) => p.gearId === 'stove').余量, 92)
  for (let i = 0; i < 12; i++) consumeItem(s, 'stove', 8)
  assert.equal(hasItem(s, 'stove'), false)
})

test('consumeItem 对没有的物品返回 false', () => {
  const s = 基础状态()
  assert.equal(consumeItem(s, 'stove', 8), false)
})

test('快照与回滚是深拷贝，互不影响', () => {
  const s = 基础状态()
  const snap = snapshot(s)
  s.pc.体力 = 12
  s.party[0].好感 = 99
  s.pack.push({ gearId: 'rope', 档: '通用', 数量: 1, 单重: 1.6 })

  const 回滚 = restore(snap)
  assert.equal(回滚.pc.体力, 100)
  assert.equal(回滚.party[0].好感, 30)
  assert.equal(回滚.pack.length, 2)
  // 回滚出来的对象再改，不该动到 snap
  回滚.pc.体力 = 1
  assert.equal(restore(snap).pc.体力, 100)
})

test('recalcCarry 幂等', () => {
  const s = 基础状态()
  recalcCarry(s)
  recalcCarry(s)
  assert.equal(s.carry.当前, 4.1)
})

test('负重保留一位小数，不出浮点毛刺', () => {
  const s = 基础状态()
  addItem(s, 'emergency_blanket', '基础', 3)
  assert.equal(s.carry.当前, 4.25)
  assert.ok(String(s.carry.当前).length <= 5, `浮点毛刺: ${s.carry.当前}`)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/state.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/engine/state.js`：

```js
import { getNode } from '../data/route.js'
import { tierOf } from '../data/gear.js'

export const STATE_VERSION = 1

// 唯一权威状态。LLM 永远碰不到这个对象，只能提议；提议经 llm/validate.js 校验后由引擎应用。
export function createInitialState(opts) {
  const state = {
    meta: { 版本: STATE_VERSION, 季节: opts.季节, 随机种子: opts.种子 },
    phase: '徒步',
    clock: { day: 1, slot: '早' },
    place: { nodeId: opts.起点 || 'tangkou', 海拔: 0 },
    weather: { 状态: '晴', 等级: 1 },
    pc: {
      名字: opts.pc.名字, 职业: opts.pc.职业, 年龄: opts.pc.年龄,
      性别: opts.pc.性别, 性格: opts.pc.性格, 外貌: opts.pc.外貌,
      技能: [...opts.pc.技能], 户外经验: opts.pc.户外经验,
      体力: 100, 伤病: [],
    },
    money: opts.金钱,
    pack: [],
    carry: { 当前: 0, 上限: 30 },
    party: opts.队友.map((t) => ({ npcId: t.npcId, 好感: t.好感, 状态: '正常', 在队: true })),
    flags: { 已求救: false, 已下撤: false, 高海拔过夜数: 0, 失温连败: 0, 触发过的事件id: [] },
  }

  const 起点节点 = getNode(state.place.nodeId)
  if (!起点节点) throw new Error(`createInitialState: 起点不是合法节点 id：${state.place.nodeId}`)
  state.place.海拔 = 起点节点.海拔

  for (const item of opts.背包 || []) {
    addItem(state, item.gearId, item.档, item.数量)
  }

  return state
}

// 负重 = Σ(单重 × 数量)。气罐一类的余量不影响重量（罐体本身就那么重）。
export function recalcCarry(state) {
  const 合计 = state.pack.reduce((s, p) => s + p.单重 * p.数量, 0)
  state.carry.当前 = Math.round(合计 * 100) / 100
}

export function addItem(state, gearId, 档, 数量 = 1) {
  const tier = tierOf(gearId, 档)
  if (!tier) return false
  const 已有 = state.pack.find((p) => p.gearId === gearId)
  if (已有) {
    // 换档要同步替换整摞的档次与单重。只加数量不改单重的话，负重会按旧档
    // 算出错值且无人察觉——而「数值不飘」正是这整套架构存在的理由。
    已有.数量 += 数量
    已有.档 = 档
    已有.单重 = tier.重量
  } else {
    state.pack.push({ gearId, 档, 数量, 单重: tier.重量, 余量: 100 })
  }
  recalcCarry(state)
  return true
}

export function removeItem(state, gearId, 数量 = 1) {
  const i = state.pack.findIndex((p) => p.gearId === gearId)
  if (i === -1) return false
  state.pack[i].数量 -= 数量
  if (state.pack[i].数量 <= 0) state.pack.splice(i, 1)
  recalcCarry(state)
  return true
}

// 按百分比消耗（气罐、净水药片这类）。归零则摘出背包。
export function consumeItem(state, gearId, 百分比) {
  const item = state.pack.find((p) => p.gearId === gearId)
  if (!item) return false
  item.余量 -= 百分比
  if (item.余量 <= 0) removeItem(state, gearId, item.数量)
  return true
}

export function hasItem(state, gearId) {
  return state.pack.some((p) => p.gearId === gearId)
}

// 每回合开始前打快照，LLM 结算出错时整体回滚——绝不留半应用的脏状态。
export function snapshot(state) {
  return JSON.stringify(state)
}

export function restore(snap) {
  return JSON.parse(snap)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/state.test.js`
Expected: PASS，13 个测试全绿

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 在 `src/data/seasons.js` 之后、`src/engine/rng.js` 之前插入 `'src/engine/state.js',`（它依赖 route 与 gear，两者已在前）。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/engine/state.js test/state.test.js build.mjs
git commit -m "feat: 权威状态模型与快照回滚"
```

---

### Task 8: 门槛判定与掷骰

**Files:**
- Create: `src/engine/threshold.js`
- Modify: `build.mjs`
- Test: `test/threshold.test.js`

判定规则（spec 第 6 节）：差距 `d ≤ 0` 必成；`1 ≤ d ≤ 10` 掷骰，`P = 0.9 − 0.07 × (d − 1)`；`d > 10` 必败且置灰。体力 < 20 时最终差距额外 `+10`。多条门槛不满足时取**最大差距**。缺物品直接判为不可达。

- [ ] **Step 1: 写失败的测试**

`test/threshold.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { successChance, gapFor, judgeOption, UNREACHABLE } from '../src/engine/threshold.js'
import { makeRng } from '../src/engine/rng.js'

function 状态(over = {}) {
  return {
    pc: { 户外经验: 38, 体力: 50 },
    party: [{ npcId: 'linxiaoya', 好感: 62, 在队: true }, { npcId: 'chenyan', 好感: 45, 在队: true }],
    pack: [{ gearId: 'rope', 数量: 1 }],
    ...over,
  }
}

test('成功率：达标 100%，d=1 九成，d=10 两成七，d>10 归零', () => {
  assert.equal(successChance(0), 1)
  assert.equal(successChance(-5), 1)
  assert.ok(Math.abs(successChance(1) - 0.9) < 1e-9)
  assert.ok(Math.abs(successChance(10) - 0.27) < 1e-9)
  assert.equal(successChance(11), 0)
  assert.equal(successChance(999), 0)
})

test('门槛全达标时差距为 0', () => {
  const { gap } = gapFor({ 经验: 30, 体力: 40, 好感: { linxiaoya: 60 } }, 状态())
  assert.equal(gap, 0)
})

test('经验不足按差值算，理由写明缺口', () => {
  const { gap, reasons } = gapFor({ 经验: 60 }, 状态())
  assert.equal(gap, 22)
  assert.ok(reasons[0].includes('户外经验'))
  assert.ok(reasons[0].includes('22'))
})

test('多条不满足取最大差距', () => {
  const { gap } = gapFor({ 经验: 45, 体力: 70 }, 状态())
  // 经验差 7，体力差 20 → 取 20
  assert.equal(gap, 20)
})

test('好感按 npcId 比对，不在队的人视为不可达', () => {
  assert.equal(gapFor({ 好感: { linxiaoya: 70 } }, 状态()).gap, 8)
  assert.equal(gapFor({ 好感: { wangdapeng: 30 } }, 状态()).gap, UNREACHABLE)
})

test('缺物品直接不可达', () => {
  assert.equal(gapFor({ 物品: ['rope'] }, 状态()).gap, 0)
  assert.equal(gapFor({ 物品: ['crampons'] }, 状态()).gap, UNREACHABLE)
})

test('体力低于 20 时全局追加 10 点差距', () => {
  const 虚弱 = 状态({ pc: { 户外经验: 38, 体力: 15 } })
  assert.equal(gapFor({ 经验: 30 }, 虚弱).gap, 10)
  assert.equal(gapFor({ 经验: 45 }, 虚弱).gap, 17)
})

test('体力正好 20 不触发惩罚', () => {
  const s = 状态({ pc: { 户外经验: 38, 体力: 20 } })
  assert.equal(gapFor({ 经验: 30 }, s).gap, 0)
})

test('空门槛视为无条件通过', () => {
  assert.equal(gapFor({}, 状态()).gap, 0)
  assert.equal(gapFor(undefined, 状态()).gap, 0)
})

test('judgeOption：达标必成，不掷骰', () => {
  const r = judgeOption({ require: { 经验: 30 } }, 状态(), makeRng(1))
  assert.equal(r.outcome, 'success')
  assert.equal(r.gap, 0)
  assert.equal(r.chance, 1)
  assert.equal(r.roll, null)
})

test('judgeOption：差距过大必败且标记不可选', () => {
  const r = judgeOption({ require: { 经验: 60 } }, 状态(), makeRng(1))
  assert.equal(r.outcome, 'fail')
  assert.equal(r.selectable, false)
  assert.equal(r.chance, 0)
})

test('judgeOption：边缘档会掷骰，且同种子可复现', () => {
  const opt = { require: { 经验: 43 } } // 差 5 → 0.62
  const a = judgeOption(opt, 状态(), makeRng(7))
  const b = judgeOption(opt, 状态(), makeRng(7))
  assert.equal(a.outcome, b.outcome)
  assert.equal(a.roll, b.roll)
  assert.ok(Math.abs(a.chance - 0.62) < 1e-9)
  assert.equal(a.selectable, true)
})

test('边缘档长期成功率贴近标称概率', () => {
  const opt = { require: { 经验: 43 } } // 0.62
  let 成功 = 0
  for (let i = 0; i < 4000; i++) {
    if (judgeOption(opt, 状态(), makeRng(i)).outcome === 'success') 成功++
  }
  const 实测 = 成功 / 4000
  assert.ok(Math.abs(实测 - 0.62) < 0.03, `实测 ${实测}`)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/threshold.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/engine/threshold.js`：

```js
// 差距超过 10 即不可达。用一个远大于 10 的哨兵值表示「结构性缺失」（缺物品、人不在队）。
export const UNREACHABLE = 999

const 体力惩罚阈值 = 20
const 体力惩罚差距 = 10

export function successChance(gap) {
  if (gap <= 0) return 1
  if (gap > 10) return 0
  return 0.9 - 0.07 * (gap - 1)
}

// 算出「离达标还差多少」。多条门槛取最大差距——最短板决定成败。
export function gapFor(require, state) {
  const 未达 = []
  let gap = 0
  const bump = (d, why) => {
    if (d > 0) {
      未达.push({ d, why })
      if (d > gap) gap = d
    }
  }

  if (require) {
    if (typeof require.经验 === 'number') {
      const d = require.经验 - state.pc.户外经验
      bump(d, `户外经验 ${state.pc.户外经验}，需 ${require.经验}，差 ${d}`)
    }
    if (typeof require.体力 === 'number') {
      const d = require.体力 - state.pc.体力
      bump(d, `体力 ${state.pc.体力}，需 ${require.体力}，差 ${d}`)
    }
    for (const [npcId, 需要] of Object.entries(require.好感 || {})) {
      const 同伴 = state.party.find((p) => p.npcId === npcId && p.在队)
      if (!同伴) {
        bump(UNREACHABLE, `${npcId} 不在队`)
        continue
      }
      const d = 需要 - 同伴.好感
      bump(d, `${npcId} 好感 ${同伴.好感}，需 ${需要}，差 ${d}`)
    }
    for (const gearId of require.物品 || []) {
      if (!state.pack.some((p) => p.gearId === gearId)) {
        bump(UNREACHABLE, `缺少 ${gearId}`)
      }
    }
  }

  // 体力见底时百事艰难：所有判定统一加码，不区分门槛类型。
  if (gap < UNREACHABLE && state.pc.体力 < 体力惩罚阈值) {
    gap += 体力惩罚差距
    未达.push({ d: 体力惩罚差距, why: `体力 ${state.pc.体力} 低于 ${体力惩罚阈值}，判定额外加 ${体力惩罚差距} 点难度` })
  }

  // 数值门槛可能报得离谱（LLM 写了个「需经验 5000」），算出的差距会远超哨兵值。
  // 一律收敛到 UNREACHABLE，否则下游用 gap === UNREACHABLE 判结构性不可达时会漏掉。
  if (gap > UNREACHABLE) gap = UNREACHABLE

  // 按差距从大到小排：reasons[0] 恒为真正卡住玩家的那一条。
  // 「玩家能看懂自己为什么失败」是这套判定存在的前提，UI 要显示的就是它。
  未达.sort((a, b) => b.d - a.d)

  return { gap, reasons: 未达.map((r) => r.why) }
}

// 判定在调用 LLM 之前完成。返回值直接决定要告诉 LLM 的「既成事实」。
export function judgeOption(option, state, rng) {
  const { gap, reasons } = gapFor(option.require, state)
  const chance = successChance(gap)

  if (chance >= 1) {
    return { outcome: 'success', gap, chance: 1, roll: null, selectable: true, reasons }
  }
  if (chance <= 0) {
    return { outcome: 'fail', gap, chance: 0, roll: null, selectable: false, reasons }
  }

  const roll = rng()
  return {
    outcome: roll < chance ? 'success' : 'fail',
    gap, chance, roll, selectable: true, reasons,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/threshold.test.js`
Expected: PASS，15 个测试全绿。最后一条统计测试若偶发失败，检查 `judgeOption` 是否对每次调用都新建了 rng——测试里是故意每轮换种子的。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/engine/threshold.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/engine/threshold.js test/threshold.test.js build.mjs
git commit -m "feat: 门槛差距计算与边缘掷骰判定"
```

---

### Task 9: 消耗、回复与高山适应

> **来自 T5 评审的预警**：`gear.js` 里 `staple_food` 标了 `每日消耗: 2`，而 `extra_staple`（额外主粮 +3 天）标的是 `每日消耗: 0`。这个 `0` 是有意的——额外主粮是**缓冲池**，不自己产生每日扣减，而是在主粮见底时顶上。
>
> **来自 T7 评审的第二条预警：`余量` 是整摞共享的百分比，不是每件独立的。**
>
> `state.js` 的 `pack` 条目里，`余量` 只有一个值，而 `数量` 可以大于 1。实测：带 2 个 `stove`，`consumeItem(s,'stove',50)` 两次就把**两个一起**清空——也就是说带 2 个和带 1 个能用的次数完全一样，买备用等于白买。
>
> 燃料的正确模型是分两层：`stove` 自带罐的 `余量` 先烧完，再去动 `extra_canister`（那是独立的 gearId，不是 `stove` 的数量叠加）。**Task 9 必须显式实现「当前罐烧完后启用下一罐」，并为「带 2 罐比带 1 罐能多做几顿热食」写一个测试。** 若沿用当前的共享百分比模型，这条测试会直接失败。

> 实现时必须区分「字段为 0」与「字段不存在」：按 `if (g.每日消耗)` 判断时 `0` 会和 `undefined` 一样被跳过，行为恰好正确；但按 `if ('每日消耗' in g)` 判断，`extra_staple` 会被当成每日消耗品扣 0，虽不出错却会混进消耗清单误导玩家。**明确用数值判断，并为「主粮耗尽后自动启用额外主粮」写一个测试。**

**Files:**
- Create: `src/engine/consume.js`
- Modify: `build.mjs`
- Test: `test/consume.test.js`

规则（spec 第 6 节 + 本计划确定的适应定义）：

- 时段体力消耗 = `floor(6 × 1.04^max(0, 负重−15))`，带登山杖再 `−1`
- 海拔 > 3400 且**未适应**额外 `−2`。**适应 = 在海拔 ≥3000 的营地过夜累计 ≥1 晚**
- 回复：休整 +8（带折凳 +10）、热食 +6、冷食 +3、睡眠 +25（无营地或恶劣天气减半）
- 体力夹取 0–100；每天主粮 −2；热食一次气罐 −8%

- [ ] **Step 1: 写失败的测试**

`test/consume.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stepStaminaCost, applyStepCost, isAcclimatized,
  rest, eatHot, eatCold, sleep, advanceSlot, dailyUpkeep,
} from '../src/engine/consume.js'
import { createInitialState } from '../src/engine/state.js'

function 状态(over = {}) {
  const s = createInitialState({
    种子: 1, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [], 金钱: 5000,
    背包: [{ gearId: 'staple_food', 档: '主流', 数量: 4 }],
  })
  Object.assign(s.pc, over.pc || {})
  if (over.负重 !== undefined) s.carry.当前 = over.负重
  if (over.海拔 !== undefined) s.place.海拔 = over.海拔
  if (over.高海拔过夜数 !== undefined) s.flags.高海拔过夜数 = over.高海拔过夜数
  return s
}

test('负重不超基准线时消耗基础值 6', () => {
  assert.equal(stepStaminaCost(状态({ 负重: 15, 海拔: 3000 })), 6)
  assert.equal(stepStaminaCost(状态({ 负重: 10, 海拔: 3000 })), 6)
})

test('spec 里的样例：负重 26.8kg、已适应的 3500m，消耗 9', () => {
  const s = 状态({ 负重: 26.8, 海拔: 3500, 高海拔过夜数: 2 })
  assert.equal(stepStaminaCost(s), 9)
})

test('未适应时高海拔额外扣 2', () => {
  const s = 状态({ 负重: 26.8, 海拔: 3500, 高海拔过夜数: 0 })
  assert.equal(stepStaminaCost(s), 11)
})

test('3400 米以下不吃高海拔惩罚', () => {
  const s = 状态({ 负重: 15, 海拔: 3400, 高海拔过夜数: 0 })
  assert.equal(stepStaminaCost(s), 6)
})

test('登山杖减免 1 点', () => {
  const s = 状态({ 负重: 26.8, 海拔: 3500, 高海拔过夜数: 2 })
  s.pack.push({ gearId: 'trekking_poles', 档: '通用', 数量: 1, 单重: 0.5, 余量: 100 })
  assert.equal(stepStaminaCost(s), 8)
})

test('消耗至少为 1，不会被减到 0 或负数', () => {
  const s = 状态({ 负重: 0, 海拔: 1700 })
  s.pack.push({ gearId: 'trekking_poles', 档: '通用', 数量: 1, 单重: 0.5, 余量: 100 })
  assert.ok(stepStaminaCost(s) >= 1)
})

test('适应判定：高海拔过夜满 1 晚即适应', () => {
  assert.equal(isAcclimatized(状态({ 高海拔过夜数: 0 })), false)
  assert.equal(isAcclimatized(状态({ 高海拔过夜数: 1 })), true)
})

test('applyStepCost 扣体力且不低于 0', () => {
  const s = 状态({ pc: { 体力: 5 }, 负重: 26.8, 海拔: 3500, 高海拔过夜数: 2 })
  applyStepCost(s)
  assert.equal(s.pc.体力, 0)
})

test('休整 +8，带折凳 +10，上限 100', () => {
  const s = 状态({ pc: { 体力: 50 } })
  rest(s)
  assert.equal(s.pc.体力, 58)

  s.pack.push({ gearId: 'camp_stool', 档: '通用', 数量: 1, 单重: 0.5, 余量: 100 })
  s.pc.体力 = 50
  rest(s)
  assert.equal(s.pc.体力, 60)

  s.pc.体力 = 96
  rest(s)
  assert.equal(s.pc.体力, 100)
})

test('热食 +6 并消耗气罐 8% 与一份冻干', () => {
  const s = 状态({ pc: { 体力: 50 } })
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 2, 单重: 1.2, 余量: 100 })

  assert.equal(eatHot(s), true)
  assert.equal(s.pc.体力, 56)
  assert.equal(s.pack.find((p) => p.gearId === 'stove').余量, 92)
  assert.equal(s.pack.find((p) => p.gearId === 'freeze_dried').数量, 1)
})

test('没炉头或没冻干就吃不了热食', () => {
  const s = 状态({ pc: { 体力: 50 } })
  assert.equal(eatHot(s), false)
  assert.equal(s.pc.体力, 50)
})

test('冷食 +3 并消耗一份路餐', () => {
  const s = 状态({ pc: { 体力: 50 } })
  s.pack.push({ gearId: 'trail_snack', 档: '通用', 数量: 1, 单重: 1.0, 余量: 100 })
  assert.equal(eatCold(s), true)
  assert.equal(s.pc.体力, 53)
  assert.equal(s.pack.some((p) => p.gearId === 'trail_snack'), false)
})

test('睡眠：有帐篷睡袋且在营地 +25', () => {
  const s = 状态({ pc: { 体力: 50 }, 海拔: 3100 })
  s.place.nodeId = 'shuiwozi'
  s.pack.push({ gearId: 'tent', 档: '主流', 数量: 1, 单重: 2.4, 余量: 100 })
  s.pack.push({ gearId: 'sleeping_bag', 档: '主流', 数量: 1, 单重: 1.2, 余量: 100 })
  sleep(s, { 恶劣天气: false })
  assert.equal(s.pc.体力, 75)
})

test('睡眠：缺装备或恶劣天气减半', () => {
  const s = 状态({ pc: { 体力: 50 }, 海拔: 3100 })
  s.place.nodeId = 'shuiwozi'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.pc.体力, 62)
})

test('在 3000 米以上营地过夜会累计适应晚数', () => {
  const s = 状态({ 海拔: 3100 })
  s.place.nodeId = 'shuiwozi'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.高海拔过夜数, 1)
})

test('在低海拔过夜不累计适应', () => {
  const s = 状态({ 海拔: 1700 })
  s.place.nodeId = 'tangkou'
  sleep(s, { 恶劣天气: false })
  assert.equal(s.flags.高海拔过夜数, 0)
})

test('时段推进：早→中→晚→次日早', () => {
  const s = 状态()
  assert.deepEqual(advanceSlot(s).clock, { day: 1, slot: '中' })
  assert.deepEqual(advanceSlot(s).clock, { day: 1, slot: '晚' })
  assert.deepEqual(advanceSlot(s).clock, { day: 2, slot: '早' })
})

test('气罐烧完换备用罐，炉头不会跟着丢掉', () => {
  const s = 状态({ pc: { 体力: 0 } })
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 60, 单重: 1.2, 余量: 100 })

  let 顿数 = 0
  while (eatHot(s)) 顿数++
  assert.equal(顿数, 12, `一罐 8%/顿应做 12 顿，实为 ${顿数}`)
  assert.ok(s.pack.some((p) => p.gearId === 'stove'), '没气了也不该把炉头丢掉')
})

test('带备用气罐能多做热食——买备用不是白买', () => {
  const s = 状态({ pc: { 体力: 0 } })
  s.pack.push({ gearId: 'stove', 档: '主流', 数量: 1, 单重: 0.4, 余量: 100 })
  s.pack.push({ gearId: 'extra_canister', 档: '通用', 数量: 2, 单重: 0.5, 余量: 100 })
  s.pack.push({ gearId: 'freeze_dried', 档: '主流', 数量: 60, 单重: 1.2, 余量: 100 })

  let 顿数 = 0
  while (eatHot(s)) 顿数++
  assert.equal(顿数, 36, `自带罐 + 2 备用罐应做 36 顿，实为 ${顿数}`)
  assert.ok(!s.pack.some((p) => p.gearId === 'extra_canister'), '备用罐应已用尽')
})

test('主粮耗尽后自动启用额外主粮', () => {
  const s = 状态()
  s.pack.find((p) => p.gearId === 'staple_food').数量 = 3
  s.pack.push({ gearId: 'extra_staple', 档: '通用', 数量: 4, 单重: 1.2, 余量: 100 })

  assert.deepEqual(dailyUpkeep(s), { 断粮: false, 欠缺: 0 })
  assert.equal(s.pack.find((p) => p.gearId === 'staple_food').数量, 1)

  // 主粮只剩 1 份，缺口由额外主粮补上
  dailyUpkeep(s)
  assert.ok(!s.pack.some((p) => p.gearId === 'staple_food'), '主粮应已耗尽')
  assert.equal(s.pack.find((p) => p.gearId === 'extra_staple').数量, 3)

  dailyUpkeep(s)
  assert.equal(s.pack.find((p) => p.gearId === 'extra_staple').数量, 1)

  const 最后 = dailyUpkeep(s)
  assert.equal(最后.断粮, true)
  assert.equal(最后.欠缺, 1, '最后一天只吃到 1 份')
})

test('每日结算扣 2 份主粮，不足则扣到 0', () => {
  const s = 状态()
  dailyUpkeep(s)
  assert.equal(s.pack.find((p) => p.gearId === 'staple_food').数量, 2)
  dailyUpkeep(s)
  assert.equal(s.pack.some((p) => p.gearId === 'staple_food'), false)
  assert.equal(dailyUpkeep(s).断粮, true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/consume.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/engine/consume.js`：

```js
import { getNode } from '../data/route.js'
import { removeItem, hasItem } from './state.js'

const 基础时段消耗 = 6
const 负重基准线 = 15
const 高海拔线 = 3400
const 适应海拔线 = 3000
const 需要适应晚数 = 1
const 每次热食耗气 = 8
const 每日主粮 = 2

const SLOTS = ['早', '中', '晚']

// 适应 = 在 3000m 以上营地过夜累计 ≥1 晚。
// 这让前两天在 2900 营地慢慢爬高有了现实意义，也让「一天冲上 3500」要付代价。
export function isAcclimatized(state) {
  return state.flags.高海拔过夜数 >= 需要适应晚数
}

export function stepStaminaCost(state) {
  const 超出 = Math.max(0, state.carry.当前 - 负重基准线)
  let cost = Math.floor(基础时段消耗 * Math.pow(1.04, 超出))
  if (state.place.海拔 > 高海拔线 && !isAcclimatized(state)) cost += 2
  if (hasItem(state, 'trekking_poles')) cost -= 1
  return Math.max(1, cost)
}

function 调整体力(state, delta) {
  state.pc.体力 = Math.max(0, Math.min(100, state.pc.体力 + delta))
  return state
}

export function applyStepCost(state) {
  return 调整体力(state, -stepStaminaCost(state))
}

export function rest(state) {
  return 调整体力(state, hasItem(state, 'camp_stool') ? 10 : 8)
}

export function eatHot(state) {
  if (!hasItem(state, 'stove')) return false
  const 有餐 = hasItem(state, 'freeze_dried') || hasItem(state, 'extra_freeze_dried')
  if (!有餐) return false

  // 气罐见底要换备用罐，而不是把整套炉具丢掉——直接 consumeItem 归零会连炉头
  // 一起摘出背包。这里也是「带 2 罐比带 1 罐能多做热食」真正成立的地方：
  // extra_canister 是独立 gearId，不是 stove 的数量叠加（见本任务开头的 T7 预警）。
  const 炉 = state.pack.find((p) => p.gearId === 'stove')
  if (炉.余量 < 每次热食耗气) {
    if (!hasItem(state, 'extra_canister')) return false
    removeItem(state, 'extra_canister', 1)
    炉.余量 = 100
  }
  炉.余量 -= 每次热食耗气

  removeItem(state, hasItem(state, 'freeze_dried') ? 'freeze_dried' : 'extra_freeze_dried', 1)
  调整体力(state, 6)
  return true
}

export function eatCold(state) {
  if (!hasItem(state, 'trail_snack')) return false
  removeItem(state, 'trail_snack', 1)
  调整体力(state, 3)
  return true
}

export function sleep(state, { 恶劣天气 = false } = {}) {
  const node = getNode(state.place.nodeId)
  const 装备齐 = hasItem(state, 'tent') && hasItem(state, 'sleeping_bag')
  const 条件好 = 装备齐 && node && node.可扎营 && !恶劣天气
  调整体力(state, 条件好 ? 25 : 12)

  if (node && node.海拔 >= 适应海拔线) state.flags.高海拔过夜数 += 1
  return state
}

export function advanceSlot(state) {
  const i = SLOTS.indexOf(state.clock.slot)
  if (i === SLOTS.length - 1) {
    state.clock.slot = SLOTS[0]
    state.clock.day += 1
  } else {
    state.clock.slot = SLOTS[i + 1]
  }
  return state
}

// 每天扣 2 份主粮；主粮见底后自动动用 extra_staple 这个缓冲池
//（它的 每日消耗 标的是 0，正是「不自己扣、只在顶上时被动消耗」的意思）。
// 返回是否断粮，供结局判定参考；欠缺 > 0 表示今天没吃够。
export function dailyUpkeep(state) {
  let 待扣 = 每日主粮
  for (const id of ['staple_food', 'extra_staple']) {
    if (待扣 <= 0) break
    const 项 = state.pack.find((p) => p.gearId === id)
    if (!项) continue
    const 扣 = Math.min(待扣, 项.数量)
    removeItem(state, id, 扣)
    待扣 -= 扣
  }
  const 还有粮 = hasItem(state, 'staple_food') || hasItem(state, 'extra_staple')
  return { 断粮: !还有粮, 欠缺: 待扣 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/consume.test.js`
Expected: PASS，21 个测试全绿。重点确认「spec 里的样例」那条——`floor(6 × 1.04^11.8) = 9` 是设计文档流转示例里的数字，对不上说明公式抄错了。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/engine/consume.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/engine/consume.js test/consume.test.js build.mjs
git commit -m "feat: 时段消耗、体力回复与高山适应"
```

---

### Task 10: 好感

**Files:**
- Create: `src/engine/affinity.js`
- Modify: `build.mjs`
- Test: `test/affinity.test.js`

规则（spec 第 6 节）：0–100 夹取；LLM 单回合最多申报 ±5，带重大标记可 ±15；分级 `0-19 冷淡 / 20-39 面熟 / 40-59 搭伙 / 60-69 信任 / 70-89 爱慕 / 90-99 深爱 / 100 至死不渝`；初始好感 = `clamp(25 + Σ(轴同号 +4 / 轴异号 −4), 10, 45)`。

- [ ] **Step 1: 写失败的测试**

`test/affinity.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampAffinity, affinityLabel, applyAffinityDelta,
  initialAffinity, MAX_DELTA, MAX_MAJOR_DELTA,
} from '../src/engine/affinity.js'

function 队伍() {
  return { party: [{ npcId: 'linxiaoya', 好感: 62, 在队: true }] }
}

test('夹取到 0-100', () => {
  assert.equal(clampAffinity(-30), 0)
  assert.equal(clampAffinity(0), 0)
  assert.equal(clampAffinity(150), 100)
  assert.equal(clampAffinity(62), 62)
})

test('分级标签覆盖每个区间，边界归属正确', () => {
  assert.equal(affinityLabel(0), '冷淡')
  assert.equal(affinityLabel(19), '冷淡')
  assert.equal(affinityLabel(20), '面熟')
  assert.equal(affinityLabel(39), '面熟')
  assert.equal(affinityLabel(40), '搭伙')
  assert.equal(affinityLabel(59), '搭伙')
  assert.equal(affinityLabel(60), '信任')
  assert.equal(affinityLabel(69), '信任')
  assert.equal(affinityLabel(70), '爱慕')
  assert.equal(affinityLabel(89), '爱慕')
  assert.equal(affinityLabel(90), '深爱')
  assert.equal(affinityLabel(99), '深爱')
  assert.equal(affinityLabel(100), '至死不渝')
})

test('文档明写的两个刻度对得上', () => {
  assert.equal(affinityLabel(70), '爱慕')
  assert.equal(affinityLabel(100), '至死不渝')
})

test('普通变化夹到 ±5', () => {
  const s = 队伍()
  assert.equal(applyAffinityDelta(s, 'linxiaoya', 3).实际, 3)
  assert.equal(s.party[0].好感, 65)

  const r = applyAffinityDelta(s, 'linxiaoya', 40)
  assert.equal(r.实际, MAX_DELTA)
  assert.equal(r.被夹取, true)
  assert.equal(s.party[0].好感, 70)
})

test('重大事件可到 ±15', () => {
  const s = 队伍()
  const r = applyAffinityDelta(s, 'linxiaoya', 40, { 重大: true })
  assert.equal(r.实际, MAX_MAJOR_DELTA)
  assert.equal(s.party[0].好感, 77)
})

test('负向变化同样受夹取', () => {
  const s = 队伍()
  assert.equal(applyAffinityDelta(s, 'linxiaoya', -40).实际, -MAX_DELTA)
  assert.equal(s.party[0].好感, 57)
})

test('好感不会越过 0-100 边界', () => {
  const s = { party: [{ npcId: 'a', 好感: 98, 在队: true }] }
  applyAffinityDelta(s, 'a', 5)
  assert.equal(s.party[0].好感, 100)
  s.party[0].好感 = 2
  applyAffinityDelta(s, 'a', -5)
  assert.equal(s.party[0].好感, 0)
})

test('对不在队的人不生效', () => {
  const s = 队伍()
  const r = applyAffinityDelta(s, 'wangdapeng', 5)
  assert.equal(r.应用, false)
  assert.equal(s.party[0].好感, 62)
})

test('初始好感落在 10-45', () => {
  for (const tag of ['renside', 'zilaishu', 'maoxian', 'dulai']) {
    for (const npc of ['chenyan', 'hanmei', 'liweiwei', 'zhaozhiguo']) {
      const v = initialAffinity(tag, npc)
      assert.ok(v >= 10 && v <= 45, `${tag}/${npc} = ${v}`)
    }
  }
})

test('性格越合拍初始好感越高', () => {
  // 「话不多，认死理」[-1,-1,0,-1] 对陈岩「沉稳寡言」[-1,-1,0,-1]：
  // 三条非零轴全同号，轴2 因标签为 0 跳过
  const 合拍 = initialAffinity('renside', 'chenyan')
  // 同一标签对韩梅「强势控制欲」[1,1,1,-1]：轴0/轴1 异号，
  // 轴2 因标签为 0 跳过（不是三轴异号），轴3 同号
  const 不合 = initialAffinity('renside', 'hanmei')
  assert.ok(合拍 > 不合, `合拍 ${合拍} 应高于不合 ${不合}`)
  assert.equal(合拍, 37) // 25 + 4×3
  assert.equal(不合, 21) // 25 − 4×2 + 4×1
})

test('未知标签或未知 npc 返回基准值', () => {
  assert.equal(initialAffinity('查无此标签', 'chenyan'), 25)
  assert.equal(initialAffinity('renside', '查无此人'), 25)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/affinity.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/engine/affinity.js`：

```js
import { getNpc, PERSONALITY_TAGS } from '../data/npcs.js'

export const MAX_DELTA = 5
export const MAX_MAJOR_DELTA = 15

const 基准好感 = 25
const 轴权重 = 4
const 初始下限 = 10
const 初始上限 = 45

const 分级 = [
  [0, 19, '冷淡'], [20, 39, '面熟'], [40, 59, '搭伙'], [60, 69, '信任'],
  [70, 89, '爱慕'], [90, 99, '深爱'], [100, 100, '至死不渝'],
]

export function clampAffinity(v) {
  return Math.max(0, Math.min(100, v))
}

export function affinityLabel(v) {
  // 先夹取再查表。否则 affinityLabel(150) 会落空并回落成「冷淡」——
  // 一个静默的谎言，而它恰恰出现在 UI 上给玩家看。
  const 夹取后 = clampAffinity(v)
  const hit = 分级.find(([lo, hi]) => 夹取后 >= lo && 夹取后 <= hi)
  return hit ? hit[2] : '冷淡'
}

// LLM 只能提议好感变化，落地前先夹到允许幅度——防止一句话涨 40 点。
export function applyAffinityDelta(state, npcId, delta, { 重大 = false } = {}) {
  const 同伴 = state.party.find((p) => p.npcId === npcId && p.在队)
  // 两个分支返回同样的键。少给 前值/后值 的话，调用方一解构就静默拿到
  // undefined，拿去比阈值或做算术会悄悄算错。
  if (!同伴) return { 应用: false, 实际: 0, 被夹取: false, 前值: null, 后值: null }

  const 上限 = 重大 ? MAX_MAJOR_DELTA : MAX_DELTA
  const 实际 = Math.max(-上限, Math.min(上限, delta))
  const 前值 = 同伴.好感
  同伴.好感 = clampAffinity(前值 + 实际)

  return { 应用: true, 实际, 被夹取: 实际 !== delta, 前值, 后值: 同伴.好感 }
}

// 初始好感由性格轴匹配度决定，让捏人这一步真的有后果。
export function initialAffinity(tagId, npcId) {
  const tag = PERSONALITY_TAGS.find((t) => t.id === tagId)
  const npc = getNpc(npcId)
  if (!tag || !npc) return 基准好感

  let 分 = 基准好感
  for (let i = 0; i < tag.轴.length; i++) {
    const a = tag.轴[i]
    const b = npc.轴[i]
    if (a === 0 || b === 0) continue
    分 += a === b ? 轴权重 : -轴权重
  }
  return Math.max(初始下限, Math.min(初始上限, 分))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/affinity.test.js`
Expected: PASS，13 个测试全绿。「性格越合拍初始好感越高」里的 37 与 17 是按 Task 4 的轴值手算的，对不上说明轴值抄错——回 `npcs.js` 核对，别改断言。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/engine/affinity.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/engine/affinity.js test/affinity.test.js build.mjs
git commit -m "feat: 好感夹取、分级与性格轴初始好感"
```

---

### Task 11: 结局判定

**Files:**
- Create: `src/engine/ending.js`
- Modify: `build.mjs`
- Test: `test/ending.test.js`

三种结局（spec 第 6 节，文档定死）：**失败遇险**（体力归零／重伤未处理满 2 天／失温连续失败 3 次）、**被救援**（已求救）、**成功穿越**（抵达下板寺，罚款 5000）。

- [ ] **Step 1: 写失败的测试**

`test/ending.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEnding, applyEnding, FINE_AMOUNT } from '../src/engine/ending.js'

function 状态(over = {}) {
  return {
    phase: '徒步',
    clock: { day: 5, slot: '中' },
    place: { nodeId: 'maijieling', 海拔: 3500 },
    money: 4320,
    pc: { 体力: 50, 伤病: [] },
    flags: { 已求救: false, 已下撤: false, 失温连败: 0 },
    ...over,
  }
}

test('一切正常时没有结局', () => {
  assert.equal(checkEnding(状态()), null)
})

test('体力归零 → 失败遇险', () => {
  const e = checkEnding(状态({ pc: { 体力: 0, 伤病: [] } }))
  assert.equal(e.type, '失败遇险')
  assert.ok(e.原因.includes('体力'))
})

test('重伤满 2 天未处理 → 失败遇险', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '滑坠骨折', 严重度: '重', 起始day: 3, 已处理: false }] } })
  assert.equal(checkEnding(s).type, '失败遇险')
})

test('重伤但已处理 → 不触发', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '滑坠骨折', 严重度: '重', 起始day: 3, 已处理: true }] } })
  assert.equal(checkEnding(s), null)
})

test('重伤刚发生不满 2 天 → 不触发', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '滑坠骨折', 严重度: '重', 起始day: 4, 已处理: false }] } })
  assert.equal(checkEnding(s), null)
})

test('轻伤放多久都不触发', () => {
  const s = 状态({ pc: { 体力: 50, 伤病: [{ 名称: '擦伤', 严重度: '轻', 起始day: 1, 已处理: false }] } })
  assert.equal(checkEnding(s), null)
})

test('失温连败 3 次 → 失败遇险', () => {
  assert.equal(checkEnding(状态({ flags: { 已求救: false, 已下撤: false, 失温连败: 2 } })), null)
  assert.equal(checkEnding(状态({ flags: { 已求救: false, 已下撤: false, 失温连败: 3 } })).type, '失败遇险')
})

test('已求救 → 被救援', () => {
  const e = checkEnding(状态({ flags: { 已求救: true, 已下撤: false, 失温连败: 0 } }))
  assert.equal(e.type, '被救援')
})

test('抵达下板寺 → 成功穿越', () => {
  const e = checkEnding(状态({ place: { nodeId: 'xiabansi', 海拔: 2800 } }))
  assert.equal(e.type, '成功穿越')
  assert.equal(e.罚款, FINE_AMOUNT)
})

test('失败遇险优先于被救援', () => {
  const s = 状态({ pc: { 体力: 0, 伤病: [] }, flags: { 已求救: true, 已下撤: false, 失温连败: 0 } })
  assert.equal(checkEnding(s).type, '失败遇险')
})

test('applyEnding 写入 phase 与结局，并对成功穿越扣罚款', () => {
  const s = 状态({ place: { nodeId: 'xiabansi', 海拔: 2800 } })
  applyEnding(s, checkEnding(s))
  assert.equal(s.phase, '结局')
  assert.equal(s.ending.type, '成功穿越')
  assert.equal(s.money, 4320 - FINE_AMOUNT)
})

test('罚款不会把钱扣成负数', () => {
  const s = 状态({ place: { nodeId: 'xiabansi', 海拔: 2800 }, money: 300 })
  applyEnding(s, checkEnding(s))
  assert.equal(s.money, 0)
})

test('失败遇险不扣罚款', () => {
  const s = 状态({ pc: { 体力: 0, 伤病: [] } })
  applyEnding(s, checkEnding(s))
  assert.equal(s.money, 4320)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/ending.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/engine/ending.js`：

```js
export const FINE_AMOUNT = 5000

const 重伤致命天数 = 2
const 失温连败上限 = 3
const 终点节点 = 'xiabansi'

// 判定顺序即优先级：人先没了，就轮不到救援与穿越。
export function checkEnding(state) {
  if (state.pc.体力 <= 0) {
    return { type: '失败遇险', 原因: '体力耗尽，再也走不动了' }
  }

  const 致命伤 = (state.pc.伤病 || []).find(
    (w) => w.严重度 === '重' && !w.已处理 && state.clock.day - w.起始day >= 重伤致命天数
  )
  if (致命伤) {
    return { type: '失败遇险', 原因: `${致命伤.名称}拖了两天没处理` }
  }

  if ((state.flags.失温连败 || 0) >= 失温连败上限) {
    return { type: '失败遇险', 原因: '连续失温，体温再也提不上来' }
  }

  if (state.flags.已求救) {
    return { type: '被救援', 原因: '发出了求救信号，等来了救援队' }
  }

  if (state.place.nodeId === 终点节点) {
    return { type: '成功穿越', 原因: '走到了下板寺', 罚款: FINE_AMOUNT }
  }

  return null
}

export function applyEnding(state, ending) {
  if (!ending) return state
  state.phase = '结局'
  state.ending = ending
  if (ending.type === '成功穿越') {
    state.money = Math.max(0, state.money - FINE_AMOUNT)
  }
  return state
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/ending.test.js`
Expected: PASS，13 个测试全绿

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/engine/ending.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/engine/ending.js test/ending.test.js build.mjs
git commit -m "feat: 三种结局判定与罚款结算"
```

---

### Task 12: 旅程档案

**Files:**
- Create: `src/engine/journal.js`
- Modify: `build.mjs`
- Test: `test/journal.test.js`

档案是替代全量历史的记忆载体（spec 第 7、8 节）。超限压缩规则：关键事件只留最近 20 条，**未收伏笔全部保留**——伏笔丢了故事就收不了线。

- [ ] **Step 1: 写失败的测试**

`test/journal.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createJournal, recordNode, recordEvent, addForeshadow,
  resolveForeshadow, updateNpcStatus, compressJournal,
  renderJournal, MAX_EVENTS,
} from '../src/engine/journal.js'

test('新档案是空的', () => {
  const j = createJournal()
  assert.deepEqual(j.已过节点, [])
  assert.deepEqual(j.关键事件, [])
  assert.deepEqual(j.未收伏笔, [])
  assert.deepEqual(j.人物状态, {})
})

test('记录节点，连续重复不会重复记', () => {
  const j = createJournal()
  recordNode(j, 'tangkou')
  recordNode(j, 'tangkou')
  recordNode(j, 'huoshaopo')
  assert.deepEqual(j.已过节点, ['tangkou', 'huoshaopo'])
})

test('折返回旧节点会再记一次（路线是有来回的）', () => {
  const j = createJournal()
  recordNode(j, 'shuiwozi')
  recordNode(j, 'maijieling')
  recordNode(j, 'shuiwozi')
  assert.deepEqual(j.已过节点, ['shuiwozi', 'maijieling', 'shuiwozi'])
})

test('记录事件带上时间戳', () => {
  const j = createJournal()
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝盖旧伤复发，你分了他布洛芬')
  assert.equal(j.关键事件.length, 1)
  assert.equal(j.关键事件[0].day, 2)
  assert.equal(j.关键事件[0].slot, '晚')
  assert.ok(j.关键事件[0].文本.includes('布洛芬'))
})

test('空白事件被忽略', () => {
  const j = createJournal()
  recordEvent(j, { day: 1, slot: '早' }, '   ')
  recordEvent(j, { day: 1, slot: '早' }, '')
  assert.equal(j.关键事件.length, 0)
})

test('伏笔可增可收，收掉的移出未收列表', () => {
  const j = createJournal()
  addForeshadow(j, '石缝里那截褪色路标带')
  addForeshadow(j, '对讲机里断续的呼叫')
  assert.equal(j.未收伏笔.length, 2)

  assert.equal(resolveForeshadow(j, '石缝里那截褪色路标带'), true)
  assert.equal(j.未收伏笔.length, 1)
  assert.equal(j.已收伏笔.length, 1)
})

test('重复添加同一伏笔不会翻倍', () => {
  const j = createJournal()
  addForeshadow(j, '对讲机里断续的呼叫')
  addForeshadow(j, '对讲机里断续的呼叫')
  assert.equal(j.未收伏笔.length, 1)
})

test('收一个不存在的伏笔返回 false', () => {
  const j = createJournal()
  assert.equal(resolveForeshadow(j, '查无此伏笔'), false)
})

test('人物状态可更新可覆盖', () => {
  const j = createJournal()
  updateNpcStatus(j, 'linxiaoya', '轻度高反')
  updateNpcStatus(j, 'linxiaoya', '已恢复')
  assert.equal(j.人物状态.linxiaoya, '已恢复')
})

test(`压缩只留最近 ${MAX_EVENTS} 条事件`, () => {
  const j = createJournal()
  for (let i = 1; i <= 30; i++) recordEvent(j, { day: i, slot: '早' }, `事件${i}`)
  compressJournal(j)
  assert.equal(j.关键事件.length, MAX_EVENTS)
  assert.equal(j.关键事件[0].文本, `事件${30 - MAX_EVENTS + 1}`)
  assert.equal(j.关键事件[MAX_EVENTS - 1].文本, '事件30')
})

test('压缩绝不丢未收伏笔', () => {
  const j = createJournal()
  for (let i = 1; i <= 50; i++) recordEvent(j, { day: i, slot: '早' }, `事件${i}`)
  for (let i = 1; i <= 12; i++) addForeshadow(j, `伏笔${i}`)
  compressJournal(j)
  assert.equal(j.未收伏笔.length, 12)
})

test('事件不超限时压缩是空操作', () => {
  const j = createJournal()
  recordEvent(j, { day: 1, slot: '早' }, '只有一条')
  compressJournal(j)
  assert.equal(j.关键事件.length, 1)
})

test('渲染成 prompt 片段，含四个小节', () => {
  const j = createJournal()
  recordNode(j, 'tangkou')
  recordNode(j, 'huoshaopo')
  recordEvent(j, { day: 2, slot: '晚' }, '王大鹏膝盖旧伤复发')
  addForeshadow(j, '对讲机里断续的呼叫')
  updateNpcStatus(j, 'linxiaoya', '轻度高反')

  const out = renderJournal(j)
  assert.ok(out.includes('已过节点'))
  assert.ok(out.includes('塘口村起点'))
  assert.ok(out.includes('火烧坡'))
  assert.ok(out.includes('关键事件'))
  assert.ok(out.includes('王大鹏'))
  assert.ok(out.includes('未收伏笔'))
  assert.ok(out.includes('对讲机'))
  assert.ok(out.includes('林晓雅'))
  assert.ok(out.includes('轻度高反'))
})

test('渲染绝不泄漏数字好感（文档禁止 LLM 开天眼）', () => {
  const j = createJournal()
  updateNpcStatus(j, 'linxiaoya', '轻度高反')
  const out = renderJournal(j)
  assert.ok(!/好感/.test(out), '渲染结果不该出现「好感」二字')
  assert.ok(!/\b\d{1,3}\s*\/\s*100\b/.test(out), '渲染结果不该出现百分制数值')
})

test('空档案也能渲染，不炸', () => {
  const out = renderJournal(createJournal())
  assert.equal(typeof out, 'string')
  assert.ok(out.length > 0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/journal.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/engine/journal.js`：

```js
import { getNode } from '../data/route.js'
import { getNpc } from '../data/npcs.js'

export const MAX_EVENTS = 20

export function createJournal() {
  return { 已过节点: [], 关键事件: [], 未收伏笔: [], 已收伏笔: [], 人物状态: {} }
}

export function recordNode(journal, nodeId) {
  const 末尾 = journal.已过节点[journal.已过节点.length - 1]
  if (末尾 === nodeId) return journal
  journal.已过节点.push(nodeId)
  return journal
}

export function recordEvent(journal, clock, 文本) {
  if (!文本 || !文本.trim()) return journal
  journal.关键事件.push({ day: clock.day, slot: clock.slot, 文本: 文本.trim() })
  return journal
}

export function addForeshadow(journal, 文本) {
  if (!文本 || !文本.trim()) return journal
  const t = 文本.trim()
  if (!journal.未收伏笔.includes(t)) journal.未收伏笔.push(t)
  return journal
}

export function resolveForeshadow(journal, 文本) {
  const i = journal.未收伏笔.indexOf((文本 || '').trim())
  if (i === -1) return false
  journal.已收伏笔.push(journal.未收伏笔[i])
  journal.未收伏笔.splice(i, 1)
  return true
}

export function updateNpcStatus(journal, npcId, 状态) {
  journal.人物状态[npcId] = 状态
  return journal
}

// 上下文超限时压缩。事件截掉旧的，伏笔一条都不能丢——丢了故事就收不了线。
export function compressJournal(journal) {
  if (journal.关键事件.length > MAX_EVENTS) {
    journal.关键事件 = journal.关键事件.slice(-MAX_EVENTS)
  }
  return journal
}

// 渲染成发给 LLM 的档案片段。刻意只给状态词、不给数字好感——
// 文档禁止 LLM 开天眼，给它精确数值它就会在对话里漏出来。
export function renderJournal(journal) {
  const 节点名 = journal.已过节点.map((id) => (getNode(id) ? getNode(id).名称 : id))
  const 人物 = Object.entries(journal.人物状态).map(([id, st]) => {
    const npc = getNpc(id)
    return `${npc ? npc.名称 : id} ${st}`
  })

  const lines = ['【旅程档案】']
  lines.push(`  已过节点：${节点名.length ? 节点名.join(' → ') : '（尚未出发）'}`)

  lines.push('  关键事件：')
  if (journal.关键事件.length === 0) {
    lines.push('    （无）')
  } else {
    for (const e of journal.关键事件) lines.push(`    D${e.day}${e.slot} ${e.文本}`)
  }

  lines.push('  未收伏笔：')
  if (journal.未收伏笔.length === 0) {
    lines.push('    （无）')
  } else {
    for (const f of journal.未收伏笔) lines.push(`    ${f}`)
  }

  lines.push(`  人物：${人物.length ? 人物.join('｜') : '（无）'}`)
  return lines.join('\n')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/journal.test.js`
Expected: PASS，16 个测试全绿。特别确认「绝不泄漏数字好感」那条——它守的是文档最硬的一条约束。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/engine/journal.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/engine/journal.js test/journal.test.js build.mjs
git commit -m "feat: 旅程档案维护、压缩与 prompt 渲染"
```

---

## 阶段四 · LLM 层

### Task 13: 混合协议解析

**Files:**
- Create: `src/llm/parser.js`
- Modify: `build.mjs`
- Test: `test/parser.test.js`

这是整个项目**线上最容易出问题的一块**。协议形如：正文用文档原格式的 `[剧情标题]` / `[剧情]` / `[鳌太万象]` / `[下回选项]` 分段，末尾追加 `<<<STATE>>>` 加一段 JSON。解析器必须对模型的各种不规矩输出保持宽容，且**永远不抛异常**——出错走 `errors` 数组，让上层降级。

- [ ] **Step 1: 写失败的测试**

`test/parser.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/parser.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/llm/parser.js`：

```js
export const STATE_MARKER = '<<<STATE>>>'

// 段落标记：半角与全角方括号都认
const SECTIONS = [
  { key: '标题', 名: '剧情标题' },
  { key: '剧情', 名: '剧情' },
  { key: '万象', 名: '鳌太万象' },
  { key: '选项', 名: '下回选项' },
]

function 段落正则(名) {
  return new RegExp(`^[\\[【]\\s*${名}\\s*[\\]】]\\s*$`)
}

// 把正文按段落标记切开。任何一段缺失都不算致命。
function 切段(text) {
  const lines = text.split('\n')
  const buckets = { 标题: [], 剧情: [], 万象: [], 选项: [], _散: [] }
  let 当前 = '_散'

  for (const line of lines) {
    const hit = SECTIONS.find((s) => 段落正则(s.名).test(line.trim()))
    if (hit) {
      当前 = hit.key
      continue
    }
    buckets[当前].push(line)
  }
  return buckets
}

function 提取列表项(lines) {
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(?:\d+\s*[.、．)）]|[-•·*])\s*(.+)$/)
    out.push(m ? m[1].trim() : line)
  }
  return out
}

function 提取选项(lines) {
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([A-Da-d])\s*[.、．)）:：]?\s*(.+)$/)
    if (m) out.push({ id: m[1].toUpperCase(), 文本: m[2].trim() })
  }
  return out
}

function 剥围栏(s) {
  const t = s.trim()
  const m = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/)
  return m ? m[1].trim() : t
}

// 尾段解析。返回 { state, errors }，state 为 null 表示这一回合不结算。
function 解析尾段(raw) {
  const errors = []
  let body = 剥围栏(raw)
  if (!body) return { state: null, errors: ['STATE 尾段为空'] }

  const 试解析 = (s) => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }

  let parsed = 试解析(body)

  // 模型偶尔会把 JSON 的引号打成全角。只在常规解析失败后才做这层修复，
  // 免得把正文里合法的中文引号也改掉。
  if (parsed === undefined) {
    const 修复 = body.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    if (修复 !== body) {
      parsed = 试解析(修复)
      if (parsed !== undefined) errors.push('STATE 使用了全角引号，已自动修复')
    }
  }

  if (parsed === undefined) return { state: null, errors: ['STATE JSON 解析失败'] }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: null, errors: ['STATE 不是 JSON 对象'] }
  }
  return { state: parsed, errors }
}

// 解析一整回合的模型输出。约定：本函数永不抛异常，问题一律进 errors。
export function parseTurn(raw) {
  const 结果 = { 标题: '', 剧情: '', 万象: [], 选项: [], state: null, errors: [] }

  if (typeof raw !== 'string' || !raw.trim()) {
    结果.errors.push('模型输出为空或不是字符串')
    return 结果
  }

  // 正文里可能出现 STATE 字样（人物对话引用），取最后一个才是真尾段
  const idx = raw.lastIndexOf(STATE_MARKER)
  const 正文 = idx === -1 ? raw : raw.slice(0, idx)
  const 尾段 = idx === -1 ? null : raw.slice(idx + STATE_MARKER.length)

  const buckets = 切段(正文)

  结果.标题 = buckets.标题.join('\n').trim()
  结果.剧情 = buckets.剧情.join('\n').trim()
  结果.万象 = 提取列表项(buckets.万象)
  结果.选项 = 提取选项(buckets.选项)

  // 一个标记都没有时，别把整段丢掉——当正文用，至少玩家还能读到内容
  if (!结果.标题 && !结果.剧情 && 结果.万象.length === 0 && 结果.选项.length === 0) {
    结果.剧情 = buckets._散.join('\n').trim()
  }

  if (结果.选项.length === 0) 结果.errors.push('未解析出任何下回选项')

  if (尾段 === null) {
    结果.errors.push('缺少 STATE 尾段')
  } else {
    const { state, errors } = 解析尾段(尾段)
    结果.state = state
    结果.errors.push(...errors)
  }

  return 结果
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/parser.test.js`
Expected: PASS，21 个测试全绿。最后一条「从不抛异常」是这个模块的生命线——它失败就意味着线上会白屏。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/llm/parser.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/llm/parser.js test/parser.test.js build.mjs
git commit -m "feat: 混合协议解析，容忍模型的各种不规矩输出"
```

---

### Task 14: 提议校验与夹取

> **来自 T7 评审的预警：`state.js` 的写入函数不做入参卫生检查，这一层的把关全靠本任务。**
>
> 实测：`addItem(s, id, 档, -1)` 会造出 `数量: -1`、负负重的条目；`consumeItem(s, id, -10)` 会把 `余量` 从 100 涨到 110，等于凭空回满。`state.js` 不拦是对的——它是写入层，校验属于本模块的职责。
>
> **因此本任务必须保证：凡是流向 `addItem` / `removeItem` / `consumeItem` 的数量与百分比，一律先校验为正数且非零。** 这些函数既被 LLM 提议路径调用，也被引擎内部（T8–T11）调用，后者同样可能传进脏值。


**Files:**
- Create: `src/llm/validate.js`
- Modify: `build.mjs`
- Test: `test/validate.test.js`

LLM 报的门槛是现编的，必须夹取（spec 第 6 节）。它还会用**中文名**指代人物（"林晓雅"），得映射回 npcId。越权提议一律驳回并记 warning，但**不打断流程**。

| 选项类型 | 好感门槛上限 | 经验门槛区间 |
|---|---|---|
| 社交 | ≤85 | 0–30 |
| 徒步 | ≤60 | 20–75 |
| 高危 | ≤70 | 40–90 |

- [ ] **Step 1: 写失败的测试**

`test/validate.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveNpc, clampRequire, validateProposal, CLAMP_TABLE } from '../src/llm/validate.js'

function 状态() {
  return {
    place: { nodeId: 'maijieling', 海拔: 3500 },
    party: [
      { npcId: 'linxiaoya', 好感: 62, 在队: true },
      { npcId: 'chenyan', 好感: 45, 在队: true },
    ],
    pack: [{ gearId: 'rope', 数量: 1, 单重: 1.6 }],
  }
}

test('人物中文名映射回 id', () => {
  assert.equal(resolveNpc('林晓雅'), 'linxiaoya')
  assert.equal(resolveNpc('陈岩'), 'chenyan')
  assert.equal(resolveNpc('linxiaoya'), 'linxiaoya', 'id 原样传入也认')
  assert.equal(resolveNpc('查无此人'), null)
  assert.equal(resolveNpc(''), null)
  assert.equal(resolveNpc(null), null)
})

test('社交类经验门槛夹到 0-30', () => {
  const { require: r, warnings } = clampRequire('社交', { 经验: 80 })
  assert.equal(r.经验, CLAMP_TABLE.社交.经验[1])
  assert.equal(r.经验, 30)
  assert.equal(warnings.length, 1)
})

test('徒步类经验门槛低于下限时抬到下限', () => {
  assert.equal(clampRequire('徒步', { 经验: 5 }).require.经验, 20)
})

test('高危类好感门槛夹到 70', () => {
  const { require: r } = clampRequire('高危', { 好感: { linxiaoya: 95 } })
  assert.equal(r.好感.linxiaoya, 70)
})

test('门槛在范围内时原样保留，不产生 warning', () => {
  const { require: r, warnings } = clampRequire('徒步', { 经验: 60, 好感: { linxiaoya: 50 } })
  assert.equal(r.经验, 60)
  assert.equal(r.好感.linxiaoya, 50)
  assert.deepEqual(warnings, [])
})

test('未知类型按徒步处理', () => {
  assert.equal(clampRequire('胡编的类型', { 经验: 99 }).require.经验, 75)
})

test('好感提议：名字映射、幅度交由引擎夹取', () => {
  const p = { 好感: [{ npc: '林晓雅', delta: 3, 因: '你退后让她先过' }] }
  const r = validateProposal(状态(), p)
  assert.equal(r.好感变更.length, 1)
  assert.equal(r.好感变更[0].npcId, 'linxiaoya')
  assert.equal(r.好感变更[0].delta, 3)
  assert.equal(r.好感变更[0].重大, false)
})

test('带重大标记的好感提议被识别', () => {
  const p = { 好感: [{ npc: '陈岩', delta: 15, 重大: true, 因: '他把你从石缝里拽了上来' }] }
  assert.equal(validateProposal(状态(), p).好感变更[0].重大, true)
})

test('对不在队/不存在的人的好感提议被驳回', () => {
  const p = { 好感: [{ npc: '王大鹏', delta: 5 }, { npc: '孙悟空', delta: 5 }] }
  const r = validateProposal(状态(), p)
  assert.equal(r.好感变更.length, 0)
  assert.equal(r.warnings.length, 2)
})

test('delta 非数字被驳回', () => {
  const r = validateProposal(状态(), { 好感: [{ npc: '林晓雅', delta: '很多' }] })
  assert.equal(r.好感变更.length, 0)
  assert.ok(r.warnings[0].includes('delta'))
})

test('选项里引用不存在的物品被驳回，其余照常', () => {
  const p = { 选项: [
    { id: 'A', 类型: '徒步', require: { 物品: ['rope'] }, cost: { 体力: 10 } },
    { id: 'B', 类型: '徒步', require: { 物品: ['光剑'] }, cost: { 体力: 10 } },
  ] }
  const r = validateProposal(状态(), p)
  assert.equal(r.选项.length, 2)
  assert.deepEqual(r.选项[0].require.物品, ['rope'])
  assert.deepEqual(r.选项[1].require.物品, [], '不存在的物品应被剔除')
  assert.ok(r.warnings.some((w) => w.includes('光剑')))
})

test('选项 id 非法被丢弃', () => {
  const r = validateProposal(状态(), { 选项: [{ id: 'X', 类型: '社交' }, { id: 'A', 类型: '社交' }] })
  assert.equal(r.选项.length, 1)
  assert.equal(r.选项[0].id, 'A')
})

test('选项好感门槛的人名同样被映射', () => {
  const p = { 选项: [{ id: 'A', 类型: '社交', require: { 好感: { 林晓雅: 40 } } }] }
  const r = validateProposal(状态(), p)
  assert.equal(r.选项[0].require.好感.linxiaoya, 40)
})

test('去向必须是合法相邻节点', () => {
  assert.equal(validateProposal(状态(), { 去向建议: '水窝子营地' }).去向, 'shuiwozi')
  assert.equal(validateProposal(状态(), { 去向建议: 'shuiwozi' }).去向, 'shuiwozi')
  assert.equal(validateProposal(状态(), { 去向建议: '下板寺' }).去向, null, '隔着大半条线不该允许')
  assert.equal(validateProposal(状态(), { 去向建议: '珠穆朗玛' }).去向, null)
})

test('去向不合法时记 warning', () => {
  const r = validateProposal(状态(), { 去向建议: '下板寺' })
  assert.ok(r.warnings.some((w) => w.includes('去向')))
})

test('记忆与伏笔原样透传，空白项被剔除', () => {
  const p = { 记忆: ['D4晚 麦秸岭 判定失败', '  ', ''], 伏笔: { 新增: ['雾里的人影'], 已收: ['石缝路标带'] } }
  const r = validateProposal(状态(), p)
  assert.deepEqual(r.记忆, ['D4晚 麦秸岭 判定失败'])
  assert.deepEqual(r.伏笔.新增, ['雾里的人影'])
  assert.deepEqual(r.伏笔.已收, ['石缝路标带'])
})

test('空提议或 null 提议返回空结构，不炸', () => {
  for (const p of [null, undefined, {}, 42, []]) {
    const r = validateProposal(状态(), p)
    assert.deepEqual(r.好感变更, [])
    assert.deepEqual(r.选项, [])
    assert.equal(r.去向, null)
  }
})

test('validateProposal 从不抛异常', () => {
  const 恶意 = [
    { 好感: '不是数组' },
    { 选项: [null, undefined, 42] },
    { 伏笔: '不是对象' },
    { 选项: [{ id: 'A', require: { 好感: '不是对象' } }] },
  ]
  for (const p of 恶意) {
    assert.doesNotThrow(() => validateProposal(状态(), p), JSON.stringify(p))
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/validate.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/llm/validate.js`：

```js
import { NPCS, getNpc } from '../data/npcs.js'
import { getGear } from '../data/gear.js'
import { ROUTE, getNode, isAdjacent } from '../data/route.js'

// 门槛夹取表。LLM 现编的门槛不能超出这个范围，否则「喝口水」也要求经验 80。
export const CLAMP_TABLE = {
  社交: { 好感: 85, 经验: [0, 30] },
  徒步: { 好感: 60, 经验: [20, 75] },
  高危: { 好感: 70, 经验: [40, 90] },
}

const 合法选项id = new Set(['A', 'B', 'C', 'D'])

// LLM 用中文名指代人物，映射回 id；id 直传也认。
export function resolveNpc(name) {
  if (!name || typeof name !== 'string') return null
  const t = name.trim()
  if (getNpc(t)) return t
  const hit = NPCS.find((n) => n.名称 === t)
  return hit ? hit.id : null
}

function resolveNode(name) {
  if (!name || typeof name !== 'string') return null
  const t = name.trim()
  if (getNode(t)) return t
  const hit = ROUTE.find((n) => n.名称 === t || n.名称.startsWith(t))
  return hit ? hit.id : null
}

export function clampRequire(类型, require) {
  const rule = CLAMP_TABLE[类型] || CLAMP_TABLE.徒步
  const warnings = []
  const out = {}

  if (typeof require?.经验 === 'number') {
    const [lo, hi] = rule.经验
    out.经验 = Math.max(lo, Math.min(hi, require.经验))
    if (out.经验 !== require.经验) warnings.push(`经验门槛 ${require.经验} 越界，夹到 ${out.经验}`)
  }
  if (typeof require?.体力 === 'number') {
    out.体力 = Math.max(0, Math.min(100, require.体力))
  }

  if (require?.好感 && typeof require.好感 === 'object' && !Array.isArray(require.好感)) {
    out.好感 = {}
    for (const [名, 值] of Object.entries(require.好感)) {
      const id = resolveNpc(名)
      if (!id) {
        warnings.push(`好感门槛引用了未知人物「${名}」，已剔除`)
        continue
      }
      if (typeof 值 !== 'number') continue
      const 夹 = Math.max(0, Math.min(rule.好感, 值))
      if (夹 !== 值) warnings.push(`${名} 好感门槛 ${值} 越界，夹到 ${夹}`)
      out.好感[id] = 夹
    }
  }

  if (Array.isArray(require?.物品)) {
    out.物品 = []
    for (const g of require.物品) {
      if (getGear(g)) out.物品.push(g)
      else warnings.push(`选项引用了不存在的物品「${g}」，已剔除`)
    }
  }

  return { require: out, warnings }
}

// 把 LLM 的 STATE 提议过一遍筛子。所有越权都记 warning，但不打断——游戏要能继续。
export function validateProposal(state, proposal) {
  const out = { 好感变更: [], 记忆: [], 伏笔: { 新增: [], 已收: [] }, 选项: [], 去向: null, warnings: [] }
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return out

  for (const item of Array.isArray(proposal.好感) ? proposal.好感 : []) {
    if (!item || typeof item !== 'object') continue
    const npcId = resolveNpc(item.npc)
    if (!npcId) {
      out.warnings.push(`好感提议引用了未知人物「${item.npc}」，已驳回`)
      continue
    }
    if (!state.party.some((p) => p.npcId === npcId && p.在队)) {
      out.warnings.push(`${item.npc} 不在队，好感提议已驳回`)
      continue
    }
    if (typeof item.delta !== 'number' || !Number.isFinite(item.delta)) {
      out.warnings.push(`${item.npc} 的 delta 不是数字，已驳回`)
      continue
    }
    out.好感变更.push({ npcId, delta: item.delta, 重大: item.重大 === true, 因: item.因 || '' })
  }

  for (const m of Array.isArray(proposal.记忆) ? proposal.记忆 : []) {
    if (typeof m === 'string' && m.trim()) out.记忆.push(m.trim())
  }

  const 伏笔 = proposal.伏笔
  if (伏笔 && typeof 伏笔 === 'object' && !Array.isArray(伏笔)) {
    for (const k of ['新增', '已收']) {
      for (const f of Array.isArray(伏笔[k]) ? 伏笔[k] : []) {
        if (typeof f === 'string' && f.trim()) out.伏笔[k].push(f.trim())
      }
    }
  }

  for (const opt of Array.isArray(proposal.选项) ? proposal.选项 : []) {
    if (!opt || typeof opt !== 'object') continue
    const id = typeof opt.id === 'string' ? opt.id.trim().toUpperCase() : ''
    if (!合法选项id.has(id)) {
      out.warnings.push(`选项 id「${opt.id}」非法，已丢弃`)
      continue
    }
    const { require, warnings } = clampRequire(opt.类型, opt.require)
    out.warnings.push(...warnings)
    out.选项.push({ id, 类型: opt.类型 || '徒步', require, cost: opt.cost || {} })
  }

  if (proposal.去向建议) {
    const id = resolveNode(proposal.去向建议)
    if (id && isAdjacent(state.place.nodeId, id)) {
      out.去向 = id
    } else {
      out.warnings.push(`去向建议「${proposal.去向建议}」不是当前位置的合法相邻节点，已驳回`)
    }
  }

  return out
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/validate.test.js`
Expected: PASS，21 个测试全绿

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/llm/validate.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/llm/validate.js test/validate.test.js build.mjs
git commit -m "feat: LLM 提议校验、人名映射与门槛夹取"
```

---

### Task 15: prompt 组装

**Files:**
- Create: `src/llm/prompt.js`
- Modify: `build.mjs`
- Test: `test/prompt.test.js`

system prompt 常驻不变（命中各家 prompt cache）；user message 每回合重组（spec 第 8 节）。

- [ ] **Step 1: 写失败的测试**

`test/prompt.test.js`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/prompt.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/llm/prompt.js`：

```js
import { ROUTE, getNode } from '../data/route.js'
import { NPCS, getNpc } from '../data/npcs.js'
import { GEAR, EXTRA_GEAR } from '../data/gear.js'
import { SEASONS } from '../data/seasons.js'
import { renderJournal } from '../engine/journal.js'
import { STATE_MARKER } from './parser.js'

const 最近回合上限 = 3

function 静态数据块() {
  const 路线 = ROUTE.map((n) => `${n.名称}(${n.海拔}m)：${n.特征} 危险：${n.危险}`).join('\n')
  const 人物 = NPCS.map((n) =>
    `${n.名称}｜${n.年龄}岁｜${n.职业}｜技能：${n.技能.join('、')}｜性格：${n.性格}｜初始状态：${n.状态}` +
    (n.事迹 ? `｜事迹：${n.事迹}` : '')
  ).join('\n')
  const 装备 = [...GEAR, ...EXTRA_GEAR].map((g) => `${g.名称}（${g.类别}）`).join('、')
  const 四季 = SEASONS.map((s) =>
    `${s.名称}(${s.月份})：主要风险 ${s.主要风险.join('、')}；次要风险 ${s.次要风险.join('、')}`
  ).join('\n')

  return `## 路线节点（只能用这些地点）\n${路线}\n\n## 人物（只能用这些人）\n${人物}\n\n## 装备物资（只能用这些东西）\n${装备}\n\n## 四季风险\n${四季}`
}

// 常驻不变，命中各家 prompt cache。任何随状态变化的内容都不能写进来。
export function buildSystemPrompt() {
  return `你是文字游戏《穿越鳌太线》的叙事引擎。玩家重装徒步秦岭鳌太线，你负责把每一回合写成故事。

# 总则
所有地点、人物、装备只能取自下方给定数据，不得自创。玩家的数值由前端掌管，你只写字、只提议。
判定已经由前端完成——你收到的是既成事实，不要改写结果，只负责把它写成合理的故事。

${静态数据块()}

# 文风约束
- 剧情正文控制在 300 字左右，不要写长。
- 人物对话必须口语化，禁止文绉绉。
- 禁止心理描写、禁止比喻隐喻、禁止使用任何意象、禁止上帝视角。
- 减少环境描写、动作描写、器物描写，以推动故事情节为主。
- 以体验徒步生活、生存、人物社交为主，减少阴谋成分。
- 正文中禁止出现任何数值，禁止未卜先知或开天眼等 OOC 行为。

# 输出格式
先按下列段落写正文，末尾追加一行 ${STATE_MARKER}，其后跟一个 JSON 对象。范例：

[剧情标题]
刃脊上的三十米

[剧情]
（300 字左右正文）

[鳌太万象]
1. （其他人物之间的互动）
2. （天气变化）
3. （路线或物资线索）
4. （他人求援等）

[下回选项]
A. （选项文案）
B. （选项文案）
C. （选项文案）
D. （选项文案）

${STATE_MARKER}
{"好感":[{"npc":"林晓雅","delta":3,"因":"你退后让她先过"}],
 "记忆":["D4晚 麦秸岭 你逞强打头阵失败，陈岩当众制止"],
 "伏笔":{"新增":["雾里那两个没跟上来的人影"],"已收":["石缝路标带"]},
 "天气建议":"转北风，夜间可能降雪",
 "去向建议":"水窝子营地",
 "选项":[{"id":"A","类型":"社交","require":{"好感":{"林晓雅":40}},"cost":{"体力":8}},
        {"id":"B","类型":"徒步","require":{"经验":25},"cost":{"体力":14}},
        {"id":"C","类型":"高危","require":{"经验":60,"物品":["rope"]},"cost":{"体力":20}},
        {"id":"D","类型":"徒步","require":{},"cost":{"体力":6}}]}

选项的"类型"只能是 社交 / 徒步 / 高危 三者之一。每个选项都必须申报 require 与 cost。
去向建议只能填当前位置的相邻节点。好感单回合变化不要超过 5，救命级事件可以加 "重大":true 并到 15。`
}

export function buildUserMessage({ state, journal, 既成事实, 最近回合 }) {
  const 近 = (最近回合 || []).slice(-最近回合上限)
  const node = getNode(state.place.nodeId)
  const 在队 = state.party
    .filter((p) => p.在队)
    .map((p) => {
      const npc = getNpc(p.npcId)
      return `${npc ? npc.名称 : p.npcId} ${p.状态}`
    })
    .join('｜')

  const 事实 = 既成事实 && 既成事实.选择
    ? [
        `  玩家选择：${既成事实.选择}`,
        `  判定结果：${既成事实.判定}${既成事实.原因 ? `（${既成事实.原因}）` : ''}`,
        `  已结算：${既成事实.已结算 || '无'}`,
      ].join('\n')
    : '  （开局，尚无玩家选择）'

  return [
    renderJournal(journal),
    '',
    `【最近 ${近.length} 回合原文】`,
    近.length ? 近.join('\n\n---\n\n') : '  （无）',
    '',
    '【本回合既成事实】',
    事实,
    '',
    '【当前状态快照】',
    `  第${state.clock.day}天 ${state.clock.slot}｜${node ? node.名称 : state.place.nodeId} ${state.place.海拔}m｜${state.weather.状态}${state.weather.等级 ? state.weather.等级 + '级' : ''}｜负重 ${state.carry.当前}kg｜现金 ¥${state.money}`,
    `  在队：${在队 || '（独行）'}`,
    `  季节：${state.meta.季节}`,
  ].join('\n')
}

// 尾段崩了时的补救请求：只要 STATE，不重写正文。
export function buildRepairMessage(已生成正文) {
  return `你刚才输出的正文如下：

${已生成正文}

现在请仅输出 ${STATE_MARKER} 及其后的 JSON 对象，不要重复正文，不要输出任何其他段落。`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/prompt.test.js`
Expected: PASS，13 个测试全绿。「快照泄漏了数字好感」那条是硬约束——`buildUserMessage` 里绝不能出现 `p.好感`。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/llm/prompt.js',`。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/llm/prompt.js test/prompt.test.js build.mjs
git commit -m "feat: system prompt 与每回合 user message 组装"
```

---

### Task 16: API 客户端

**Files:**
- Create: `src/llm/client.js`
- Modify: `build.mjs`
- Test: `test/client.test.js`

OpenAI 兼容三件套 + SSE 流式 + 退避重试（spec 第 9、12 节）。`fetch` 与 `sleep` 都做成可注入，这样不碰网络就能测全部逻辑。**CORS 错误必须和 key 错误分开报**——这是最容易让人一头雾水的错。

- [ ] **Step 1: 写失败的测试**

`test/client.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRESETS, classifyError, feedSSE, backoffDelay, streamChat, MAX_RETRY,
} from '../src/llm/client.js'

const 配置 = { baseURL: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'test-model' }

function sse(...chunks) {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')
}
const 结束 = 'data: [DONE]\n\n'
const 增量 = (t) => ({ choices: [{ delta: { content: t } }] })

function 假响应(body, { ok = true, status = 200 } = {}) {
  const bytes = new TextEncoder().encode(body)
  let 发过 = false
  return {
    ok, status,
    text: async () => body,
    body: {
      getReader: () => ({
        read: async () => (发过 ? { done: true } : ((发过 = true), { done: false, value: bytes })),
        releaseLock: () => {},
      }),
    },
  }
}

test('预设至少含 DeepSeek，且都带 baseURL 与默认模型', () => {
  assert.ok(PRESETS.length >= 4)
  assert.ok(PRESETS.some((p) => /deepseek/i.test(p.id)))
  for (const p of PRESETS) {
    assert.ok(p.id && p.名称 && p.baseURL && p.默认模型, `预设不完整: ${p.id}`)
    assert.ok(p.baseURL.startsWith('https://'), `预设应走 https: ${p.id}`)
  }
})

test('错误分类：401/403 是 key 问题', () => {
  assert.equal(classifyError(null, { ok: false, status: 401 }).kind, 'auth')
  assert.equal(classifyError(null, { ok: false, status: 403 }).kind, 'auth')
})

test('错误分类：429 与 5xx 可重试', () => {
  assert.equal(classifyError(null, { ok: false, status: 429 }).可重试, true)
  assert.equal(classifyError(null, { ok: false, status: 500 }).可重试, true)
  assert.equal(classifyError(null, { ok: false, status: 503 }).可重试, true)
})

test('错误分类：400 不可重试', () => {
  assert.equal(classifyError(null, { ok: false, status: 400 }).可重试, false)
})

test('错误分类：浏览器的 TypeError: Failed to fetch 判为 CORS，且提示换厂商', () => {
  const e = classifyError(new TypeError('Failed to fetch'), null)
  assert.equal(e.kind, 'cors')
  assert.equal(e.可重试, false)
  assert.ok(e.提示.includes('跨域') || e.提示.includes('CORS'))
  assert.ok(e.提示.includes('代理') || e.提示.includes('厂商'))
})

test('错误分类：CORS 与 auth 的提示文案不同', () => {
  const cors = classifyError(new TypeError('Failed to fetch'), null).提示
  const auth = classifyError(null, { ok: false, status: 401 }).提示
  assert.notEqual(cors, auth)
  assert.ok(auth.includes('key') || auth.includes('密钥'))
})

test('错误分类：AbortError 判为超时且可重试', () => {
  const err = new Error('aborted')
  err.name = 'AbortError'
  assert.equal(classifyError(err, null).kind, 'timeout')
  assert.equal(classifyError(err, null).可重试, true)
})

test('退避延迟随次数递增且有上限', () => {
  assert.ok(backoffDelay(0) < backoffDelay(1))
  assert.ok(backoffDelay(1) < backoffDelay(2))
  assert.ok(backoffDelay(10) <= 30000)
})

test('SSE 累积解析：完整帧取出内容，半帧留在缓冲里', () => {
  const a = feedSSE('', 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"cho')
  assert.deepEqual(a.deltas, ['你'])
  assert.ok(a.rest.startsWith('data: {"cho'))
  assert.equal(a.done, false)

  const b = feedSSE(a.rest, 'ices":[{"delta":{"content":"好"}}]}\n\n')
  assert.deepEqual(b.deltas, ['好'])
})

test('SSE 认出 [DONE]', () => {
  assert.equal(feedSSE('', 结束).done, true)
})

test('SSE 忽略空 delta、注释行与畸形 JSON', () => {
  const r = feedSSE('', ': keep-alive\n\ndata: {坏掉的\n\ndata: {"choices":[{"delta":{}}]}\n\ndata: {"choices":[{"delta":{"content":"甲"}}]}\n\n')
  assert.deepEqual(r.deltas, ['甲'])
})

test('streamChat 拼出完整文本并逐块回调', () => {
  const 收到 = []
  const fakeFetch = async () => 假响应(sse(增量('刃脊'), 增量('上的'), 增量('三十米')) + 结束)
  return streamChat({
    config: 配置, messages: [{ role: 'user', content: 'x' }],
    onDelta: (d) => 收到.push(d), fetchImpl: fakeFetch,
  }).then((r) => {
    assert.equal(r.text, '刃脊上的三十米')
    assert.deepEqual(收到, ['刃脊', '上的', '三十米'])
  })
})

test('streamChat 带上 Authorization 头与正确的 URL', async () => {
  let 抓到 = null
  await streamChat({
    config: 配置, messages: [{ role: 'user', content: 'x' }],
    fetchImpl: async (url, init) => ((抓到 = { url, init }), 假响应(sse(增量('甲')) + 结束)),
  })
  assert.equal(抓到.url, 'https://api.example.com/v1/chat/completions')
  assert.equal(抓到.init.headers.Authorization, 'Bearer sk-test')
  const body = JSON.parse(抓到.init.body)
  assert.equal(body.model, 'test-model')
  assert.equal(body.stream, true)
})

test('baseURL 结尾多个斜杠也能拼对', async () => {
  let 抓到 = null
  await streamChat({
    config: { ...配置, baseURL: 'https://api.example.com/v1///' },
    messages: [{ role: 'user', content: 'x' }],
    fetchImpl: async (url) => ((抓到 = url), 假响应(sse(增量('甲')) + 结束)),
  })
  assert.equal(抓到, 'https://api.example.com/v1/chat/completions')
})

test('429 会重试并最终成功', async () => {
  let 次数 = 0
  const r = await streamChat({
    config: 配置, messages: [], sleepImpl: async () => {},
    fetchImpl: async () => {
      次数++
      if (次数 < 3) return 假响应('rate limited', { ok: false, status: 429 })
      return 假响应(sse(增量('终于好了')) + 结束)
    },
  })
  assert.equal(次数, 3)
  assert.equal(r.text, '终于好了')
})

test(`重试到第 ${MAX_RETRY} 次仍失败则抛出带分类的错误`, async () => {
  let 次数 = 0
  await assert.rejects(
    streamChat({
      config: 配置, messages: [], sleepImpl: async () => {},
      fetchImpl: async () => ((次数++), 假响应('boom', { ok: false, status: 500 })),
    }),
    (e) => e.kind === 'server' || e.可重试 === true
  )
  assert.equal(次数, MAX_RETRY)
})

test('401 不重试，立刻抛出', async () => {
  let 次数 = 0
  await assert.rejects(
    streamChat({
      config: 配置, messages: [], sleepImpl: async () => {},
      fetchImpl: async () => ((次数++), 假响应('bad key', { ok: false, status: 401 })),
    }),
    (e) => e.kind === 'auth'
  )
  assert.equal(次数, 1)
})

test('CORS 类错误不重试', async () => {
  let 次数 = 0
  await assert.rejects(
    streamChat({
      config: 配置, messages: [], sleepImpl: async () => {},
      fetchImpl: async () => { 次数++; throw new TypeError('Failed to fetch') },
    }),
    (e) => e.kind === 'cors'
  )
  assert.equal(次数, 1)
})

test('缺 apiKey 时直接报错，不发请求', async () => {
  let 发了 = false
  await assert.rejects(
    streamChat({ config: { ...配置, apiKey: '' }, messages: [], fetchImpl: async () => ((发了 = true), 假响应('')) }),
    (e) => e.kind === 'config'
  )
  assert.equal(发了, false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/client.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/llm/client.js`：

```js
export const MAX_RETRY = 3

// 只收录已验证可从浏览器直连（放开 CORS）的厂商。
export const PRESETS = [
  { id: 'deepseek', 名称: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', 默认模型: 'deepseek-chat' },
  { id: 'siliconflow', 名称: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', 默认模型: 'deepseek-ai/DeepSeek-V3' },
  { id: 'moonshot', 名称: '月之暗面 Kimi', baseURL: 'https://api.moonshot.cn/v1', 默认模型: 'moonshot-v1-8k' },
  { id: 'zhipu', 名称: '智谱', baseURL: 'https://open.bigmodel.cn/api/paas/v4', 默认模型: 'glm-4-plus' },
  { id: 'openrouter', 名称: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', 默认模型: 'deepseek/deepseek-chat' },
]

// 把各种失败归类。CORS 和 key 错误必须分开——两者的解决办法完全不同，
// 混在一起报「请求失败」会让玩家改半天 key 也没用。
export function classifyError(err, response) {
  if (err) {
    if (err.name === 'AbortError') {
      return { kind: 'timeout', 可重试: true, 提示: '请求超时，正在重试。' }
    }
    // 浏览器把跨域拦截也报成 TypeError: Failed to fetch，拿不到更多信息
    if (err instanceof TypeError) {
      return {
        kind: 'cors', 可重试: false,
        提示: '请求被浏览器拦下了（跨域 CORS，或网络不通）。这家厂商可能不允许网页直连——换一个预设厂商，或自己起一个本地代理。',
      }
    }
    return { kind: 'network', 可重试: true, 提示: `网络错误：${err.message}` }
  }

  const status = response ? response.status : 0
  if (status === 401 || status === 403) {
    return { kind: 'auth', 可重试: false, 提示: 'API key 无效或没有权限，请检查密钥是否填错、是否已欠费。' }
  }
  if (status === 429) {
    return { kind: 'rate', 可重试: true, 提示: '触发限流，正在退避重试。' }
  }
  if (status >= 500) {
    return { kind: 'server', 可重试: true, 提示: `服务端错误 ${status}，正在重试。` }
  }
  return { kind: 'request', 可重试: false, 提示: `请求被拒绝（${status}），请检查模型名与 baseURL。` }
}

export function backoffDelay(attempt) {
  return Math.min(30000, 500 * Math.pow(2, attempt))
}

// 增量喂入 SSE 文本。返回本次取出的内容片段、是否结束、以及留待下次的半帧。
export function feedSSE(buffer, chunk) {
  const 全 = buffer + chunk
  const 帧 = 全.split('\n\n')
  const rest = 帧.pop()
  const deltas = []
  let done = false

  for (const f of 帧) {
    for (const line of f.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') { done = true; continue }
      try {
        const obj = JSON.parse(payload)
        const d = obj?.choices?.[0]?.delta?.content
        if (typeof d === 'string' && d) deltas.push(d)
      } catch {
        // 畸形帧直接跳过——流里偶尔会有半个 JSON，不值得中断整轮
      }
    }
  }
  return { deltas, rest, done }
}

function 拼接URL(baseURL) {
  return `${baseURL.replace(/\/+$/, '')}/chat/completions`
}

function 造错误(info) {
  const e = new Error(info.提示)
  Object.assign(e, info)
  return e
}

export async function streamChat({
  config, messages, onDelta,
  fetchImpl = globalThis.fetch, sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)),
  signal,
}) {
  if (!config || !config.apiKey) {
    throw 造错误({ kind: 'config', 可重试: false, 提示: '还没填 API key。' })
  }

  let 最后错误 = null

  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    let response = null
    try {
      response = await fetchImpl(拼接URL(config.baseURL), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          temperature: config.temperature ?? 0.8,
          max_tokens: config.maxTokens ?? 2048,
        }),
        signal,
      })
    } catch (err) {
      const info = classifyError(err, null)
      最后错误 = 造错误(info)
      if (!info.可重试) throw 最后错误
      await sleepImpl(backoffDelay(attempt))
      continue
    }

    if (!response.ok) {
      const info = classifyError(null, response)
      最后错误 = 造错误(info)
      if (!info.可重试) throw 最后错误
      await sleepImpl(backoffDelay(attempt))
      continue
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const r = feedSSE(buffer, decoder.decode(value, { stream: true }))
        buffer = r.rest
        for (const d of r.deltas) {
          text += d
          if (onDelta) onDelta(d)
        }
        if (r.done) break
      }
    } finally {
      reader.releaseLock()
    }

    return { text }
  }

  throw 最后错误 || 造错误({ kind: 'network', 可重试: true, 提示: '请求失败。' })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/client.test.js`
Expected: PASS，19 个测试全绿

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/llm/client.js',`。

Run: `npm test`
Expected: PASS，全部 16 个测试文件全绿

- [ ] **Step 6: 提交**

```bash
git add src/llm/client.js test/client.test.js build.mjs
git commit -m "feat: OpenAI 兼容客户端，SSE 流式与错误分类"
```

---

### Task 17: 回合编排与原子应用

> **来自 T7 / T9 评审的三条预警，本任务是它们的落点：**
>
> 1. **`restore` 返回新对象，不原地改。** 回滚必须写成 `s = restore(snap)`。若别处还持有旧的 `s` 引用（比如传进了某个闭包），那些引用仍指向脏状态。
> 2. **海拔有两个真相来源。** `sleep()` 按 `getNode(place.nodeId).海拔` 判是否累计高山适应，而 `stepStaminaCost()` 直接读 `place.海拔`。移动玩家时**两者必须同时更新**，否则会出现「按老节点算适应、按新海拔算消耗」的错位。建议移动统一走一个 helper。
> 3. **`rest` / `eatHot` / `eatCold` 不推进时钟。** 它们只改体力和物资，`advanceSlot` 要由本任务显式调用。spec 写的「休整消耗一个时段」是在这里兑现的。


**Files:**
- Create: `src/turn.js`
- Modify: `build.mjs`
- Test: `test/turn.test.js`

这是把前面所有零件串起来的地方，也是 spec 第 9 节那条铁律的**唯一落点**：

> 任何 LLM 故障都不能损坏 state。结算是原子的——全套校验通过才一次性应用；每回合开始前打快照，出错回滚。

`buildRepairMessage`（Task 15）也在这里被调用。放在 `src/turn.js` 而不是 `engine/` 下，是为了守住「engine 不依赖 llm」的边界。

流程：打快照 → 判定 → 扣硬资源 → 请求 → 解析 → 尾段崩了就补救重试 → 仍失败则降级 → 校验 → 原子应用 → 查结局。

- [ ] **Step 1: 写失败的测试**

`test/turn.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTurn, FALLBACK_OPTIONS, MAX_REPAIR } from '../src/turn.js'
import { createInitialState } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'
import { STATE_MARKER } from '../src/llm/parser.js'

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

test('合法去向被应用，海拔跟着更新', async () => {
  const s = 局面()
  await 跑(s, createJournal())
  assert.equal(s.place.nodeId, 'shuiwozi')
  assert.equal(s.place.海拔, 3100)
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
  const r = await 跑(s, createJournal(), { streamImpl: 假客户端(到终点) })
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- test/turn.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写实现**

`src/turn.js`：

```js
import { snapshot, restore } from './engine/state.js'
import { judgeOption } from './engine/threshold.js'
import { applyStepCost, advanceSlot, dailyUpkeep } from './engine/consume.js'
import { applyAffinityDelta } from './engine/affinity.js'
import { checkEnding, applyEnding } from './engine/ending.js'
import { recordNode, recordEvent, addForeshadow, resolveForeshadow, compressJournal } from './engine/journal.js'
import { getNode } from './data/route.js'
import { buildSystemPrompt, buildUserMessage, buildRepairMessage } from './llm/prompt.js'
import { parseTurn } from './llm/parser.js'
import { validateProposal } from './llm/validate.js'
import { streamChat } from './llm/client.js'

export const MAX_REPAIR = 2

// 尾段彻底解析不出来时的兜底选项。宁可玩法单调，也不能让游戏卡死。
export const FALLBACK_OPTIONS = [
  { id: 'A', 文本: '继续按原计划前进' },
  { id: 'B', 文本: '原地休整，恢复体力' },
  { id: 'C', 文本: '找同伴聊两句' },
  { id: 'D', 文本: '清点装备和剩余补给' },
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
  const snap = snapshot(state)
  const 档案快照 = JSON.stringify(journal)

  try {
    // —— 判定先行 ——
    const 判定 = judgeOption(选中项, state, rng || (() => 0.5))
    const 体力前 = state.pc.体力
    const 日前 = state.clock.day

    applyStepCost(state)
    advanceSlot(state)
    if (state.clock.day !== 日前) dailyUpkeep(state)

    const 既成事实 = {
      选择: `${选中项.id} ${选中项.文本 || ''}`.trim(),
      判定: 判定.outcome === 'success' ? '成功' : '失败',
      原因: 判定.reasons[0] || '',
      已结算: `体力 ${体力前}→${state.pc.体力}｜推进到第${state.clock.day}天${state.clock.slot}`,
    }

    // —— 请求 ——
    const system = buildSystemPrompt()
    const user = buildUserMessage({ state, journal, 既成事实, 最近回合 })
    const { text } = await streamImpl({
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
    for (const m of v.记忆) recordEvent(journal, state.clock, m)
    for (const f of v.伏笔.新增) addForeshadow(journal, f)
    for (const f of v.伏笔.已收) resolveForeshadow(journal, f)

    if (v.去向) {
      state.place.nodeId = v.去向
      state.place.海拔 = getNode(v.去向).海拔
      recordNode(journal, v.去向)
    }
    if (parsed.state.天气建议) {
      state.weather = { 状态: String(parsed.state.天气建议), 等级: state.weather.等级 }
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- test/turn.test.js`
Expected: PASS，21 个测试全绿。**「网络整体失败 → 回滚」和「降级时不结算好感」两条是这个模块存在的全部理由**，它们绿了这个 Task 才算成。

- [ ] **Step 5: 登记进构建顺序并跑全量测试**

`build.mjs` 的 `MODULE_ORDER` 末尾追加 `'src/turn.js',`（它依赖所有模块，必须排最后）。

Run: `npm test`
Expected: PASS，全绿

- [ ] **Step 6: 提交**

```bash
git add src/turn.js test/turn.test.js build.mjs
git commit -m "feat: 回合编排、补救重试、降级与原子回滚"
```

---

### Task 18: 端到端冒烟

**Files:**
- Create: `smoke.mjs`
- Modify: `package.json`（加 smoke 脚本）

这一步**对着真实 API 跑一个完整回合**，验证「判定先行 + 混合协议」这套核心机制到底成不成立。不写自动化测试——它依赖外部服务，属于手动验证。

- [ ] **Step 1: 写冒烟脚本**

`smoke.mjs`：

```js
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
process.exit(关键项.every(([, 过]) => 过) ? 0 : 1)
```

- [ ] **Step 2: 加 npm 脚本**

`package.json` 的 `scripts` 加一行：

```json
"smoke": "node smoke.mjs"
```

- [ ] **Step 3: 跑真实冒烟**

Run: `AOTAI_KEY=你的key npm run smoke`

Expected：流式正文实时打印；末尾五项全 `✓`，进程退出码 0。

**若某项 `✗`，按下表处置——这些都是真实会遇到的情况，不要跳过：**

| 现象 | 处置 |
|---|---|
| 正文不足 200 字 | 模型没吃住「300 字左右」。在 `buildSystemPrompt` 的文风段末尾补一句「正文不得少于 200 字」 |
| 万象不是 4 条 | 在 system prompt 的 `[鳌太万象]` 范例后补「必须正好 4 条」 |
| 选项少于 4 个 | 同上，`[下回选项]` 后补「必须正好 4 个，编号 A/B/C/D」 |
| STATE 缺失 | 说明模型忽略了尾段。把协议说明移到 system prompt 最末尾（越靠后越容易被遵守），并在 user message 末尾加一行提醒 |
| STATE 解析失败 | 看 `解析问题` 的具体报错。若是围栏或全角引号，parser 应已自动修复——没修复说明 Task 13 有遗漏，补测试再修 |
| 校验警告里大量「门槛越界」 | 说明夹取表在起作用，属正常。但若每个选项都被夹，考虑在 system prompt 里直接写出各类型的门槛区间 |

- [ ] **Step 4: 换一家厂商再跑一次**

Run: `AOTAI_KEY=另一家的key npm run smoke siliconflow`

Expected：同样五项全绿。**至少验证两家**——协议遵守度因模型而异，只测一家等于没测。

- [ ] **Step 5: 走 runTurn 再跑一次完整回合**

上面几步是把零件逐个点亮，这一步验证**串起来的那条线**。在 `smoke.mjs` 末尾追加：

```js
// —— 走完整编排再跑一回合，验证判定→请求→解析→校验→原子应用这条线 ——
import { runTurn } from './src/turn.js'

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
```

Run: `AOTAI_KEY=你的key npm run smoke`

Expected：第二段输出显示「✓ 完整链路通」，选项 4 个，好感有变化，档案里事件与伏笔都长了。若显示「△ 走了降级路径」，说明模型在补救请求下仍不给尾段——按 Step 3 表格里「STATE 缺失」那一行处置。

- [ ] **Step 6: 把两次真实返回存成 fixture**

把两次 `smoke` 的完整模型输出分别存到 `test/fixtures/deepseek-turn.txt` 与 `test/fixtures/siliconflow-turn.txt`。这是以后回归的底本——换 parser 实现时拿它们跑一遍就知道有没有破。

- [ ] **Step 7: 提交**

```bash
git add smoke.mjs package.json test/fixtures/
git commit -m "feat: 端到端冒烟脚本与真实响应 fixture"
```

---

## 计划一验收标准

全部完成后应满足：

- `npm test` 全绿，17 个测试文件、约 200 条断言
- `npm run build` 产出 `dist/穿越鳌太线.html`，其中无残留 `import`/`export`
- `npm run smoke` 对**至少两家厂商**五项全绿，且完整编排显示「✓ 完整链路通」
- 引擎侧零 LLM 依赖：`engine/` 下任何文件都不 import `llm/`（唯一的桥是 `src/turn.js`）
- 三条硬约束有测试守着：**发给 LLM 的内容永不含数字好感**（`journal` / `prompt`）、**parser 永不抛异常**、**故障必整体回滚**（`turn`）

## 后续（计划二）

存档 `persist` → 立绘占位 `portraits` → API 配置界面 → 捏人 → 抽卡 → 商店 → 主界面 → 结局页 → 单文件交付与 base64 烘焙 → 12 份 NPC 生图 prompt。

