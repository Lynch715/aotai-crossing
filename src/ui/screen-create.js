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

// 这些字段会逐字进入每一次 LLM 请求。不设上限的话，一段几千字的「外貌」
// 会让此后每个回合的 prompt 都跟着膨胀，玩家每轮都为它付钱。
const CREATE_LIMITS = { 名字: 12, 职业: 20, 外貌: 60, 技能项: 12 }

export function validateDraft(draft) {
  const 问题 = []
  if (!String(draft.名字 || '').trim()) 问题.push('名字还没填')
  else if (String(draft.名字).length > CREATE_LIMITS.名字) 问题.push(`名字不能超过 ${CREATE_LIMITS.名字} 字`)
  if (!String(draft.职业 || '').trim()) 问题.push('职业还没填')
  else if (String(draft.职业).length > CREATE_LIMITS.职业) 问题.push(`职业不能超过 ${CREATE_LIMITS.职业} 字`)
  if ((draft.技能 || []).some((s) => String(s).length > CREATE_LIMITS.技能项)) {
    问题.push(`单个技能不能超过 ${CREATE_LIMITS.技能项} 字`)
  }
  const 年龄 = Number(draft.年龄)
  if (!Number.isFinite(年龄) || 年龄 < 16 || 年龄 > 70) 问题.push('年龄要在 16 到 70 之间')
  if (!['男', '女'].includes(draft.性别)) 问题.push('还没选性别')
  if (!PERSONALITY_TAGS.some((t) => t.id === draft.性格)) 问题.push('还没选性格')
  if (!String(draft.外貌 || '').trim()) 问题.push('外貌还没填')
  else if (String(draft.外貌).length > CREATE_LIMITS.外貌) 问题.push(`外貌不能超过 ${CREATE_LIMITS.外貌} 字`)
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
