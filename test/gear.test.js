import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GEAR, EXTRA_GEAR, ALL_GEAR, getGear, tierOf, midTierLoadout } from '../src/data/gear.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

test('原表 21 项，扩充 25 项', () => {
  assert.equal(GEAR.length, 21)
  assert.equal(EXTRA_GEAR.length, 25)
  assert.equal(ALL_GEAR.length, 46)
})

test('id 全局唯一', () => {
  const ids = ALL_GEAR.map((g) => g.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('每项至少一个档次，档次含名称/价格/重量', () => {
  for (const g of ALL_GEAR) {
    assert.ok(g.档次.length >= 1, `无档次: ${g.id}`)
    for (const t of g.档次) {
      assert.ok(t.档, `档名缺失: ${g.id}`)
      assert.equal(typeof t.价格, 'number', `价格非数字: ${g.id}/${t.档}`)
      assert.equal(typeof t.重量, 'number', `重量非数字: ${g.id}/${t.档}`)
      assert.ok(t.价格 >= 0 && t.重量 >= 0, `负值: ${g.id}/${t.档}`)
    }
  }
})

test('多档物品越贵越轻', () => {
  for (const g of ALL_GEAR.filter((x) => x.档次.length > 1)) {
    for (let i = 1; i < g.档次.length; i++) {
      assert.ok(g.档次[i].价格 > g.档次[i - 1].价格, `价格未递增: ${g.id}`)
      assert.ok(g.档次[i].重量 <= g.档次[i - 1].重量, `重量未递减: ${g.id}`)
    }
  }
})

test('原表七大类齐全', () => {
  const 类别 = new Set(GEAR.map((g) => g.类别))
  for (const c of ['背负系统', '睡眠系统', '炊饮系统', '穿着系统', '关键装备', '医疗用品', '食物']) {
    assert.ok(类别.has(c), `缺类别: ${c}`)
  }
})

test('中档全配落在 14kg / ¥14,375 附近', () => {
  const { 总重, 总价 } = midTierLoadout()
  assert.ok(Math.abs(总重 - 14.1) < 0.05, `总重 ${总重}`)
  assert.equal(总价, 14375)
})

test('扩充物资合计 16.05kg / ¥7,630', () => {
  const 总重 = EXTRA_GEAR.reduce((s, g) => s + g.档次[0].重量, 0)
  const 总价 = EXTRA_GEAR.reduce((s, g) => s + g.档次[0].价格, 0)
  assert.ok(Math.abs(总重 - 16.05) < 0.05, `总重 ${总重}`)
  assert.equal(总价, 7630)
})

test('两条约束同时咬人：全配超 30kg 且远超 ¥10,000', () => {
  const 重 = midTierLoadout().总重 + EXTRA_GEAR.reduce((s, g) => s + g.档次[0].重量, 0)
  const 价 = midTierLoadout().总价 + EXTRA_GEAR.reduce((s, g) => s + g.档次[0].价格, 0)
  assert.ok(重 > 30, `全配总重 ${重} 应超 30kg`)
  assert.ok(价 > 20000, `全配总价 ${价} 应远超预算`)
})

test('水袋标注为免费可变量，装满 3kg', () => {
  const 水 = getGear('water_bladder')
  assert.equal(水.可变量, true)
  assert.equal(水.档次[0].价格, 120)
  assert.equal(水.档次[0].重量, 3.0)
})

test('每日消耗品标了消耗速率', () => {
  assert.equal(getGear('staple_food').每日消耗, 2)
})

test('tierOf 按档名取档，取不到返回 undefined', () => {
  assert.equal(tierOf('backpack', '主流').价格, 2000)
  assert.equal(tierOf('backpack', '不存在的档'), undefined)
})

test('季节专属物资标了适用季节', () => {
  assert.deepEqual(getGear('crampons').季节, ['春季', '冬季'])
  assert.deepEqual(getGear('mosquito_repellent').季节, ['夏季'])
})

// source-fidelity.test.js 扫不到 gear.js——EXTRA_GEAR 的 25 个名称与全部 作用
// 都是自造的，全量比对会产出六十多条豁免，噪音盖过信号。这里只钉原表 21 项。
test('原表 21 项名称与源文档逐字一致', () => {
  const 根 = join(dirname(fileURLToPath(import.meta.url)), '..')
  const 源文 = readFileSync(join(根, 'test/fixtures/source-text.txt'), 'utf8')
  // 计划把源文档的半角括号统一成了全角，比对前归一化
  const 归一 = (x) => x.replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '')
  const 源文归一 = 归一(源文)

  const 走失 = GEAR.filter((g) => !源文归一.includes(归一(g.名称))).map((g) => g.名称)
  assert.deepEqual(走失, [], `以下原表装备名在源文档中找不到对应：\n  ${走失.join('\n  ')}`)
})
