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
  { id: 'feijiliang', 名称: '飞机梁', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '连续巨石山梁，攀爬耗时，天气多变区。', 危险: '体力消耗大、易迷路、滑坠。' },
  { id: 'yingdi2800', 名称: '2800营地', 海拔: 2800, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '山谷中营地，关键决策点，有水源。', 危险: '野兽（羚牛）。' },
  { id: 'jinzita', 名称: '金字塔', 海拔: 3450, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '同样艰难的石海路段，攀爬难度高。', 危险: '巨石不稳、天气恶劣。' },
  { id: 'xiyuan', 名称: '西源营地', 海拔: 3100, 类型: '核心', 有水源: true, 可扎营: true,
    特征: '九重石海前的最后一个补给营地。', 危险: '气候恶劣，易发高反。' },
  { id: 'jiuchongshihai', 名称: '九重石海', 海拔: 3550, 类型: '核心', 有水源: false, 可扎营: false,
    特征: '全程最大挑战，直接拔高近500米的石海。', 危险: '体力与意志极限，易受伤。' },
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

// 主推进路径。玩家沿此序列前进，抵达 xiabansi 即「成功穿越」。
export const MAIN_PATH = [
  'tangkou', 'huoshaopo', 'yingdi2900', 'aoshan', 'yaowangdong', 'maijieling',
  'shuiwozi', 'feijiliang', 'yingdi2800', 'jinzita', 'xiyuan', 'jiuchongshihai',
  'dongyuan', 'wanxianzhen', 'leigongmiao', 'dongpaomaliang', 'baxiantai',
  'dayehai', 'dawengongmiao', 'tianyuandifang', 'xiabansi',
]

// 主路径之外的额外连接：备用起点、南北下撤线
const ROUTE_EXTRA_LINKS = [
  ['miaopu', 'huoshaopo'],
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
