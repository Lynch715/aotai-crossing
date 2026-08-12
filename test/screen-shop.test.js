import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shopViewModel, toggleItem, setTier, cartTotals, recommendedCart, START_MONEY } from '../src/ui/screen-shop.js'
import { GEAR, EXTRA_GEAR, getGear, tierOf } from '../src/data/gear.js'

const 空车 = () => ({})

test('起始金钱是文档定的 1 万', () => {
  assert.equal(START_MONEY, 10000)
})

test('空车时总价总重都是 0', () => {
  assert.deepEqual(cartTotals(空车()), { 总价: 0, 总重: 0, 件数: 0 })
})

test('加入一件按所选档计价计重', () => {
  const 车 = toggleItem(空车(), 'backpack', '主流')
  const t = cartTotals(车)
  assert.equal(t.总价, tierOf('backpack', '主流').价格)
  assert.equal(t.总重, tierOf('backpack', '主流').重量)
  assert.equal(t.件数, 1)
})

test('再点一次即移除', () => {
  let 车 = toggleItem(空车(), 'backpack', '主流')
  车 = toggleItem(车, 'backpack', '主流')
  assert.deepEqual(cartTotals(车), { 总价: 0, 总重: 0, 件数: 0 })
})

test('换档只改档次，不会变成两件', () => {
  let 车 = toggleItem(空车(), 'backpack', '主流')
  车 = setTier(车, 'backpack', '经济')
  const t = cartTotals(车)
  assert.equal(t.件数, 1)
  assert.equal(t.总价, tierOf('backpack', '经济').价格)
  assert.equal(t.总重, tierOf('backpack', '经济').重量)
})

test('对不在车里的物品换档是空操作', () => {
  const 车 = setTier(空车(), 'backpack', '经济')
  assert.equal(cartTotals(车).件数, 0)
})

test('浮点不出毛刺', () => {
  let 车 = 空车()
  for (const id of ['emergency_blanket', 'ibuprofen', 'ors']) 车 = toggleItem(车, id, '基础')
  assert.equal(cartTotals(车).总重, 0.15)
})

test('买不起的物品标出还差多少', () => {
  let 车 = 空车()
  // 先花掉大部分预算
  车 = toggleItem(车, 'gps', '专业必备')
  车 = toggleItem(车, 'hardshell', '专业')
  车 = toggleItem(车, 'tent', '轻量')
  车 = toggleItem(车, 'sleeping_bag', '轻量')
  车 = toggleItem(车, 'backpack', '轻量')
  const vm = shopViewModel({ cart: 车, 季节: '秋季' })
  const 买不起 = vm.分类.flatMap((c) => c.物品).filter((i) => i.买不起)
  assert.ok(买不起.length > 0, '花掉大半预算后应该有买不起的东西')
  for (const i of 买不起) assert.ok(i.还差 > 0, `${i.id} 标了买不起却没写还差多少`)
})

test('已在车里的物品不会被标成买不起', () => {
  let 车 = 空车()
  for (const g of GEAR) 车 = toggleItem(车, g.id, g.档次[g.档次.length - 1].档)
  const vm = shopViewModel({ cart: 车, 季节: '秋季' })
  for (const i of vm.分类.flatMap((c) => c.物品)) {
    if (i.已选) assert.equal(i.买不起, false, `${i.id} 已在车里却标了买不起`)
  }
})

test('超重会被标记，且给出超出多少', () => {
  let 车 = 空车()
  for (const g of [...GEAR, ...EXTRA_GEAR]) 车 = toggleItem(车, g.id, g.档次[0].档)
  const vm = shopViewModel({ cart: 车, 季节: '冬季' })
  assert.equal(vm.超重, true)
  assert.ok(vm.超出重量 > 0)
})

test('分类按文档七大类加扩充分组，且不丢件', () => {
  const vm = shopViewModel({ cart: 空车(), 季节: '秋季' })
  const 总数 = vm.分类.reduce((s, c) => s + c.物品.length, 0)
  assert.equal(总数, GEAR.length + EXTRA_GEAR.length)
  for (const c of ['背负系统', '睡眠系统', '炊饮系统', '穿着系统', '关键装备', '医疗用品', '食物']) {
    assert.ok(vm.分类.some((x) => x.名称 === c), `缺分类 ${c}`)
  }
})

test('季节警告直接来自引擎，不在这里重写一遍', () => {
  const vm = shopViewModel({ cart: 空车(), 季节: '冬季' })
  assert.ok(vm.警告.some((w) => w.includes('冰爪')))
  assert.ok(vm.警告.some((w) => w.includes('求救')))
})

test('缺件清单点名必备品', () => {
  const vm = shopViewModel({ cart: 空车(), 季节: '秋季' })
  for (const id of ['backpack', 'tent', 'sleeping_bag', 'staple_food']) {
    assert.ok(vm.缺件.some((m) => m.id === id), `缺件清单里没有 ${id}`)
  }
})

test('买齐必备后缺件清单为空', () => {
  let 车 = 空车()
  for (const id of ['backpack', 'tent', 'sleeping_bag', 'sleeping_pad', 'stove', 'staple_food', 'headlamp', 'first_aid', 'water_filter']) {
    车 = toggleItem(车, id, getGear(id).档次[0].档)
  }
  const vm = shopViewModel({ cart: 车, 季节: '秋季' })
  assert.deepEqual(vm.缺件, [])
})

test('一键推荐配置买得起、不超重、且没有缺件', () => {
  for (const 季节 of ['春季', '夏季', '秋季', '冬季']) {
    const 车 = recommendedCart(季节)
    const vm = shopViewModel({ cart: 车, 季节 })
    assert.ok(vm.总价 <= START_MONEY, `${季节} 推荐配置超预算 ${vm.总价}`)
    assert.equal(vm.超重, false, `${季节} 推荐配置超重 ${vm.总重}`)
    assert.deepEqual(vm.缺件, [], `${季节} 推荐配置有缺件`)
  }
})

test('推荐配置必须配上求救设备，不许留着那条警告', () => {
  for (const 季节 of ['春季', '夏季', '秋季', '冬季']) {
    const vm = shopViewModel({ cart: recommendedCart(季节), 季节 })
    assert.ok(!vm.警告.some((w) => w.includes('求救')),
      `${季节} 推荐配置剩着 ¥${vm.剩余} 却没配求救设备`)
  }
})

test('推荐配置在春冬季会带上冰爪雪套', () => {
  for (const 季节 of ['春季', '冬季']) {
    const 车 = recommendedCart(季节)
    assert.ok(车.crampons, `${季节} 推荐配置没带冰爪`)
    assert.ok(车.gaiters, `${季节} 推荐配置没带雪套`)
  }
  assert.equal(recommendedCart('夏季').crampons, undefined, '夏季不该带冰爪')
})

test('出发按钮在有缺件或超支超重时禁用', () => {
  assert.equal(shopViewModel({ cart: 空车(), 季节: '秋季' }).可出发, false)
  const vm = shopViewModel({ cart: recommendedCart('秋季'), 季节: '秋季' })
  assert.equal(vm.可出发, true)
})

test('转成 createInitialState 要的背包格式', () => {
  const vm = shopViewModel({ cart: recommendedCart('秋季'), 季节: '秋季' })
  assert.ok(vm.背包.length > 0)
  for (const it of vm.背包) {
    assert.ok(it.gearId && it.档 && it.数量 >= 1)
    assert.ok(tierOf(it.gearId, it.档), `${it.gearId}/${it.档} 不是合法档次`)
  }
})
