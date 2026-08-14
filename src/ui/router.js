// 极简屏幕路由。find 是取节点的函数，注入进来是为了能在没有 DOM 的测试里跑。
export function createRouter(find) {
  const 屏幕 = new Map()
  let 当前 = null

  return {
    register(id, hooks = {}) {
      屏幕.set(id, hooks)
    },
    current() {
      return 当前
    },
    go(id, arg) {
      if (!屏幕.has(id)) throw new Error(`屏幕未注册：${id}`)
      if (当前 !== null) {
        const 旧 = find(当前)
        if (旧) 旧.classList.remove('active')
        const h = 屏幕.get(当前)
        if (h && h.onLeave) h.onLeave()
      }
      当前 = id
      const 新 = find(id)
      if (新) 新.classList.add('active')
      const h = 屏幕.get(id)
      if (h && h.onEnter) h.onEnter(arg)
      // 每个 screen 都是一张独立页面。采购页很长，如果切到徒步页仍保留原滚动
      // 位置，玩家会直接落在剧情底部，刚新增的路线图反而完全看不到。
      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') window.scrollTo(0, 0)
    },
  }
}
