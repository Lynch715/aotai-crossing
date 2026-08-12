// DOM 工具。全项目的渲染安全基线都在这里。
//
// 铁律：动态数据只能经 setText 落地（内部用 textContent），
// 绝不允许拼进 innerHTML。上屏内容里有 LLM 写的正文，而玩家的
// API key 就在同源 localStorage 里——一段被注入的 onerror 就能把它送走。
// 模型不需要有恶意，复读了脏数据就够。test/dom.test.js 有一条护栏扫描全目录。

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function esc(v) {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = String(v)
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, String(v))
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function setText(node, v) {
  node.textContent = v === null || v === undefined ? '' : String(v)
  return node
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
  return node
}

export function on(root, selector, event, handler) {
  root.addEventListener(event, (e) => {
    const hit = e.target.closest(selector)
    if (hit && root.contains(hit)) handler(e, hit)
  })
}

export function $(sel, root = document) {
  return root.querySelector(sel)
}
