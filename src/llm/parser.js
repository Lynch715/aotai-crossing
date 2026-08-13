export const STATE_MARKER = '<<<STATE>>>'

// 段落标记：半角与全角方括号都认。正则预编译，别在每行上重新构造。
// 尾部 (.*) 是为了接住「标记和首句写在同一行」的情况。
// 模型不一定照抄方括号——实测它会写成 ## 剧情、**剧情**、或干脆「剧情：」。
// 只认一种写法的话，整段会被归进上一个 bucket 里静默消失，
// 出来就是「正文残缺 + 选项为 0 + 掉进降级」。
// 每个段落给一组别名（长的在前，先匹配更具体的）。模型不一定照抄协议名——
// 「鳌太万象」实测会被简写成「万象」，只认全名的话整段静默消失。
const 段落名 = {
  标题: ['剧情标题'],
  剧情: ['剧情', '正文'],
  万象: ['鳌太万象', '万象'],
  选项: ['下回选项', '行动选项', '选项'],
}
// 捕获各修饰件是为了在 切段 里区分「真标记行」与碰巧以段落名开头的正文：
// 「选项摆在眼前」没有括号/井号/星号/冒号、后面又跟着字，不能当标记吃掉。
const SECTIONS = Object.entries(段落名).map(([key, 名组]) => ({
  key,
  正则: new RegExp(`^\\s*(#{1,4}\\s*)?(\\*{1,2})?([\\[【])?\\s*(?:${名组.join('|')})\\s*([\\]】])?(\\*{1,2})?\\s*([:：])?\\s*(.*)$`),
}))

// 把正文按段落标记切开。任何一段缺失都不算致命。
function 切段(text) {
  const lines = text.split('\n')
  const buckets = { 标题: [], 剧情: [], 万象: [], 选项: [], _散: [] }
  let 当前 = '_散'

  for (const line of lines) {
    const trimmed = line.trim()
    let 命中 = null
    for (const s of SECTIONS) {
      const m = trimmed.match(s.正则)
      if (m) {
        const 有修饰 = !!(m[1] || m[2] || m[3] || m[4] || m[5] || m[6])
        const 余下 = m[7].trim()
        // 裸段落名整行独占也算标记（模型常这么写）；但「段落名+后文」必须带
        // 修饰件才算——否则以段落名开头的正常句子会被误吃成标记。
        if (有修饰 || !余下) {
          命中 = { key: s.key, 余下 }
          break
        }
      }
    }
    if (命中) {
      当前 = 命中.key
      // 模型常把首句和段落标记挤在同一行。不收下这截的话，
      // 这一行连同它之后的整段都会被归到上一个 bucket 里静默消失。
      if (命中.余下) buckets[当前].push(命中.余下)
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
    // 标号连全角字母 Ａ-Ｄ 一并认。模型在中文语境下真的会打出全角字母，
    // 只认 ASCII 的话整回合会解析出 0 个选项、直接掉进降级分支。
    // NFKC 把 Ａ 归一成 A，顺带处理 ａ 这类小写全角。
    // 正文首字符不能是分隔符本身，否则「A.」这种半截行会被解析成
    // 文本为「.」的选项，还不进 errors——UI 上就是个标着句点的按钮。
    const m = line.match(/^(?:\*{0,2})([A-Da-dＡ-Ｄａ-ｄ])\s*[.、．)）:：]?\s*([^\s.、．)）:：].*)$/)
    if (m) {
      out.push({ id: m[1].normalize('NFKC').toUpperCase(), 文本: m[2].replace(/\*+$/, '').trim() })
      continue
    }
    // 模型常把选项写成 1. 2. 或 ①②。按出现顺序映射到 A-D——
    // 只认字母的话，这一回合会解析出 0 个选项，直接掉进降级分支。
    const n = line.match(/^(?:\*{0,2})(?:(\d)\s*[.、．)）:：]|([①②③④]))\s*(.+)$/)
    if (n) {
      const 序 = n[1] ? Number(n[1]) : '①②③④'.indexOf(n[2]) + 1
      if (序 >= 1 && 序 <= 4) out.push({ id: 'ABCD'[序 - 1], 文本: n[3].replace(/\*+$/, '').trim() })
    }
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

function 找尾段标记(raw) {
  let 命中 = -1
  let from = 0
  for (;;) {
    const i = raw.indexOf(STATE_MARKER, from)
    if (i === -1) break
    // 行首即可，但要容忍模型加的修饰：**<<<STATE>>>**、### <<<STATE>>>。
    // 只认「前一个字符是换行」的话，一个星号就能让整段结算丢掉。
    const 行首 = raw.lastIndexOf('\n', i - 1) + 1
    const 前缀 = raw.slice(行首, i)
    if (/^[\s*#>-]*$/.test(前缀)) 命中 = i
    from = i + STATE_MARKER.length
  }
  return 命中
}

// 尾段标记之后可能跟着模型加的粗体收尾（**）。只剥这类修饰——
// 反引号要留给 剥围栏 去认，先剥掉会把 ```json 围栏拆散，反而解析不了。
function 剥尾段修饰(s) {
  return s.replace(/^[ \t*#]*/, '')
}

// 解析一整回合的模型输出。约定：本函数永不抛异常，问题一律进 errors。
export function parseTurn(raw) {
  const 结果 = { 标题: '', 剧情: '', 万象: [], 选项: [], state: null, errors: [] }

  if (typeof raw !== 'string' || !raw.trim()) {
    结果.errors.push('模型输出为空或不是字符串')
    return 结果
  }

  // 真正的尾段标记按协议独占一行。只认行首出现的那个，
  // 这样对话里引用的 <<<STATE>>> 和 JSON 字符串值里的 <<<STATE>>> 都不会切错位置。
  // 模型常把整个回复包进一对 ``` 里。不先剥掉的话，尾段 JSON 后面会拖着
  // 一个收尾的 ```，解析必挂。
  raw = 剥围栏(raw)

  const idx = 找尾段标记(raw)
  const 正文 = idx === -1 ? raw : raw.slice(0, idx)
  const 尾段 = idx === -1 ? null : 剥尾段修饰(raw.slice(idx + STATE_MARKER.length))

  const buckets = 切段(正文)

  结果.标题 = buckets.标题.join('\n').trim()
  结果.剧情 = buckets.剧情.join('\n').trim()
  结果.万象 = 提取列表项(buckets.万象)
  结果.选项 = 提取选项(buckets.选项)

  // 剧情段为空但标记前有散落文本——那就是正文，只是模型没写 [剧情] 标记。
  // 此前只在「所有段落全空」时才回收：模型漏掉 [剧情] 却写了万象/选项时
  // （实战里真的发生），正文被静默丢弃，玩家面对一片空白和四个选项。
  if (!结果.剧情) {
    const 散 = buckets._散.join('\n').trim()
    if (散) {
      结果.剧情 = 散
      if (结果.万象.length || 结果.选项.length) {
        结果.errors.push('正文未带 [剧情] 标记，已从散落文本回收')
      }
    }
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
