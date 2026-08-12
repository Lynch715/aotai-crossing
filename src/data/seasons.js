import { getGear } from './gear.js'

// 四季风险。主要风险/次要风险/推荐准备逐条照搬文档表格。
// 夜间温度为设计新增，用于判断睡袋温标是否够用。
export const SEASONS = [
  { id: '春季', 名称: '春季', 月份: '3–5月', 夜间温度: -8,
    主要风险: ['雪崩', '冰雪未融', '路面湿滑', '天气骤变（雨转雪）'],
    次要风险: ['能见度低', '水源冰冷', '野生动物活动频繁'],
    推荐准备: ['防滑冰爪', '雪套', '防风防水外层', '高热量食物', '卫星通讯设备'] },
  { id: '夏季', 名称: '夏季', 月份: '6–8月', 夜间温度: 5,
    主要风险: ['雷暴', '暴雨', '山洪', '滑坡', '蚊虫叮咬', '中暑'],
    次要风险: ['午后浓雾', '路径被植被覆盖', '水源污染风险'],
    推荐准备: ['防雨装备', '防蚊液', '遮阳帽', '净水设备', '雷电预警知识'] },
  { id: '秋季', 名称: '秋季', 月份: '9–11月', 夜间温度: -6,
    主要风险: ['大风', '霜冻', '昼夜温差极大（可达20℃以上）', '易失温'],
    次要风险: ['能见度降低（雾、霜）', '营地结冰', '部分水源干涸'],
    推荐准备: ['保暖睡袋（-10℃以下）', '防风帐篷', '保温水壶', '多层穿着系统', '早出发早扎营'] },
  { id: '冬季', 名称: '冬季', 月份: '12–2月', 夜间温度: -25,
    主要风险: ['极寒（-20℃至-30℃）', '暴风雪', '白化天', '冻伤', '失温', '路径完全被雪覆盖', '易迷路'],
    次要风险: ['日照时间短', '装备结冰', '呼吸结冰', '心理压力大'],
    推荐准备: ['极寒睡袋（-20℃以下）', '羽绒服+硬壳', '雪镜', '防冻液', '卫星电话', '团队协作绝不独行'] },
]

const SEASON_BY_ID = new Map(SEASONS.map((s) => [s.id, s]))

export function getSeason(id) {
  return SEASON_BY_ID.get(id)
}

export function rollSeason(rng) {
  return SEASONS[Math.floor(rng() * SEASONS.length)].id
}

// 采购界面的季节警告。ownedIds 为已选物资 id 数组。
export function gearWarnings(seasonId, ownedIds) {
  const season = SEASON_BY_ID.get(seasonId)
  if (!season) return []
  const owned = new Set(ownedIds)
  const 警告 = []

  if (!owned.has('gps') && !owned.has('sat_phone')) {
    警告.push('未携带任何求救设备（GPS信标或卫星电话）——失联后无法主动求救。')
  }

  if (seasonId === '春季' || seasonId === '冬季') {
    if (!owned.has('crampons')) 警告.push(`${season.名称}路面积雪结冰，未带冰爪，雪坡路段将无法通过。`)
    if (!owned.has('gaiters')) 警告.push(`${season.名称}雪深，未带雪套，雪灌进鞋里极易失温。`)
  }

  if (seasonId === '夏季' && !owned.has('mosquito_repellent')) {
    警告.push('夏季蚊虫叮咬频繁，未带防蚊液。')
  }

  // 温标一律从 gear.js 读，不在这里硬编码——否则改了装备表，警告还按老值算，
  // 而且没有任何测试会报错。温标越低越保暖；内胆的「温标加成」是保暖增量，
  // 所以从睡袋温标里再减去它。
  const 睡袋 = owned.has('sleeping_bag') ? getGear('sleeping_bag') : undefined
  if (睡袋) {
    const 加成 = owned.has('bag_liner') ? (getGear('bag_liner')?.温标加成 ?? 0) : 0
    const 实际温标 = 睡袋.温标 - 加成
    if (season.夜间温度 < 实际温标) {
      警告.push(`${season.名称}夜间约 ${season.夜间温度}℃，睡袋温标 ${实际温标}℃ 不够用，夜里会冷醒甚至失温。`)
    }
  }

  return 警告
}
