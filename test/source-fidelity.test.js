import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 数据模块里的中文必须与源文档逐字一致。
//
// 为什么要有这道防线：实现者把 猛蛇过江 事迹里的弯引号 “驴友引路” 悄悄
// 转成了直引号，还在报告里声称已保留。结构性测试（字段齐备、数量正确）
// 全绿，人工比对才发现。T5 装备表有 46 项、T6 四季表有大段风险描述，
// 靠人眼逐条盯不现实。
//
// 判定用子串包含而非整行相等：源文档里 技能 是「野外定位、岩石识别、气象观察」
// 一整行，拆成数组后单项仍是子串；地点名 苗圃 是 苗圃（备用起点） 的子串。
// 字符级别的篡改（引号、标点、错字）一律逃不掉。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const 源文 = readFileSync(join(ROOT, 'test/fixtures/source-text.txt'), 'utf8')

// 本项目自造、源文档里本就没有的中文。加进来必须写清理由。
const 允许不在源文档中 = new Map([
  // 捏人用的性格标签，是玩法设计不是文档内容
  ['话不多，认死理', 'PERSONALITY_TAGS 自造'],
  ['自来熟，爱张罗', 'PERSONALITY_TAGS 自造'],
  ['谨慎，凡事留三分', 'PERSONALITY_TAGS 自造'],
  ['爱冒险，喜欢押注', 'PERSONALITY_TAGS 自造'],
  ['独来独往', 'PERSONALITY_TAGS 自造'],
  ['讲义气，见不得人吃亏', 'PERSONALITY_TAGS 自造'],
  ['只信数据和装备', 'PERSONALITY_TAGS 自造'],
  ['为风景可以吃苦', 'PERSONALITY_TAGS 自造'],
])

const 受检模块 = ['src/data/route.js', 'src/data/npcs.js']

// 去掉注释，只看代码里的字符串字面量——注释是给人看的，不必逐字对源文档
function 剥注释(源码) {
  return 源码.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function 取中文字面量(源码) {
  const out = []
  for (const m of 剥注释(源码).matchAll(/'([^'\\\n]*)'/g)) {
    if (/[一-鿿]/.test(m[1])) out.push(m[1])
  }
  return out
}

for (const rel of 受检模块) {
  test(`${rel} 的中文与源文档逐字一致`, () => {
    const 字面量 = 取中文字面量(readFileSync(join(ROOT, rel), 'utf8'))
    assert.ok(字面量.length > 0, `没抽到中文字面量，正则可能失效: ${rel}`)

    const 走失 = 字面量.filter((s) => !源文.includes(s) && !允许不在源文档中.has(s))
    assert.deepEqual(
      走失,
      [],
      `以下中文在源文档中找不到逐字对应（可能被改动了标点、引号或用字）：\n  ${走失.join('\n  ')}`
    )
  })
}

test('允许清单里不该有已经能在源文档里找到的条目', () => {
  const 多余 = [...允许不在源文档中.keys()].filter((s) => 源文.includes(s))
  assert.deepEqual(多余, [], `这些条目其实源文档里有，不该被豁免：${多余.join('、')}`)
})
