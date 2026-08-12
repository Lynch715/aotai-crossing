export const MAX_RETRY = 3

// 只收录已验证可从浏览器直连（放开 CORS）的厂商。
// 各家的模型名会过期，且过期后只报一句「模型不存在」，玩家看不出是我们的锅。
// 默认一律选各家的「快而便宜」档——这游戏一局要发几十次请求，每次约 5K 输入。
// 核对日期 2026-08，来源：api-docs.deepseek.com / openrouter.ai/deepseek
// / platform.kimi.com/docs/models / docs.bigmodel.cn。改动前先去这些页面核一遍。
export const PRESETS = [
  { id: 'deepseek', 名称: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', 默认模型: 'deepseek-v4-flash' },
  { id: 'siliconflow', 名称: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1', 默认模型: 'deepseek-ai/DeepSeek-V4-Flash' },
  { id: 'moonshot', 名称: '月之暗面 Kimi', baseURL: 'https://api.moonshot.cn/v1', 默认模型: 'kimi-k3' },
  { id: 'zhipu', 名称: '智谱', baseURL: 'https://open.bigmodel.cn/api/paas/v4', 默认模型: 'glm-4-plus' },
  { id: 'openrouter', 名称: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', 默认模型: 'deepseek/deepseek-v4-flash' },
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
  // finish_reason === 'length' 是「被 max_tokens 截断」的铁证。
  // 不抓它的话，正文缺一半、STATE 没了，只能靠猜。
  let finish = null
  // 有些模型把思考过程放在 reasoning_content，我们不显示它，
  // 但它照样烧 max_tokens——记下长度，好判断预算是不是被思考吃光了。
  let reasoning = 0

  for (const f of 帧) {
    for (const line of f.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') { done = true; continue }
      try {
        const obj = JSON.parse(payload)
        const d = obj?.choices?.[0]?.delta?.content
        if (typeof d === 'string' && d) deltas.push(d)
        const rc = obj?.choices?.[0]?.delta?.reasoning_content
        if (typeof rc === 'string') reasoning += rc.length
        const fr = obj?.choices?.[0]?.finish_reason
        if (fr) finish = fr
      } catch {
        // 畸形帧直接跳过——流里偶尔会有半个 JSON，不值得中断整轮
      }
    }
  }
  return { deltas, rest, done, finish, reasoning }
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
          max_tokens: config.maxTokens ?? 4096,
        }),
        signal,
      })
    } catch (err) {
      const info = classifyError(err, null)
      最后错误 = 造错误(info)
      // 玩家主动取消也走 AbortError，和超时长得一样。信号已经 aborted 就别重试了——
      // 人都走了还退避重试三次，纯属替玩家烧 token。
      if (!info.可重试 || signal?.aborted) throw 最后错误
      await sleepImpl(backoffDelay(attempt))
      continue
    }

    if (!response.ok) {
      const info = classifyError(null, response)
      最后错误 = 造错误(info)
      if (!info.可重试 || signal?.aborted) throw 最后错误
      await sleepImpl(backoffDelay(attempt))
      continue
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let finish = null
    let reasoning = 0

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const r = feedSSE(buffer, decoder.decode(value, { stream: true }))
        buffer = r.rest
        if (r.finish) finish = r.finish
        reasoning += r.reasoning
        for (const d of r.deltas) {
          text += d
          if (onDelta) onDelta(d)
        }
        if (r.done) break
      }
    } finally {
      reader.releaseLock()
    }

    return { text, finish, reasoning }
  }

  throw 最后错误 || 造错误({ kind: 'network', 可重试: true, 提示: '请求失败。' })
}
