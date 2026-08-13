import { NPCS } from '../data/npcs.js'

// 程序化立绘占位。没有美术资源也要能玩，且 12 个人得一眼分得清。
// 同一 id 恒定生成同一张——陈岩每次打开都是那个偏冷灰的宽肩剪影。

// FNV-1a：短字符串上分布够均匀，实现只要几行
const PORTRAIT_ROSTER = NPCS.map((n) => n.id)
const PORTRAIT_HUE_OFFSET = 18

export function portraitSeed(id) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// 色相用 Fibonacci 散列把全部 uint32 空间均匀映射到 [0, 360)：
// 乘以 2654435769（≈2^32/φ），再无符号右移到 float，再换算到度数。
// 普通取模（s % 360）会让哈希值相近的 id 撞在一起；Fibonacci 散列把它们摊开。
const PORTRAIT_FIB = 2654435769

export function portraitTheme(id) {
  const s = portraitSeed(id)
  // 色相按名单序号均匀铺开，12 个人相隔 30°——这是本模块存在的全部理由：
  // 一眼分得清谁是谁。靠哈希撒点会撞到 8° 以内，那个距离在 22% 饱和度下
  // 就是两块一样的暗红。名单外的 id（主角）退回哈希，反正只有一个。
  const 序号 = PORTRAIT_ROSTER.indexOf(id)
  const 色相 = 序号 >= 0
    ? Math.round((序号 * 360) / PORTRAIT_ROSTER.length + PORTRAIT_HUE_OFFSET) % 360
    : Math.floor(((Math.imul(s, PORTRAIT_FIB) >>> 0) / 4294967296) * 360)
  const 肩宽 = 0.55 + ((s >>> 8) % 40) / 100
  const 头大 = 0.28 + ((s >>> 16) % 12) / 100
  return {
    色相,
    肩宽,
    头大,
    主色: `hsl(${色相}, 22%, 38%)`,
    暗色: `hsl(${色相}, 20%, 16%)`,
  }
}

export function portraitSvg(id) {
  const t = portraitTheme(id)
  const 肩 = Math.round(t.肩宽 * 100)
  const 头 = Math.round(t.头大 * 100)
  return [
    '<svg class="portrait-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMax meet">',
    `<defs><linearGradient id="g${portraitSeed(id).toString(36)}" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${t.主色}"/><stop offset="1" stop-color="${t.暗色}"/>`,
    '</linearGradient></defs>',
    `<rect width="120" height="160" fill="${t.暗色}"/>`,
    `<circle cx="60" cy="${58 - 头 / 4}" r="${头 * 0.32}" fill="url(#g${portraitSeed(id).toString(36)})"/>`,
    `<path d="M60 ${72 - 头 / 8} C ${60 - 肩 * 0.6} ${86} ${60 - 肩 * 0.62} 120 ${60 - 肩 * 0.55} 160 L ${60 + 肩 * 0.55} 160 C ${60 + 肩 * 0.62} 120 ${60 + 肩 * 0.6} 86 60 ${72 - 头 / 8} Z" fill="url(#g${portraitSeed(id).toString(36)})"/>`,
    '</svg>',
  ].join('')
}

export function portraitPath(npcId, 状态) {
  return `assets/portraits/${npcId}${状态 ? '_' + 状态 : ''}.png`
}

// 场景照片：assets/scenes/{路段id}.jpg。纯可选素材——加载成功才把
// 场景带亮出来（.has-img），没有图就整条隐藏，界面不留空洞。
// 与立绘同理用 <img> 探测而不是 fetch：file:// 下 fetch 会被 CORS 挡死。
export function scenePath(nodeId) {
  return `assets/scenes/${nodeId}.jpg`
}

export function sceneInto(容器, nodeId) {
  容器.classList.remove('has-img')
  容器.textContent = ''
  if (!nodeId) return 容器
  const img = new Image()
  img.alt = ''
  img.className = 'scene-img'
  img.onload = () => {
    容器.textContent = ''
    容器.appendChild(img)
    容器.classList.add('has-img')
  }
  img.src = scenePath(nodeId)
  return 容器
}

// 真图的候选路径，按优先级排：先试状态专属图，再退回基础图。
// 拆成纯函数是为了能在没有 DOM 的 node --test 里验顺序。
export function portraitCandidates(npcId, 状态) {
  const out = []
  if (状态) out.push(portraitPath(npcId, 状态))
  out.push(portraitPath(npcId))
  return out
}

// 把立绘装进容器：先摆程序化占位，真图加载成功再顶替。
//
// 必须用 <img> 的 onload/onerror 探测，不能用 fetch —— 玩家双击打开是 file://，
// 那下面 fetch 会被 CORS 挡死，而 <img src> 不受影响。这是「没有美术资源也能玩、
// 有了图零改代码升级」这条设计能成立的关键。
export function portraitInto(容器, npcId, 状态) {
  容器.innerHTML = portraitSvg(npcId) // portrait-svg-safe
  const 候选 = portraitCandidates(npcId, 状态)
  let i = 0
  const 试下一张 = () => {
    if (i >= 候选.length) return
    const img = new Image()
    img.alt = ''
    img.className = 'portrait-img'
    img.onload = () => {
      容器.innerHTML = ''
      容器.appendChild(img)
    }
    img.onerror = () => {
      i += 1
      试下一张()
    }
    img.src = 候选[i]
  }
  试下一张()
  return 容器
}
