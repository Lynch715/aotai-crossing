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
