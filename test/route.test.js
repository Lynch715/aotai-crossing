import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTE, MAIN_PATH, getNode, isAdjacent } from '../src/data/route.js'

test('共 30 个节点（24 原表节点，飞机梁/金字塔/九重石海各拆三段）', () => {
  assert.equal(ROUTE.length, 30)
})

test('每个节点字段齐备且类型合法', () => {
  const 合法类型 = new Set(['起点', '核心', '终点', '下撤'])
  for (const n of ROUTE) {
    assert.ok(n.id, `缺 id: ${JSON.stringify(n)}`)
    assert.ok(n.名称, `缺名称: ${n.id}`)
    assert.equal(typeof n.海拔, 'number', `海拔非数字: ${n.id}`)
    assert.ok(n.特征, `缺特征: ${n.id}`)
    assert.ok(n.危险, `缺危险: ${n.id}`)
    assert.ok(合法类型.has(n.类型), `类型非法: ${n.id} = ${n.类型}`)
    assert.equal(typeof n.有水源, 'boolean', `有水源非布尔: ${n.id}`)
    assert.equal(typeof n.可扎营, 'boolean', `可扎营非布尔: ${n.id}`)
  }
})

test('id 无重复', () => {
  const ids = ROUTE.map((n) => n.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('主路径从塘口村到下板寺，海拔最高点是拔仙台', () => {
  assert.equal(MAIN_PATH[0], 'tangkou')
  assert.equal(MAIN_PATH[MAIN_PATH.length - 1], 'xiabansi')
  const 最高 = ROUTE.reduce((a, b) => (a.海拔 > b.海拔 ? a : b))
  assert.equal(最高.id, 'baxiantai')
  assert.equal(最高.海拔, 3767)
})

test('getNode 取得到也取不到', () => {
  assert.equal(getNode('maijieling').名称, '麦秸岭')
  assert.equal(getNode('不存在'), undefined)
})

test('相邻判定：主路径上前后相邻，跨节点不相邻', () => {
  assert.ok(isAdjacent('maijieling', 'shuiwozi'))
  assert.ok(isAdjacent('shuiwozi', 'maijieling'), '相邻应对称')
  assert.ok(!isAdjacent('tangkou', 'baxiantai'))
})

test('原地不算相邻', () => {
  assert.ok(!isAdjacent('maijieling', 'maijieling'))
})

test('下撤点挂在 2800 营地与水窝子上', () => {
  assert.ok(isAdjacent('yingdi2800', 'hetaoping'))
  assert.ok(isAdjacent('shuiwozi', 'hetaoping'))
  assert.ok(isAdjacent('yingdi2800', 'songpingsi'))
})

test('苗圃是备用起点，与火烧坡相邻', () => {
  assert.equal(getNode('miaopu').类型, '起点')
  assert.ok(isAdjacent('miaopu', 'huoshaopo'))
})

test('有水源的节点至少覆盖三个主力营地', () => {
  for (const id of ['yingdi2900', 'shuiwozi', 'yingdi2800', 'xiyuan']) {
    assert.ok(getNode(id).有水源, `${id} 应有水源`)
  }
})
