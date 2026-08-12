import { ROUTE, getNode, isAdjacent } from '../data/route.js'
import { NPCS, getNpc, PERSONALITY_TAGS } from '../data/npcs.js'
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
 "离队":[{"npc":"王大鹏","因":"膝伤严重，从水窝子下撤"}],
 "说话人":"陈岩",
 "记忆":["D4晚 麦秸岭 你逞强打头阵失败，陈岩当众制止"],
 "伏笔":{"新增":["雾里那两个没跟上来的人影"],"已收":["石缝路标带"]},
 "天气建议":"转北风，夜间可能降雪",
 "去向建议":"水窝子营地",
 "选项":[{"id":"A","类型":"社交","require":{"好感":{"林晓雅":40}},"cost":{"体力":8}},
        {"id":"B","类型":"徒步","require":{"经验":25},"cost":{"体力":14}},
        {"id":"C","类型":"高危","require":{"经验":60,"物品":["rope"]},"cost":{"体力":20}},
        {"id":"D","类型":"徒步","require":{},"cost":{"体力":6}}]}

选项的"类型"只能是 社交 / 徒步 / 高危 三者之一。每个选项都必须申报 require 与 cost。
去向建议只能填当前位置的相邻节点。好感单回合变化不要超过 5，救命级事件可以加 "重大":true 并到 15。
离队只在剧情里真的写了某人离开时才报，沉默或走得慢不算；离队不可逆，报错了收不回来；"因"控制在 30 字以内。
说话人填本回合正文里说话最多的那个队友的名字，没人说话就省略——它决定立绘上谁亮起。
上面所有范例里的人名都只是示例，不是主角。主角是谁见 user message 的【你扮演的人】，正文里必须用那个名字。`
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

  const 性格文案 = (PERSONALITY_TAGS.find((t) => t.id === state.pc.性格) || {}).文案 || state.pc.性格

  // 主角块。此前 user message 里根本没有这一段——模型完全不知道玩家是谁，
  // 只在 system prompt 的范例里见过「陈岩」，于是正文里就管主角叫陈岩。
  // 捏人那一屏填的名字、职业、性格、外貌、技能，此前一个字都没发出去。
  const 主角 = [
    '【你扮演的人】',
    `  ${state.pc.名字}，${state.pc.年龄} 岁${state.pc.性别}，${state.pc.职业}`,
    `  性格：${性格文案}`,
    `  外貌：${state.pc.外貌}`,
    `  技能：${(state.pc.技能 || []).join('、') || '无'}`,
    `  正文里称呼主角一律用「${state.pc.名字}」，或用第二人称「你」。绝不能叫别的名字。`,
  ].join('\n')

  return [
    主角,
    '',
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
    // 把合法去向直接摆出来。不给的话模型只能照着 system prompt 里的完整
    // 路线猜，猜错了被校验拦下——等于让人蒙眼投篮再判他犯规。
    `  可去：${ROUTE.filter((n) => isAdjacent(state.place.nodeId, n.id)).map((n) => n.名称).join('、') || '（无相邻节点）'}`,
    '  「去向建议」只能填上面列出的地点之一；原地不动就省略这个字段。',
    `  季节：${state.meta.季节}`,
  ].join('\n')
}

// 尾段崩了时的补救请求：只要 STATE，不重写正文。
export function buildRepairMessage(已生成正文) {
  return `你刚才输出的正文如下：

${已生成正文}

现在请仅输出 ${STATE_MARKER} 及其后的 JSON 对象，不要重复正文，不要输出任何其他段落。
直接以 ${STATE_MARKER} 开头，前面不要加「好的」「以下是」之类的任何文字。`
}
