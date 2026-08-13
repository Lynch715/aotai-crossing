import { getNode } from '../data/route.js'

export const FINE_AMOUNT = 5000

const 重伤致命天数 = 2
const 失温连败上限 = 3
const 终点节点 = 'xiabansi'

// 判定顺序即优先级：人先没了，就轮不到救援与穿越。
export function checkEnding(state) {
  if (state.pc.体力 <= 0) {
    return { type: '失败遇险', 原因: '体力耗尽，再也走不动了' }
  }

  const 致命伤 = (state.pc.伤病 || []).find(
    (w) => w.严重度 === '重' && !w.已处理 && state.clock.day - w.起始day >= 重伤致命天数
  )
  if (致命伤) {
    return { type: '失败遇险', 原因: `${致命伤.名称}拖了两天没处理` }
  }

  if ((state.flags.失温连败 || 0) >= 失温连败上限) {
    return { type: '失败遇险', 原因: '连续失温，体温再也提不上来' }
  }
  if (state.pc.体温 === '严重失温') {
    return { type: '失败遇险', 原因: '严重失温，已经无法继续行动' }
  }
  if (state.pc.高反 === '重度' && state.place.海拔 >= 3400) {
    return { type: '失败遇险', 原因: '重度高反，在高海拔无法继续行动' }
  }

  if (state.flags.已求救) {
    return { type: '被救援', 原因: '发出了求救信号，等来了救援队' }
  }

  // 走到备用下撤点＝主动放弃，游戏同样结束。不认这条的话，从核桃坪或嵩坪寺
  // 出山的玩家会卡在「叙事上已结束、引擎却一直返回 null」的死循环里。
  const 当前节点 = getNode(state.place.nodeId)
  if (当前节点 && 当前节点.类型 === '下撤') {
    return { type: '主动下撤', 原因: `从${当前节点.名称}下撤出山，没走完全程` }
  }

  if (state.place.nodeId === 终点节点) {
    return { type: '成功穿越', 原因: '走到了下板寺', 罚款: FINE_AMOUNT }
  }

  return null
}

export function applyEnding(state, ending) {
  if (!ending) return state
  // 幂等：重复调用不会再扣一次罚款。T17 重试回合时可能二次触发。
  if (state.phase === '结局') return state
  state.phase = '结局'
  state.ending = ending
  if (ending.type === '成功穿越') {
    state.money = Math.max(0, state.money - FINE_AMOUNT)
  }
  return state
}
