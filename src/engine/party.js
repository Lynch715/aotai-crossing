import { updateNpcStatus } from './journal.js'

// 队友状态的唯一改动入口。
//
// 为什么要有这个模块：人物状态在两处各存一份——state.party[].状态 进每回合的
// 状态快照，journal.人物状态 进旅程档案。计划一里没有任何地方写明要同时更新，
// 于是 state 那份永远停在「正常」。改一处漏一处的隐患，靠约定是防不住的，
// 只能靠「只留一个入口」。
export function setNpcStatus(state, journal, npcId, 状态) {
  const 同伴 = state.party.find((p) => p.npcId === npcId)
  if (!同伴) return false
  同伴.状态 = 状态
  updateNpcStatus(journal, npcId, 状态)
  return true
}

// 离队。好感门槛判定只认在队的人，所以这一步必须真的落到 state 上，
// 否则玩家会看到对着已经下撤的人搭话的选项。
export function npcLeaves(state, journal, npcId, 原因) {
  const 同伴 = state.party.find((p) => p.npcId === npcId)
  if (!同伴 || !同伴.在队) return false
  同伴.在队 = false
  同伴.状态 = 原因
  updateNpcStatus(journal, npcId, 原因)
  return true
}

export function activeParty(state) {
  return state.party.filter((p) => p.在队)
}

export function isActive(state, npcId) {
  return state.party.some((p) => p.npcId === npcId && p.在队)
}
