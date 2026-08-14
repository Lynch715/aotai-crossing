import { getNode } from '../data/route.js'

function 文本(value, max = 12000) {
  return String(value || '').trim().slice(0, max)
}

function 字符串组(value, maxEach = 1000) {
  return Array.isArray(value) ? value.map((x) => 文本(x, maxEach)).filter(Boolean) : []
}

export function storyPoint(state) {
  const node = getNode(state?.place?.nodeId)
  return {
    day: Number(state?.clock?.day || 1),
    slot: state?.clock?.slot || '早',
    nodeId: state?.place?.nodeId || '',
    地点: node?.名称 || state?.place?.nodeId || '未知地点',
    海拔: Number(state?.place?.海拔 || node?.海拔 || 0),
  }
}

export function makeTurnStoryEntry({ 序号, 开始, 结束, 选中项, 回合 }) {
  const 判定 = 回合?.判定?.outcome === 'success' ? '成功'
    : 回合?.判定?.outcome === 'fail' ? '失败' : '—'
  return {
    序号,
    类型: '剧情回合',
    开始,
    结束,
    选择: { id: 文本(选中项?.id, 80), 文本: 文本(选中项?.文本 || 选中项?.id, 300), 类型: 文本(选中项?.类型, 80) },
    判定,
    标题: 文本(回合?.标题, 300),
    剧情: 文本(回合?.剧情, 8000),
    万象: 字符串组(回合?.万象),
    生存提示: 字符串组(回合?.生存提示),
    warnings: 字符串组(回合?.warnings, 2000),
    降级: !!回合?.降级,
    原始回复: 文本(回合?.原文, 16000),
  }
}

export function makeActionStoryEntry({ 序号, 开始, 结束, 动作, 反馈, 类型 = '途中行动' }) {
  return {
    序号,
    类型,
    开始,
    结束,
    选择: { id: '', 文本: 文本(动作, 300), 类型: '原生操作' },
    判定: '完成',
    标题: 文本(动作, 300),
    剧情: 文本(反馈 || 动作, 3000),
    万象: [],
    生存提示: [],
    warnings: [],
    降级: false,
    原始回复: '',
  }
}

function 点位文案(point) {
  if (!point) return '时间地点不详'
  return `第${point.day}天${point.slot}｜${point.地点} ${point.海拔}m`
}

export function formatStoryLog(entries, state, { debug = false, journal = null } = {}) {
  const 列表 = Array.isArray(entries) ? entries : []
  const lines = [
    '《穿越鳌太线》完整旅程',
    `角色：${state?.pc?.名字 || '未命名'}｜季节：${state?.meta?.季节 || '未知'}｜记录 ${列表.length} 条`,
    '',
  ]

  if (!列表.length) lines.push('旅程尚未开始。完成第一个选择后，这里会逐回合记录。')
  for (const e of 列表) {
    lines.push(`【${e.序号 || '?'}｜${e.类型 || '旅程记录'}】${e.标题 || e.选择?.文本 || ''}`)
    lines.push(`${点位文案(e.开始)} → ${点位文案(e.结束)}`)
    if (e.选择?.文本) lines.push(`你的选择：${e.选择.文本}${e.判定 ? `（${e.判定}）` : ''}`)
    if (e.剧情) lines.push(e.剧情)
    if (e.生存提示?.length) lines.push(`生存结算：${e.生存提示.join('；')}`)
    if (e.万象?.length) lines.push(`万象：${e.万象.join('；')}`)
    if (debug && e.warnings?.length) lines.push(`校验警告：${e.warnings.join('；')}`)
    if (debug && e.原始回复) lines.push(`模型原始回复：\n${e.原始回复}`)
    lines.push('')
  }

  if (debug) {
    lines.push('=== 当前游戏状态 ===')
    lines.push(JSON.stringify(state || {}, null, 2))
    lines.push('=== 旅程档案 ===')
    lines.push(JSON.stringify(journal || {}, null, 2))
  }
  return lines.join('\n').trim()
}
