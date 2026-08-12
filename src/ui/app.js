// 准备阶段流程串联：配置 API → 捏人 → 掷季节（公示）→ 抽卡 → 采购 → 出发
// 这一层只做渲染——读视图模型、写 DOM。判断逻辑全在视图模型里。
// 铁律：动态数据绝不拼进 innerHTML。（见 test/dom.test.js 的护栏）

import { el, setText, clear } from './dom.js'
import { createRouter } from './router.js'
import { loadConfig, saveConfig, configViewModel } from './config.js'
import { createViewModel, randomDraft, deriveExperience } from './screen-create.js'
import { drawCompanions, drawViewModel } from './screen-draw.js'
import { shopViewModel, toggleItem, setTier, recommendedCart, START_MONEY } from './screen-shop.js'
import { rollSeason, getSeason } from '../data/seasons.js'
import { getNpc } from '../data/npcs.js'
import { makeRng } from '../engine/rng.js'
import { createInitialState } from '../engine/state.js'
import { createJournal } from '../engine/journal.js'
import { writeSave } from './save.js'

// 会话状态：出发前的全部中间产物。这不是游戏状态——游戏状态在出发时才由
// createInitialState 生成并写档。
const APP会话 = {
  种子: 0,
  config: null,
  draft: null,
  季节: null,
  队友: [],
  已重抽: 0,
  cart: {},
}

// ──────────────────────────────────────────────────────────────────
// renderConfig：API 配置屏
// ──────────────────────────────────────────────────────────────────
function renderConfig(router) {
  const root = document.getElementById('screen-config')
  const vm = configViewModel(APP会话.config)
  clear(root)

  const APP预设选择 = el('select', {
    onchange: (e) => {
      APP会话.config = { ...APP会话.config, presetId: e.target.value, baseURL: '', model: '' }
      renderConfig(router)
    },
  }, vm.预设.map((p) => el('option', { value: p.id, selected: p.选中 || undefined, text: p.名称 })))

  const APPkey输入 = el('input', {
    type: 'password',
    placeholder: vm.key脱敏 || 'sk-...',
    oninput: (e) => { APP会话.config = { ...APP会话.config, apiKey: e.target.value }; APP刷新Config() },
  })

  const APP模型输入 = el('input', {
    type: 'text',
    value: vm.config.model,
    oninput: (e) => { APP会话.config = { ...APP会话.config, model: e.target.value }; APP刷新Config() },
  })

  const APPbaseURL输入 = el('input', {
    type: 'text',
    value: vm.config.baseURL,
    oninput: (e) => { APP会话.config = { ...APP会话.config, baseURL: e.target.value }; APP刷新Config() },
  })

  const APP下一步Config = el('button', {
    class: 'primary',
    disabled: !vm.可用 || undefined,
    onclick: () => {
      saveConfig(localStorage, APP会话.config)
      router.go('create')
    },
  }, ['下一步：捏人 →'])

  root.appendChild(el('h1', { text: '穿越鳌太线' }))
  root.appendChild(el('p', { class: 'muted', text: '接你自己的模型。key 只存在这台机器的浏览器里，不经过任何第三方。' }))

  const APP面板Config = el('div', { class: 'panel' }, [
    el('h2', { text: 'API 配置' }),
    el('label', { text: '厂商预设' }), APP预设选择,
    el('label', { text: 'API key' }), APPkey输入,
    el('label', { text: 'baseURL' }), APPbaseURL输入,
    el('label', { text: '模型' }), APP模型输入,
  ])

  // 只刷新派生 UI，不重建输入框——整屏重render 会让正在打字的输入框丢焦点。
  // 不刷新则更糟：填了 key 按钮仍然禁用，玩家直接卡在第一屏进不去。
  const APP警告位Config = el('div')
  function APP刷新Config() {
    const v = configViewModel(APP会话.config)
    APP下一步Config.disabled = !v.可用
    clear(APP警告位Config)
    if (v.问题.length) {
      APP警告位Config.appendChild(el('div', { class: 'notice warn' },
        v.问题.map((x) => el('div', { text: '· ' + x }))))
    }
  }

  APP面板Config.appendChild(APP警告位Config)
  APP面板Config.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [APP下一步Config]))
  root.appendChild(APP面板Config)
  APP刷新Config()
}

// ──────────────────────────────────────────────────────────────────
// renderCreate：捏人屏
// ──────────────────────────────────────────────────────────────────
function renderCreate(router) {
  const root = document.getElementById('screen-create')
  const vm = createViewModel(APP会话.draft)
  clear(root)

  // 名字输入
  const APP名字输入 = el('input', {
    type: 'text',
    value: APP会话.draft.名字 || '',
    placeholder: '主角名字',
    oninput: (e) => {
      APP会话.draft = { ...APP会话.draft, 名字: e.target.value }
      APP刷新Create()
    },
  })

  // 职业下拉
  const APP职业选择 = el('select', {
    onchange: (e) => {
      APP会话.draft = { ...APP会话.draft, 职业: e.target.value }
      renderCreate(router)
    },
  }, vm.职业表.map((job) => el('option', { value: job, selected: job === APP会话.draft.职业 || undefined, text: job })))

  // 年龄输入
  const APP年龄输入 = el('input', {
    type: 'number',
    value: APP会话.draft.年龄 || 25,
    min: '16',
    max: '70',
    oninput: (e) => {
      APP会话.draft = { ...APP会话.draft, 年龄: Number(e.target.value) }
      APP刷新Create()
    },
  })

  // 性别选择
  const APP性别选择 = el('div', { class: 'row' }, ['男', '女'].map((g) =>
    el('button', {
      class: APP会话.draft.性别 === g ? 'tag selected' : 'tag',
      onclick: () => {
        APP会话.draft = { ...APP会话.draft, 性别: g }
        renderCreate(router)
      },
    }, [g])
  ))

  // 外貌输入
  const APP外貌输入 = el('input', {
    type: 'text',
    value: APP会话.draft.外貌 || '',
    placeholder: '外貌描述（最多 60 字）',
    oninput: (e) => {
      APP会话.draft = { ...APP会话.draft, 外貌: e.target.value }
      APP刷新Create()
    },
  })

  // 性格标签
  const APP性格组 = el('div', { class: 'row' }, vm.性格标签.map((t) =>
    el('button', {
      class: t.选中 ? 'tag selected' : 'tag',
      onclick: () => {
        APP会话.draft = { ...APP会话.draft, 性格: t.id }
        renderCreate(router)
      },
    }, [t.文案])
  ))

  // 技能池：最多选 3 个
  const 已选技能数 = (APP会话.draft.技能 || []).length
  const APP技能组 = el('div', { class: 'row' }, vm.技能池.map((s) => {
    const 可点 = s.选中 || 已选技能数 < 3
    return el('button', {
      class: s.选中 ? 'tag selected' : (可点 ? 'tag' : 'tag disabled'),
      disabled: !可点 || undefined,
      onclick: () => {
        if (!可点) return
        const 当前 = [...(APP会话.draft.技能 || [])]
        const i = 当前.indexOf(s.名称)
        if (i >= 0) 当前.splice(i, 1)
        else if (当前.length < 3) 当前.push(s.名称)
        APP会话.draft = { ...APP会话.draft, 技能: 当前 }
        renderCreate(router)
      },
    }, [s.名称])
  }))

  // 户外经验进度条
  const APP经验值 = vm.户外经验
  const APP经验条 = el('div', { class: 'meter' })
  const APP经验填充 = el('div', {
    class: 'meter-bar',
    style: `width:${APP经验值}%`,
  })
  APP经验条.appendChild(APP经验填充)
  const APP经验标注 = el('span', { class: 'muted' })
  setText(APP经验标注, `户外经验 ${APP经验值} / 100`)

  // 随机按钮
  const APP随机按钮 = el('button', {
    onclick: () => {
      APP会话.draft = randomDraft(makeRng(Date.now()))
      renderCreate(router)
    },
  }, ['🎲 随机一个'])

  // 下一步按钮：掷季节并跳转
  const APP下一步Create = el('button', {
    class: 'primary',
    disabled: !vm.可继续 || undefined,
    onclick: () => {
      if (!createViewModel(APP会话.draft).可继续) return
      APP会话.季节 = rollSeason(makeRng(APP会话.种子))
      APP会话.队友 = drawCompanions(makeRng(APP会话.种子), APP会话.draft.性格)
      APP会话.已重抽 = 0
      router.go('draw')
    },
  }, ['下一步：抽卡 →'])

  root.appendChild(el('h1', { text: '捏人' }))

  const APP面板Create = el('div', { class: 'panel' }, [
    el('h2', { text: '基本信息' }),
    el('label', { text: '名字' }), APP名字输入,
    el('label', { text: '职业' }), APP职业选择,
    el('label', { text: '年龄' }), APP年龄输入,
    el('label', { text: '性别' }), APP性别选择,
    el('label', { text: '外貌' }), APP外貌输入,
    el('div', { class: 'sep' }),
    el('h2', { text: '性格' }),
    APP性格组,
    el('div', { class: 'sep' }),
    el('h2', { text: '技能（选 3 个）' }),
    APP技能组,
    el('div', { class: 'sep' }),
    el('label', {}),
    APP经验条, APP经验标注,
  ])

  // 同 renderConfig：文本框只刷派生 UI，否则每敲一个字都整屏重建、焦点当场丢失。
  // 经验条随职业/技能/年龄实时变化正是这一屏存在的意义，不能不刷。
  const APP警告位Create = el('div')
  function APP刷新Create() {
    const v = createViewModel(APP会话.draft)
    APP经验填充.style.width = `${v.户外经验}%`
    setText(APP经验标注, `户外经验 ${v.户外经验} / 100`)
    APP下一步Create.disabled = !v.可继续
    clear(APP警告位Create)
    if (v.问题.length) {
      APP警告位Create.appendChild(el('div', { class: 'notice warn' },
        v.问题.map((x) => el('div', { text: '· ' + x }))))
    }
  }

  APP面板Create.appendChild(APP警告位Create)
  APP面板Create.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [APP随机按钮, APP下一步Create]))
  root.appendChild(APP面板Create)
  APP刷新Create()
}

// ──────────────────────────────────────────────────────────────────
// renderDraw：抽卡屏（先公示季节）
// ──────────────────────────────────────────────────────────────────
function renderDraw(router) {
  const root = document.getElementById('screen-draw')
  const vm = drawViewModel(APP会话.队友, APP会话.已重抽)
  const season = getSeason(APP会话.季节)
  clear(root)

  root.appendChild(el('h1', { text: '抽卡：本次队友' }))

  // ── 季节公示（核心：必须在选卡前看到，才能针对性备货）
  if (season) {
    const APP季节块 = el('div', { class: 'panel notice' })
    APP季节块.appendChild(el('h2', { text: '本次出行季节：' + season.名称 + '（' + season.月份 + '）' }))
    const APP风险列表 = el('ul', {})
    for (const r of season.主要风险) {
      APP风险列表.appendChild(el('li', { text: r }))
    }
    APP季节块.appendChild(el('p', { class: 'muted', text: '主要风险：' }))
    APP季节块.appendChild(APP风险列表)
    root.appendChild(APP季节块)
  }

  // ── 卡片区
  const APP卡片区 = el('div', { class: 'row' })

  for (const c of vm.卡片) {
    const APP卡片 = el('div', { class: 'panel' })

    // 立绘：唯一允许的 innerHTML 例外（本地生成的静态 SVG，不含任何外部输入）
    const APP立绘容器 = el('div', { class: 'portrait' })
    APP立绘容器.innerHTML = c.立绘 // portrait-svg-safe

    APP卡片.appendChild(APP立绘容器)
    APP卡片.appendChild(el('h3', { text: c.名称 }))
    APP卡片.appendChild(el('p', { text: c.职业 + '，' + c.年龄 + ' 岁，性格：' + c.性格 }))

    // 状态（带伤标红）
    const APP状态行 = el('p', {
      class: c.带伤 ? 'danger' : '',
      text: '状态：' + c.状态,
    })
    APP卡片.appendChild(APP状态行)

    // 技能
    const APP技能行 = el('div', { class: 'row' }, c.技能.map((s) => el('span', { class: 'tag', text: s })))
    APP卡片.appendChild(el('p', { class: 'muted', text: '技能：' }))
    APP卡片.appendChild(APP技能行)

    // 好感度
    APP卡片.appendChild(el('p', { text: '初始好感：' + c.好感 }))

    APP卡片区.appendChild(APP卡片)
  }
  root.appendChild(APP卡片区)

  // ── 操作栏
  const APP重抽按钮 = el('button', {
    disabled: !vm.可重抽 || undefined,
    onclick: () => {
      APP会话.已重抽 += 1
      APP会话.队友 = drawCompanions(makeRng(APP会话.种子 + APP会话.已重抽), APP会话.draft.性格)
      renderDraw(router)
    },
  })
  setText(APP重抽按钮, vm.可重抽 ? `重抽（剩 ${vm.剩余重抽} 次）` : '重抽次数已用完')

  const APP下一步Draw = el('button', {
    class: 'primary',
    onclick: () => {
      // 带上推荐购物车作为初始值
      APP会话.cart = recommendedCart(APP会话.季节)
      router.go('shop')
    },
  }, ['下一步：采购 →'])

  root.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [APP重抽按钮, APP下一步Draw]))
}

// ──────────────────────────────────────────────────────────────────
// renderShop：采购屏
// ──────────────────────────────────────────────────────────────────
function renderShop(router) {
  const root = document.getElementById('screen-shop')
  const vm = shopViewModel({ cart: APP会话.cart, 季节: APP会话.季节 })
  clear(root)

  root.appendChild(el('h1', { text: '采购装备' }))

  // ── 物品列表（左栏）
  const APP物品列表 = el('div', { class: 'gear-list' })

  for (const 类 of vm.分类) {
    APP物品列表.appendChild(el('div', { class: 'cat-head', text: 类.名称 }))

    for (const item of 类.物品) {
      const APP行 = el('div', { class: item.买不起 ? 'item-row blocked' : 'item-row' })

      // 物品名 + 作用说明
      const APP名列 = el('div', { class: 'item-name' })
      APP名列.appendChild(el('span', { text: item.名称 }))
      if (item.作用) APP名列.appendChild(el('span', { class: 'muted', text: '　' + item.作用 }))
      APP行.appendChild(APP名列)

      // 档次标签（横排点选）
      const APP档组 = el('div', { class: 'row' })
      for (const t of item.档次) {
        const APP档按钮 = el('button', {
          class: t.选中 ? 'tag selected' : 'tag',
          onclick: () => {
            if (t.选中) {
              // 再点已选档 → 取消整件
              APP会话.cart = toggleItem(APP会话.cart, item.id, t.档)
            } else if (APP会话.cart[item.id]) {
              // 已在车 → 换档
              APP会话.cart = setTier(APP会话.cart, item.id, t.档)
            } else {
              // 未在车 → 加入
              APP会话.cart = toggleItem(APP会话.cart, item.id, t.档)
            }
            renderShop(router)
          },
        })
        setText(APP档按钮, `${t.档} ¥${t.价格} ${t.重量}kg`)
        APP档组.appendChild(APP档按钮)
      }
      APP行.appendChild(APP档组)

      // 买不起提示
      if (item.买不起) {
        APP行.appendChild(el('span', { class: 'danger', text: `还差 ¥${item.还差}` }))
      }

      APP物品列表.appendChild(APP行)
    }
  }

  // ── 右侧结算栏
  const APP结算栏 = el('div', { class: 'panel sidebar' })

  // 花费进度条
  const APP花费进度 = el('div', { class: 'meter' })
  const APP花费条 = el('div', {
    class: vm.超支 ? 'meter-bar danger' : 'meter-bar warn',
    style: `width:${Math.min(100, Math.round(vm.总价 / vm.预算 * 100))}%`,
  })
  APP花费进度.appendChild(APP花费条)
  APP结算栏.appendChild(el('p', { text: `花费：¥${vm.总价} / ¥${vm.预算}` }))
  APP结算栏.appendChild(APP花费进度)

  // 负重进度条
  const APP重量进度 = el('div', { class: 'meter' })
  const APP重量条 = el('div', {
    class: vm.超重 ? 'meter-bar danger' : 'meter-bar',
    style: `width:${Math.min(100, Math.round(vm.总重 / vm.上限 * 100))}%`,
  })
  APP重量进度.appendChild(APP重量条)
  APP结算栏.appendChild(el('p', { text: `负重：${vm.总重}kg / ${vm.上限}kg` }))
  APP结算栏.appendChild(APP重量进度)

  // 超出警告
  if (vm.超支) {
    APP结算栏.appendChild(el('div', { class: 'notice warn', text: `超出预算 ¥${vm.总价 - vm.预算}` }))
  }
  if (vm.超重) {
    APP结算栏.appendChild(el('div', { class: 'notice warn', text: `超出重量上限 ${vm.超出重量}kg` }))
  }

  // 季节警告
  for (const w of vm.警告) {
    APP结算栏.appendChild(el('div', { class: 'notice warn', text: w }))
  }

  // 缺件清单
  if (vm.缺件.length) {
    const APP缺件块 = el('div', { class: 'notice' })
    APP缺件块.appendChild(el('p', { text: '缺少必备装备：' }))
    for (const m of vm.缺件) {
      APP缺件块.appendChild(el('div', { text: '· ' + m.名称 }))
    }
    APP结算栏.appendChild(APP缺件块)
  }

  // 操作按钮
  const APP推荐按钮 = el('button', {
    onclick: () => {
      APP会话.cart = recommendedCart(APP会话.季节)
      renderShop(router)
    },
  }, ['一键推荐'])

  const APP出发按钮 = el('button', {
    class: 'primary',
    disabled: !vm.可出发 || undefined,
    onclick: () => {
      if (!vm.可出发) return
      APP出发(vm)
    },
  }, ['确认出发 →'])

  APP结算栏.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [APP推荐按钮, APP出发按钮]))
  root.appendChild(el('div', { class: 'row gear-layout' }, [APP物品列表, APP结算栏]))
}

// ──────────────────────────────────────────────────────────────────
// APP出发：生成初始状态，写自动存档，提示计划三
// ──────────────────────────────────────────────────────────────────
function APP出发(shopVm) {
  const pc = {
    名字: APP会话.draft.名字,
    职业: APP会话.draft.职业,
    年龄: APP会话.draft.年龄,
    性别: APP会话.draft.性别,
    性格: APP会话.draft.性格,
    外貌: APP会话.draft.外貌,
    技能: [...APP会话.draft.技能],
    户外经验: deriveExperience(APP会话.draft),
  }

  let state
  try {
    state = createInitialState({
      种子: APP会话.种子,
      季节: APP会话.季节,
      pc,
      队友: APP会话.队友,
      背包: shopVm.背包,
      金钱: START_MONEY - shopVm.总价,
    })
  } catch (err) {
    // createInitialState 在起点节点不合法时抛异常，这里保底报错、不让界面白屏
    const APP错误屏 = document.getElementById('screen-shop')
    APP错误屏.appendChild(el('div', { class: 'notice warn', text: '初始化状态失败：' + err.message }))
    return
  }

  const journal = createJournal()
  const APP存档结果 = writeSave(localStorage, 'auto', state, journal)

  // 切换到出发成功提示（复用 screen-shop，清空再写入）
  const root = document.getElementById('screen-shop')
  clear(root)

  root.appendChild(el('h1', { text: '出发！' }))

  const APP出发面板 = el('div', { class: 'panel' })
  APP出发面板.appendChild(el('p', { text: pc.名字 + ' 已准备就绪，背包装好，即将踏上鳌太线。' }))
  APP出发面板.appendChild(el('p', { text: '季节：' + APP会话.季节 }))
  APP出发面板.appendChild(el('p', { text: `剩余资金：¥${state.money}` }))
  APP出发面板.appendChild(el('p', { text: `背包物品：${state.pack.length} 件，${state.carry.当前} kg` }))
  APP出发面板.appendChild(el('p', { text: `同行队友：${APP会话.队友.map((t) => getNpc(t.npcId).名称).join('、')}` }))

  // 存档结果反馈（writeSave 返回 false 表示存储已满）
  if (APP存档结果) {
    APP出发面板.appendChild(el('p', { class: 'muted', text: '✓ 自动存档写入成功。' }))
  } else {
    APP出发面板.appendChild(el('div', { class: 'notice warn', text: '警告：存储空间不足，自动存档失败。请清理浏览器本地存储后重试，否则进度无法保留。' }))
  }

  APP出发面板.appendChild(el('p', { class: 'muted', text: '徒步阶段将在计划三中接上。目前已完成全部准备流程。' }))

  root.appendChild(APP出发面板)
}

// ──────────────────────────────────────────────────────────────────
// 启动
// ──────────────────────────────────────────────────────────────────
function 启动() {
  APP会话.种子 = Math.floor(Math.random() * 2 ** 31)
  APP会话.config = loadConfig(localStorage)
  APP会话.draft = randomDraft(makeRng(APP会话.种子))

  const router = createRouter((id) => document.getElementById('screen-' + id))
  router.register('config', { onEnter: () => renderConfig(router) })
  router.register('create', { onEnter: () => renderCreate(router) })
  router.register('draw', { onEnter: () => renderDraw(router) })
  router.register('shop', { onEnter: () => renderShop(router) })
  router.go('config')
}

if (typeof document !== 'undefined') 启动()
