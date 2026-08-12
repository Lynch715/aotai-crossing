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

// 打字机的帧序列。一字一帧会让 300 字的正文拖上十几秒，
// 按每帧固定字数推进，长短文的节奏才一致。
export function typewriterFrames(文本) {
  if (typeof 文本 !== 'string' || !文本) return []
  const 帧 = []
  for (let i = TYPE_CHARS_PER_FRAME; i < 文本.length; i += TYPE_CHARS_PER_FRAME) {
    帧.push(文本.slice(0, i))
  }
  帧.push(文本)
  return 帧
}
