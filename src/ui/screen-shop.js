import { GEAR, EXTRA_GEAR, ALL_GEAR, getGear, tierOf } from '../data/gear.js'
import { gearWarnings } from '../data/seasons.js'

export const START_MONEY = 10000
const SHOP_CARRY_LIMIT = 30

// 没有它就上不了山的东西。缺件清单点名的就是这些。
// 每项给一组可接受的 id：睡袋有普通款和极寒款两种，带哪个都算带了睡袋。
// 只认单一 id 的话，冬季玩家会被要求同时带两个睡袋——没人会背两个睡袋上山。
const SHOP_ESSENTIALS = [
  ['backpack'], ['tent'], ['sleeping_bag', 'winter_bag'], ['sleeping_pad'],
  ['stove'], ['staple_food'], ['headlamp'], ['first_aid'], ['water_filter'],
]

// 购物车形状：{ [gearId]: 档名 }。用最扁的结构，存档和比对都省事。
export function toggleItem(cart, gearId, 档) {
  const 新 = { ...cart }
  if (新[gearId]) delete 新[gearId]
  else 新[gearId] = 档
  return 新
}

export function setTier(cart, gearId, 档) {
  if (!cart[gearId]) return cart
  if (!tierOf(gearId, 档)) return cart
  return { ...cart, [gearId]: 档 }
}

export function cartTotals(cart) {
  let 总价 = 0
  let 总重 = 0
  let 件数 = 0
  for (const [gearId, 档] of Object.entries(cart)) {
    const t = tierOf(gearId, 档)
    if (!t) continue
    总价 += t.价格
    总重 += t.重量
    件数 += 1
  }
  return { 总价, 总重: Math.round(总重 * 100) / 100, 件数 }
}

// 一键推荐：先按必备件挑最便宜的档，再按季节补关键装备，最后补食物。
// 约束是硬的——必须买得起、不超重、无缺件，否则这个按钮就是在坑玩家。
export function recommendedCart(季节) {
  let cart = {}
  for (const [首选] of SHOP_ESSENTIALS) {
    const g = getGear(首选)
    if (g) cart[首选] = g.档次[0].档
  }
  // 冬季夜里 -25℃，普通睡袋加内胆也只到 -15℃。不换极寒款的话，「一键推荐」
  // 会让玩家带着扛不住的睡袋出发，而那条警告正是 Task 3B 专门为了能消除才加的。
  if (季节 === '冬季') {
    delete cart.sleeping_bag
    cart.winter_bag = getGear('winter_bag').档次[0].档
  }
  cart.freeze_dried = getGear('freeze_dried').档次[0].档
  cart.trail_snack = getGear('trail_snack').档次[0].档
  cart.emergency_blanket = '基础'
  cart.ibuprofen = '基础'
  cart.ors = '基础'
  if (季节 === '春季' || 季节 === '冬季') {
    cart.crampons = '通用'
    cart.gaiters = '通用'
  }
  if (季节 === '夏季') cart.mosquito_repellent = '通用'

  // 求救设备排在所有升级之前。源文档四个季节的「推荐准备」里都写了卫星通讯设备，
  // 而卫星电话只要 ¥750——一个剩着一半预算却不给配求救设备的「推荐」，是在害人。
  // 缺件清单里不放它（要不要冒这个险是玩家的选择），但推荐配置必须给。
  const 可加 = [['sat_phone', '租用'], ['water_filter', '主流'], ['headlamp', '主流'], ['bag_liner', '通用']]
  // 只升级车里实际有的那个睡袋。无条件写进列表的话，冬季刚换掉的普通睡袋
  // 会被原样加回来，玩家背两个睡袋上山。
  if (cart.sleeping_bag) 可加.splice(1, 0, ['sleeping_bag', '主流'])
  for (const [id, 档] of 可加) {
    const 试 = { ...cart, [id]: 档 }
    const t = cartTotals(试)
    if (t.总价 <= START_MONEY && t.总重 <= SHOP_CARRY_LIMIT) cart = 试
  }
  return cart
}

export function shopViewModel({ cart, 季节 }) {
  const 合计 = cartTotals(cart)
  const 剩余 = START_MONEY - 合计.总价
  const 已选ids = Object.keys(cart)

  const 分类映射 = new Map()
  for (const g of ALL_GEAR) {
    if (!分类映射.has(g.类别)) 分类映射.set(g.类别, [])
    const 当前档 = cart[g.id]
    const 最低价 = Math.min(...g.档次.map((t) => t.价格))
    const 已选 = !!当前档
    分类映射.get(g.类别).push({
      id: g.id,
      名称: g.名称,
      作用: g.作用 || '',
      季节: g.季节 || null,
      已选,
      当前档: 当前档 || null,
      档次: g.档次.map((t) => ({ 档: t.档, 价格: t.价格, 重量: t.重量, 选中: t.档 === 当前档 })),
      // 已经在车里的东西不算买不起——它的钱已经计进总价了
      买不起: !已选 && 最低价 > 剩余,
      还差: !已选 && 最低价 > 剩余 ? 最低价 - 剩余 : 0,
    })
  }

  const 缺件 = SHOP_ESSENTIALS
    .filter((可选) => !可选.some((id) => cart[id]))
    .map(([首选]) => ({ id: 首选, 名称: getGear(首选)?.名称 || 首选 }))
  const 超重 = 合计.总重 > SHOP_CARRY_LIMIT
  const 超支 = 合计.总价 > START_MONEY

  return {
    分类: [...分类映射.entries()].map(([名称, 物品]) => ({ 名称, 物品 })),
    总价: 合计.总价,
    总重: 合计.总重,
    件数: 合计.件数,
    剩余,
    预算: START_MONEY,
    上限: SHOP_CARRY_LIMIT,
    超支,
    超重,
    超出重量: 超重 ? Math.round((合计.总重 - SHOP_CARRY_LIMIT) * 100) / 100 : 0,
    警告: gearWarnings(季节, 已选ids),
    缺件,
    可出发: 缺件.length === 0 && !超支 && !超重,
    背包: Object.entries(cart).map(([gearId, 档]) => ({ gearId, 档, 数量: 1 })),
  }
}
