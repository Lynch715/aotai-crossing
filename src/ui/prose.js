// 剧情文本的纯逻辑。DOM 无关，因此可测。
//
// 为什么要有 splitParagraphs：textContent 会把换行折叠成空格，
// 直接 setText(节点, 剧情) 会让 LLM 分好的段全糊成一坨。
// 解法不是退回 innerHTML（正文是 LLM 写的，注入风险最高的一处），
// 而是按段切开、每段一个 <p>，全程留在 textContent 里。

export const TYPE_CHARS_PER_FRAME = 3

export function splitParagraphs(文本) {
  if (typeof 文本 !== 'string') return []
  return 文本
    .split(/\n\s*\n/)
    .map((段) => 段.trim().replace(/\s*\n\s*/g, ' '))
    .filter((段) => 段.length > 0)
}

// 打字机队列。流式分块是忽快忽慢的——有时一次来 50 字，直接上屏会一顿一顿。
// 这个队列把网络来的内容存起来，由渲染层按固定节奏匀速抽出，显示就稳了。
//
// 不做「拿完整文本切帧」那种设计：live 路径由 onDelta 驱动，而存档里不保存
// 正文（packSave 只存 state 与 journal），根本没有重放这条路——那样的函数
// 会没有调用方。这个项目已经出过三次「写了但没人调」了。
export function createTypewriter(每帧字数 = TYPE_CHARS_PER_FRAME) {
  let 缓冲 = ''
  let 已出 = 0
  return {
    push(块) {
      if (typeof 块 === 'string') 缓冲 += 块
    },
    // 抽一帧：返回本帧应显示的全文；没有新内容则返回 null，渲染层据此停表
    tick() {
      if (已出 >= 缓冲.length) return null
      已出 = Math.min(缓冲.length, 已出 + 每帧字数)
      return 缓冲.slice(0, 已出)
    },
    done() {
      return 已出 >= 缓冲.length
    },
    // 玩家点「跳过」时一次吐完
    flush() {
      已出 = 缓冲.length
      return 缓冲
    },
    text() {
      return 缓冲
    },
  }
}
