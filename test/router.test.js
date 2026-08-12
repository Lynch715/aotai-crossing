import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/ui/router.js'

// 极简 DOM 替身：只实现 router 用到的那点接口
function 假元素(id) {
  return { id, className: '', _shown: false,
    classList: {
      add(c) { if (c === 'active') this._n._shown = true },
      remove(c) { if (c === 'active') this._n._shown = false },
    } }
}
function 造() {
  const nodes = {}
  for (const id of ['a', 'b', 'c']) {
    const n = 假元素(id)
    n.classList._n = n
    nodes[id] = n
  }
  return { nodes, find: (id) => nodes[id] }
}

test('切换只让目标屏幕可见', () => {
  const { nodes, find } = 造()
  const r = createRouter(find)
  r.register('a'); r.register('b')
  r.go('a')
  assert.equal(nodes.a._shown, true)
  assert.equal(nodes.b._shown, false)
  r.go('b')
  assert.equal(nodes.a._shown, false)
  assert.equal(nodes.b._shown, true)
})

test('current 反映当前屏幕', () => {
  const { find } = 造()
  const r = createRouter(find)
  r.register('a'); r.register('b')
  assert.equal(r.current(), null)
  r.go('b')
  assert.equal(r.current(), 'b')
})

test('进入屏幕会触发 onEnter，并拿到参数', () => {
  const { find } = 造()
  const r = createRouter(find)
  let 收到 = null
  r.register('a', { onEnter: (arg) => { 收到 = arg } })
  r.go('a', { from: 'test' })
  assert.deepEqual(收到, { from: 'test' })
})

test('切走会触发 onLeave', () => {
  const { find } = 造()
  const r = createRouter(find)
  let 离开了 = false
  r.register('a', { onLeave: () => { 离开了 = true } })
  r.register('b')
  r.go('a'); r.go('b')
  assert.equal(离开了, true)
})

test('去未注册的屏幕会抛出可读的错，而不是静默什么都不做', () => {
  const { find } = 造()
  const r = createRouter(find)
  assert.throws(() => r.go('查无此屏'), /未注册/)
})
