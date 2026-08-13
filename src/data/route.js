// 鳌太线路线节点。数据来自文档「鳌太线穿越途径地点详情」表，一字未改。
// 海拔给区间的（如火烧坡 2700-3000），取中值。
export const ROUTE = [
  { id: 'tangkou', 名称: '塘口村起点', 海拔: 1700, 类型: '起点', 有水源: true, 可扎营: true,
    特征: '传统登山口，村庄道路起点。', 危险: '无。' },
  { id: 'miaopu', 名称: '苗圃', 海拔: 1800, 类型: '起点', 有水源: true, 可扎营: true,
    特征: '另一常用进山口，有简易路。', 危险: '无。' },

  { id: 'huoshaopo', 名称: '火烧坡', 海拔: 2850, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '漫长陡峭的拔高路段，体力第一道考验。', 危险: '体力透支。' },
  { id: 'yingdi2900', 名称: '2900营地/盆景园', 海拔: 2900, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '高山草甸，第一个常见露营地，有水源。', 危险: '天气骤变，易失温。' },
  { id: 'aoshan', 名称: '鳌山导航架', 海拔: 3475, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '鳌山主峰标志，象征性高点，多雾大风。', 危险: '强风、能见度极低。' },
  { id: 'yaowangdong', 名称: '药王洞', 海拔: 3360, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '岩石下庇护点，可避风，附近有水源。', 危险: '拥挤，卫生问题。' },
  { id: 'maijieling', 名称: '麦秸岭', 海拔: 3500, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '刀刃状山脊，两侧陡峭，需小心横切。', 危险: '恐高、滑坠风险。' },
  { id: 'shuiwozi', 名称: '水窝子营地', 海拔: 3100, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '重要水源地，较大营地，可南北下撤。', 危险: '争夺营地、水源污染。' },
  // 飞机梁按文档「梁1/2/3」拆成三段连续挑战：长、累，且整段不可扎营——
  // 「今天还能不能坚持到2800」的决策压力就从这里来。
  { id: 'feijiliang1', 名称: '飞机梁·梁1', 海拔: 3400, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '连续巨石山梁的第一段，石海起步，攀爬耗时。', 危险: '体力消耗大、滑坠。' },
  { id: 'feijiliang2', 名称: '飞机梁·梁2', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '中段横切，天气多变区，风口一个接一个。', 危险: '天气突变、易迷路。' },
  { id: 'feijiliang3', 名称: '飞机梁·梁3', 海拔: 3500, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '末段下降困难，进退两难的一段。', 危险: '下撤困难、滑坠。' },
  { id: 'yingdi2800', 名称: '2800营地', 海拔: 2800, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '山谷中营地，关键决策点，有水源。', 危险: '野兽（羚牛）。' },
  // 金字塔同理拆「塔1/2/3」：与飞机梁的「长、累」相对，这三段是「险、难爬」。
  { id: 'jinzita1', 名称: '金字塔·塔1', 海拔: 3400, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '第一座塔，坡度陡然立起来，开始手脚并用。', 危险: '巨石不稳。' },
  { id: 'jinzita2', 名称: '金字塔·塔2', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '第二座塔，攀爬难度最高的一段。', 危险: '巨石不稳、坠落。' },
  { id: 'jinzita3', 名称: '金字塔·塔3', 海拔: 3500, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '第三座塔，人已疲惫而路仍向上。', 危险: '天气恶劣、失误率上升。' },
  { id: 'xiyuan', 名称: '西源营地', 海拔: 3100, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '九重石海前的最后一个补给营地。', 危险: '气候恶劣，易发高反。' },
  // 九重石海是全线 Boss：拆成下/中/上三重，每段一次判定，
  // 顶栏行程就是它的「进度条」。
  { id: 'jiuchongshihai1', 名称: '九重石海·下三重', 海拔: 3250, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '石海拔高的头三重，脚下全是会晃的石板。', 危险: '崴脚、体力流失。' },
  { id: 'jiuchongshihai2', 名称: '九重石海·中三重', 海拔: 3400, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '中间三重，进也难退也难，只能咬牙。', 危险: '体力与意志极限。' },
  { id: 'jiuchongshihai3', 名称: '九重石海·上三重', 海拔: 3550, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '最后三重，梁顶已经看得见了。', 危险: '强弩之末，易受伤。' },
  { id: 'dongyuan', 名称: '东源营地/太白梁顶', 海拔: 3400, 类型: '核心', 有水源: false, 可扎营: true,
    特征: '登上石海后的山顶平台。', 危险: '极度疲劳，放松警惕。' },
  { id: 'wanxianzhen', 名称: '万仙阵', 海拔: 3560, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '大片石堆群，神秘震撼，极易迷路。', 危险: '全线路况最易迷路点。' },
  { id: 'leigongmiao', 名称: '雷公庙', 海拔: 3530, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '简陋石屋地标。', 危险: '破损严重，不宜庇护。' },
  { id: 'dongpaomaliang', 名称: '东跑马梁', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '广阔的高山草甸，天气极端。', 危险: '极易遇极端大风、暴雨、失温。' },
  { id: 'baxiantai', 名称: '拔仙台', 海拔: 3767, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '太白山主峰，秦岭最高点。', 危险: '高海拔，天气恶劣。' },

  { id: 'dayehai', 名称: '大爷海', 海拔: 3590, 类型: '终点', 有水源: true, 可扎营: true,
    特征: '高山湖泊，接待站，可补给。', 危险: '无。' },
  { id: 'dawengongmiao', 名称: '大文公庙', 海拔: 3490, 类型: '终点', 有水源: true, 可扎营: true,
    特征: '接待站，可食宿。', 危险: '无。' },
  { id: 'tianyuandifang', 名称: '天圆地方', 海拔: 3510, 类型: '终点', 有水源: true, 可扎营: false,
    特征: '景区索道上站，旅游区起点。', 危险: '无。' },
  { id: 'xiabansi', 名称: '下板寺', 海拔: 2800, 类型: '终点', 有水源: true, 可扎营: false,
    特征: '景区车站，常规徒步终点。', 危险: '无。' },

  { id: 'hetaoping', 名称: '核桃坪', 海拔: 1500, 类型: '下撤', 有水源: true, 可扎营: true,
    特征: '从2800营地或水窝子向南，路陡林密。', 危险: '迷路、蛇虫。' },
  { id: 'songpingsi', 名称: '嵩坪寺', 海拔: 1400, 类型: '下撤', 有水源: true, 可扎营: true,
    特征: '从2800营地向北，至黄柏塬方向。', 危险: '路程远，野兽出没。' },
]

// 主推进路径只保留 18 个「玩家决策节点」。梁2、塔2/3、西源、石海上下三重、
// 雷公庙、东跑马梁等仍完整保存在 ROUTE 和事件文案里，但作为一个主节点内部的
// 子地点演出，不再各吃掉整整一个时段。这样五个计划营地正好每 3 回合出现一次，
// 最快路线会在第 6 天晚抵达下板寺，而不是第 9 天。
export const MAIN_PATH = [
  'tangkou', 'huoshaopo', 'yingdi2900',
  'aoshan', 'maijieling', 'shuiwozi',
  'feijiliang1', 'feijiliang3', 'yingdi2800',
  'jinzita1', 'jiuchongshihai2', 'dongyuan',
  'wanxianzhen', 'baxiantai', 'dayehai',
  'dawengongmiao', 'tianyuandifang', 'xiabansi',
]

// 从当前主节点出发时的确定性地形加成。它与负重、海拔、天气叠加，保证
// 火烧坡/飞机梁/金字塔/九重石海即使换了模型也保持相同的难度骨架。
export const TRAVEL_DIFFICULTY = Object.freeze({
  tangkou: 0,
  huoshaopo: 6,
  yingdi2900: 1,
  aoshan: 4,
  maijieling: 6,
  shuiwozi: 2,
  feijiliang1: 7,
  feijiliang3: 8,
  yingdi2800: 2,
  jinzita1: 8,
  jiuchongshihai2: 10,
  dongyuan: 3,
  wanxianzhen: 6,
  baxiantai: 7,
  dayehai: 0,
  dawengongmiao: 0,
  tianyuandifang: 0,
})

export function travelDifficulty(nodeId) {
  return TRAVEL_DIFFICULTY[nodeId] || 0
}

export function nextMainNode(nodeId) {
  const id = nodeId === 'miaopu' ? 'tangkou' : nodeId
  const i = MAIN_PATH.indexOf(id)
  return i >= 0 && i < MAIN_PATH.length - 1 ? getNode(MAIN_PATH[i + 1]) : null
}

// 主路径之外的额外连接：备用起点、南北下撤线。
// 苗圃是开局二选一的备用起点：简易路直插盆景园，跳过火烧坡的漫长拔高
// ——「前段稍短」；代价是错过塘口村口的最后一次补给。
const ROUTE_EXTRA_LINKS = [
  ['miaopu', 'huoshaopo'],
  ['miaopu', 'yingdi2900'],
  ['shuiwozi', 'hetaoping'],
  ['yingdi2800', 'hetaoping'],
  ['yingdi2800', 'songpingsi'],
]

// 主线完成度（文档要求的「完成度」展示）。苗圃是备用起点，等价于第 1 站；
// 下撤点不在主线上，返回 null 由 UI 隐藏。
export function mainProgress(nodeId) {
  const i = MAIN_PATH.indexOf(nodeId === 'miaopu' ? 'tangkou' : nodeId)
  return i === -1 ? null : { 序号: i + 1, 总数: MAIN_PATH.length }
}

const ROUTE_BY_ID = new Map(ROUTE.map((n) => [n.id, n]))

export function getNode(id) {
  return ROUTE_BY_ID.get(id)
}

export function isAdjacent(fromId, toId) {
  if (fromId === toId) return false
  const i = MAIN_PATH.indexOf(fromId)
  const j = MAIN_PATH.indexOf(toId)
  if (i !== -1 && j !== -1 && Math.abs(i - j) === 1) return true
  return ROUTE_EXTRA_LINKS.some(
    ([a, b]) => (a === fromId && b === toId) || (a === toId && b === fromId)
  )
}
