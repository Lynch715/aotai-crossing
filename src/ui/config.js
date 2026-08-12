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
  // 视图模型里不放明文 key。渲染层只需要 model/baseURL 这些，
  // 而 vm 一旦被 console.log 或序列化上屏，key 就跟着出去了。
  // 要存盘时用会话里的完整 config，不要从 vm 里取。
  const { apiKey, ...展示用配置 } = c
  return {
    config: 展示用配置,
    有key: !!apiKey,
    预设: PRESETS.map((p) => ({ id: p.id, 名称: p.名称, baseURL: p.baseURL, 默认模型: p.默认模型, 选中: p.id === c.presetId })),
    key脱敏: 脱敏(c.apiKey),
    可用: v.ok,
    问题: v.问题,
  }
}
