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

test('玩家主动取消后不再重试，不替他烧 token', async () => {
  const ctrl = new AbortController()
  let 调用次数 = 0
  const fake = async () => {
    调用次数++
    ctrl.abort()
    const e = new Error('aborted')
    e.name = 'AbortError'
    throw e
  }
  await assert.rejects(() =>
    streamChat({
      config: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' },
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fake,
      sleepImpl: async () => {},
      signal: ctrl.signal,
    })
  )
  assert.equal(调用次数, 1, `取消后仍重试了 ${调用次数} 次`)
})

test('预设不得使用已下线的模型名', () => {
  // deepseek-chat / deepseek-reasoner 于 2026-07-24 下线；
  // moonshot-v1-* 虽仍可用但已不对新注册用户开放，新玩家会撞墙。
  // 这些名字过期后只报一句「模型不存在」，玩家看不出是我们的锅。
  const 已下线 = ['deepseek-chat', 'deepseek-reasoner', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  for (const p of PRESETS) {
    for (const 死名 of 已下线) {
      assert.notEqual(p.默认模型, 死名, `${p.名称} 用了已下线的模型名 ${死名}`)
      assert.ok(!p.默认模型.endsWith('/' + 死名), `${p.名称} 用了已下线的模型名 ${p.默认模型}`)
    }
  }
})

test('每个预设的 baseURL 都是 https', () => {
  for (const p of PRESETS) {
    assert.ok(p.baseURL.startsWith('https://'), `${p.名称} 的 baseURL 不是 https：${p.baseURL}`)
  }
})

test('feedSSE 抓得到 finish_reason —— 截断的铁证', () => {
  const 帧 = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '甲' }, finish_reason: 'length' }] }) + '\n\n'
  const r = feedSSE('', 帧)
  assert.equal(r.finish, 'length')
})

test('feedSSE 统计推理长度但不显示它', () => {
  const 帧 = 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '我在想……' } }] }) + '\n\n'
  const r = feedSSE('', 帧)
  assert.deepEqual(r.deltas, [], '思考内容不该上屏')
  assert.equal(r.reasoning, 5, '但要记下它烧了多少')
})

test('正常结束时 finish 是 stop 而非 length', () => {
  const 帧 = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '甲' }, finish_reason: 'stop' }] }) + '\n\n'
  assert.equal(feedSSE('', 帧).finish, 'stop')
})
