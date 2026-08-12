import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SAVE_SLOTS, saveKey, packSave, unpackSave, migrateSave, listSaves, writeSave, readSave, deleteSave } from '../src/ui/save.js'
import { createInitialState, STATE_VERSION } from '../src/engine/state.js'
import { createJournal } from '../src/engine/journal.js'

function 假存储() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

function 局面() {
  const s = createInitialState({
    种子: 7, 季节: '秋季',
    pc: { 名字: '周野', 职业: '工程师', 年龄: 28, 性别: '男', 性格: 'renside',
          外貌: '偏瘦', 技能: [], 户外经验: 38 },
    队友: [{ npcId: 'chenyan', 好感: 45 }], 背包: [], 金钱: 4320,
  })
  return { state: s, journal: createJournal() }
}

test('槽位有 3 个手动加 1 个自动', () => {
  assert.equal(SAVE_SLOTS.filter((s) => s.自动).length, 1)
  assert.equal(SAVE_SLOTS.filter((s) => !s.自动).length, 3)
})

test('打包再解包，状态与档案原样回来', () => {
  const { state, journal } = 局面()
  const 回来 = unpackSave(packSave(state, journal))
  assert.equal(回来.state.pc.名字, '周野')
  assert.equal(回来.state.money, 4320)
  assert.deepEqual(回来.journal.关键事件, [])
})

test('存档带版本号与摘要，槽位列表不用解全量就能显示', () => {
  const { state, journal } = 局面()
  const 包 = JSON.parse(packSave(state, journal))
  assert.equal(包.版本, STATE_VERSION)
  assert.ok(包.摘要.includes('周野'))
  assert.ok(包.摘要.includes('秋季'))
})

test('写入再读出', () => {
  const st = 假存储()
  const { state, journal } = 局面()
  writeSave(st, 'slot1', state, journal)
  const 读 = readSave(st, 'slot1')
  assert.equal(读.state.pc.名字, '周野')
})

test('读空槽返回 null，不抛', () => {
  assert.equal(readSave(假存储(), 'slot1'), null)
})

test('读到坏 JSON 返回 null 而不是炸掉整个应用', () => {
  const st = 假存储()
  st.setItem(saveKey('slot1'), '{这不是 JSON')
  assert.equal(readSave(st, 'slot1'), null)
})

test('删除槽位', () => {
  const st = 假存储()
  const { state, journal } = 局面()
  writeSave(st, 'slot2', state, journal)
  deleteSave(st, 'slot2')
  assert.equal(readSave(st, 'slot2'), null)
})

test('listSaves 给出每槽的占用情况与摘要', () => {
  const st = 假存储()
  const { state, journal } = 局面()
  writeSave(st, 'slot1', state, journal)
  const 列表 = listSaves(st)
  assert.equal(列表.length, 4)
  const s1 = 列表.find((x) => x.id === 'slot1')
  assert.equal(s1.占用, true)
  assert.ok(s1.摘要.includes('周野'))
  assert.equal(列表.find((x) => x.id === 'slot2').占用, false)
})

test('迁移：低版本存档被识别并标记', () => {
  const 旧 = { 版本: 0, state: { meta: {} }, journal: {}, 摘要: '旧档' }
  const r = migrateSave(旧)
  assert.equal(r.迁移过, true)
  assert.equal(r.包.版本, STATE_VERSION)
})

test('迁移：高于当前版本的存档拒绝加载，而不是硬吃', () => {
  const 未来 = { 版本: STATE_VERSION + 5, state: {}, journal: {}, 摘要: '未来档' }
  const r = migrateSave(未来)
  assert.equal(r.可用, false)
  assert.ok(r.原因.includes('版本'))
})
