import { STATE_VERSION } from '../engine/state.js'

const SAVE_PREFIX = 'aotai_save_'

export const SAVE_SLOTS = [
  { id: 'auto', 名称: '自动存档', 自动: true },
  { id: 'slot1', 名称: '存档 1', 自动: false },
  { id: 'slot2', 名称: '存档 2', 自动: false },
  { id: 'slot3', 名称: '存档 3', 自动: false },
]

export function saveKey(slotId) {
  return SAVE_PREFIX + slotId
}

// 摘要单独存一份，槽位列表就不必解开全量状态——存档大了以后这一点会明显。
function 造摘要(state) {
  return `${state.pc.名字}｜${state.meta.季节}｜第${state.clock.day}天${state.clock.slot}｜${state.place.nodeId}`
}

// 最近回合也入档——它是剧情连贯性的命脉。只存 state+journal 的话，
// 刷新页面后模型拿不到上文，故事必然从中间断档另起炉灶。
export function packSave(state, journal, 最近回合 = []) {
  return JSON.stringify({
    版本: STATE_VERSION,
    摘要: 造摘要(state),
    state,
    journal,
    最近回合,
  })
}

export function unpackSave(文本) {
  const 包 = JSON.parse(文本)
  return { state: 包.state, journal: 包.journal, 最近回合: 包.最近回合 || [], 摘要: 包.摘要, 版本: 包.版本 }
}

// 版本迁移。比当前版本低的按需补字段；比当前版本高的一律拒绝——
// 硬吃一个未来格式的存档，坏法会非常隐蔽。
export function migrateSave(包) {
  if (typeof 包?.版本 !== 'number') {
    return { 可用: false, 原因: '存档缺版本号，无法判断格式' }
  }
  if (包.版本 > STATE_VERSION) {
    return { 可用: false, 原因: `存档版本 ${包.版本} 高于当前 ${STATE_VERSION}，可能来自更新的版本` }
  }
  if (包.版本 === STATE_VERSION) return { 可用: true, 迁移过: false, 包 }
  const 新 = JSON.parse(JSON.stringify(包))
  // v1 → v2：飞机梁/金字塔/九重石海拆成了分段节点，老档的位置与足迹
  // 映射到对应首段；flags 补 最低体力。不迁移的话，老档会站在一个
  // 已经不存在的节点上，相邻判定全灭、原地卡死。
  if (新.版本 < 2) {
    const 改名 = { feijiliang: 'feijiliang1', jinzita: 'jinzita1', jiuchongshihai: 'jiuchongshihai1' }
    if (新.state?.place && 改名[新.state.place.nodeId]) 新.state.place.nodeId = 改名[新.state.place.nodeId]
    if (Array.isArray(新.journal?.已过节点)) {
      新.journal.已过节点 = 新.journal.已过节点.map((id) => 改名[id] || id)
    }
    if (新.state?.flags && typeof 新.state.flags.最低体力 !== 'number') {
      新.state.flags.最低体力 = 新.state.pc?.体力 ?? 100
    }
  }
  // v2 → v3：旧路线中的隐藏子节点映射到新的决策节点；补风险记账字段。
  if (新.版本 < 3) {
    const 改名 = {
      yaowangdong: 'aoshan',
      feijiliang2: 'feijiliang1',
      jinzita2: 'jinzita1', jinzita3: 'jinzita1', xiyuan: 'jinzita1',
      jiuchongshihai1: 'jiuchongshihai2', jiuchongshihai3: 'jiuchongshihai2',
      leigongmiao: 'wanxianzhen', dongpaomaliang: 'wanxianzhen',
    }
    if (新.state?.place && 改名[新.state.place.nodeId]) {
      新.state.place.nodeId = 改名[新.state.place.nodeId]
    }
    if (Array.isArray(新.journal?.已过节点)) {
      新.journal.已过节点 = 新.journal.已过节点.map((id) => 改名[id] || id)
    }
    if (新.state?.flags) {
      if (typeof 新.state.flags.迷路次数 !== 'number') 新.state.flags.迷路次数 = 0
      if (typeof 新.state.flags.恶劣天气暴露次数 !== 'number') 新.state.flags.恶劣天气暴露次数 = 0
    }
  }
  新.版本 = STATE_VERSION
  return { 可用: true, 迁移过: true, 包: 新 }
}

export function writeSave(storage, slotId, state, journal, 最近回合 = []) {
  try {
    storage.setItem(saveKey(slotId), packSave(state, journal, 最近回合))
    return true
  } catch (err) {
    // 配额满时 setItem 抛 QuotaExceededError。无条件返回 true 是撒谎——
    // 调用方以为存上了，玩家的一整趟就这么没了。返回 false 让 UI 能报出来。
    return false
  }
}

export function readSave(storage, slotId) {
  const 原文 = storage.getItem(saveKey(slotId))
  if (!原文) return null
  try {
    const 包 = JSON.parse(原文)
    const r = migrateSave(包)
    if (!r.可用) return null
    return unpackSave(JSON.stringify(r.包))
  } catch {
    // 坏档不该拖垮整个应用，当空槽处理
    return null
  }
}

export function deleteSave(storage, slotId) {
  storage.removeItem(saveKey(slotId))
}

export function listSaves(storage) {
  return SAVE_SLOTS.map((槽) => {
    const 原文 = storage.getItem(saveKey(槽.id))
    if (!原文) return { ...槽, 占用: false, 摘要: '' }
    try {
      const 包 = JSON.parse(原文)
      return { ...槽, 占用: true, 摘要: String(包.摘要 || ''), 版本: 包.版本 }
    } catch {
      return { ...槽, 占用: true, 摘要: '（存档已损坏）', 损坏: true }
    }
  })
}
