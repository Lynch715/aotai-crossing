// 准备阶段流程串联：配置 API → 捏人 → 掷季节（公示）→ 抽卡 → 采购 → 出发
// 徒步回合：点选项 → 调 LLM → 打字机上屏 → 刷新面板 → 结局页
// 这一层只做渲染——读视图模型、写 DOM。判断逻辑全在视图模型里。
// 铁律：动态数据绝不拼进 innerHTML。（见 test/dom.test.js 的护栏）

import { el, setText, clear } from './dom.js'
import { createRouter } from './router.js'
import { portraitInto, sceneInto } from './portrait.js'
import { loadConfig, saveConfig, configViewModel, validateConfig } from './config.js'
import { createViewModel, randomDraft, deriveExperience } from './screen-create.js'
import { drawCompanions, drawViewModel } from './screen-draw.js'
import { shopViewModel, toggleItem, setTier, recommendedCart, START_MONEY } from './screen-shop.js'
import { gameViewModel, panelViewModel, actionsViewModel } from './screen-game.js'
import { endingViewModel } from './screen-ending.js'
import { createTypewriter, splitParagraphs } from './prose.js'
import { rollSeason, getSeason } from '../data/seasons.js'
import { getNpc } from '../data/npcs.js'
import { makeRng } from '../engine/rng.js'
import { createInitialState } from '../engine/state.js'
import { eatHot, eatCold, rest, advanceTimeSlot } from '../engine/consume.js'
import { checkEnding, applyEnding } from '../engine/ending.js'
import { createJournal } from '../engine/journal.js'
import { writeSave, readSave, deleteSave } from './save.js'
import { runTurn } from '../turn.js'

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
  // 以下字段在出发后填入，游戏循环使用
  state: null,
  journal: null,
  // 最近若干回合的原文（字符串数组），供 LLM 续写上下文。
  // 随自动存档持久化——它是剧情连贯性的命脉，刷新后必须还原。
  最近回合: [],
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

  // 有还没打完的局时，配置完直接回牌桌——这一屏也是「换了机器 / key 失效」
  // 时的落脚点，不能把人送去重新捏人。
  const 有局在身 = !!(APP会话.state && APP会话.state.phase !== '结局')
  const APP下一步Config = el('button', {
    class: 'primary',
    disabled: !vm.可用 || undefined,
    onclick: () => {
      saveConfig(localStorage, APP会话.config)
      router.go(有局在身 ? 'game' : 'create')
    },
  }, [有局在身 ? '继续旅程 →' : '下一步：捏人 →'])

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

  // 经验微调 ±10：spec 写明可手调，deriveExperience 的算法也一直支持，
  // 此前却没有任何控件能改它——有算法没入口的死字段。
  const 当前微调 = APP会话.draft.经验微调 || 0
  const APP微调显示 = el('span', { class: 'muted' })
  setText(APP微调显示, `微调 ${当前微调 > 0 ? '+' : ''}${当前微调}`)
  const APP调经验 = (d) => {
    const 新 = Math.max(-10, Math.min(10, (APP会话.draft.经验微调 || 0) + d))
    APP会话.draft = { ...APP会话.draft, 经验微调: 新 }
    renderCreate(router)
  }
  const APP微调行 = el('div', { class: 'row' }, [
    el('button', { class: 'tag', onclick: () => APP调经验(-1) }, ['−1']),
    APP微调显示,
    el('button', { class: 'tag', onclick: () => APP调经验(1) }, ['+1']),
  ])

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
    APP经验条, APP经验标注, APP微调行,
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

    // 立绘：先摆程序化占位，assets/portraits/ 里有真图就顶替
    const APP立绘容器 = portraitInto(el('div', { class: 'portrait' }), c.npcId)

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
      const APP行类 = item.已选 ? 'item-row selected' : item.买不起 ? 'item-row blocked' : 'item-row'
      const APP行 = el('div', { class: APP行类 })

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
      APP出发(vm, router)
    },
  }, ['确认出发 →'])

  APP结算栏.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [APP推荐按钮, APP出发按钮]))
  root.appendChild(el('div', { class: 'row gear-layout' }, [APP物品列表, APP结算栏]))
}

// ──────────────────────────────────────────────────────────────────
// APP出发：生成初始状态，写自动存档，进入徒步主界面
// ──────────────────────────────────────────────────────────────────
function APP出发(shopVm, router) {
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
  writeSave(localStorage, 'auto', state, journal, APP会话.最近回合)

  // 把 state/journal 挂到会话上，让 renderGame 能读到
  APP会话.state = state
  APP会话.journal = journal
  APP会话.最近回合 = []

  router.go('game')
}

// ──────────────────────────────────────────────────────────────────
// renderGame：徒步主界面
// ──────────────────────────────────────────────────────────────────
function renderGame(router) {
  const root = document.getElementById('screen-game')
  const { state, journal } = APP会话
  const vm = gameViewModel({ state, 回合: null, 说话人: null })
  clear(root)

  // ── 顶栏
  const APP顶栏 = el('div', { class: 'game-topbar' })
  const APP节点名 = el('span', { class: 'node-name' })
  setText(APP节点名, vm.顶栏.地点)
  const APP时间 = el('span')
  setText(APP时间, vm.顶栏.时间)
  const APP海拔 = el('span')
  setText(APP海拔, vm.顶栏.海拔 + 'm')
  const APP天气 = el('span')
  setText(APP天气, vm.顶栏.天气)
  APP顶栏.appendChild(APP节点名)
  APP顶栏.appendChild(APP时间)
  APP顶栏.appendChild(APP海拔)
  APP顶栏.appendChild(APP天气)

  // 半途放弃重开的出口。两段式确认——整局进度一键清空，误触代价太大。
  const APP重开钮 = el('button', { class: 'link-btn' }, ['重新开始'])
  let APP重开待确认 = false
  APP重开钮.addEventListener('click', () => {
    if (!APP重开待确认) {
      APP重开待确认 = true
      setText(APP重开钮, '确认放弃本局？')
      return
    }
    deleteSave(localStorage, 'auto')
    APP会话.state = null
    APP会话.journal = null
    APP会话.最近回合 = []
    APP会话.种子 = Math.floor(Math.random() * 2 ** 31)
    APP会话.draft = randomDraft(makeRng(APP会话.种子))
    router.go('create')
  })
  APP顶栏.appendChild(APP重开钮)
  root.appendChild(APP顶栏)

  // ── 双栏
  const APP布局 = el('div', { class: 'game-layout' })

  // ── 左栏：面板
  const APP左栏 = el('div', { class: 'game-sidebar' })
  const APP面板 = renderPanel(vm.面板)
  APP左栏.appendChild(APP面板)
  APP布局.appendChild(APP左栏)

  // ── 右栏：场景照片 + 舞台 + 剧情 + 选项
  const APP右栏 = el('div', { class: 'game-main' })

  // 场景带：当前路段的照片（assets/scenes/ 有图才显示）
  const APP场景带 = el('div', { class: 'scene-band' })
  sceneInto(APP场景带, state.place.nodeId)
  APP右栏.appendChild(APP场景带)

  // 舞台（队友立绘，说话人高亮）
  const APP舞台 = el('div', { class: 'stage' })
  for (const p of vm.舞台.人物) {
    const APP人物 = el('div', { class: p.说话中 ? 'stage-figure speaking' : 'stage-figure' })
    const APP立绘容器 = el('div', { class: 'stage-portrait' })
    portraitInto(APP立绘容器, p.npcId)
    const APP名字 = el('span', { class: 'stage-name' })
    setText(APP名字, p.名称)
    APP人物.appendChild(APP立绘容器)
    APP人物.appendChild(APP名字)
    APP舞台.appendChild(APP人物)
  }
  APP右栏.appendChild(APP舞台)

  // 错误提示位（回合出错、降级诊断时填入）。
  // 挂在选项之后——诊断是给想深究的人看的，不能横在剧情前面打断阅读。
  const APP错误位 = el('div')

  // 剧情区
  const APP剧情区 = el('div', { class: 'prose-area' })
  const APP剧情标题 = el('div', { class: 'prose-title' })
  const APP载入位 = el('div', { class: 'thinking', hidden: true })
  const APP剧情正文 = el('div')
  APP剧情区.appendChild(APP载入位)
  APP剧情区.appendChild(APP剧情标题)
  APP剧情区.appendChild(APP剧情正文)
  APP右栏.appendChild(APP剧情区)

  // 万象区
  const APP万象区 = el('div')
  APP右栏.appendChild(APP万象区)

  // 选项区
  const APP选项区 = el('div', { class: 'options-area' })
  APP右栏.appendChild(APP选项区)
  APP右栏.appendChild(APP错误位)

  // 原生行动区（进食/休整/求救——不经过模型的操作）
  const APP行动区 = el('div', { class: 'game-controls' })
  const APP行动反馈 = el('div', { class: 'muted' })
  APP右栏.appendChild(APP行动区)
  APP右栏.appendChild(APP行动反馈)

  // 操作按钮（跳过打字机）
  const APP控制区 = el('div', { class: 'game-controls' })
  APP右栏.appendChild(APP控制区)

  APP布局.appendChild(APP右栏)
  root.appendChild(APP布局)

  // ── 等待首回合：如果自动存档有内容，还原状态后直接跑一次开场渲染
  // （存档只存 state+journal，正文已丢失，第一次进来正文区留空，等玩家点选项）
  // 初始化选项：首次进来用 FALLBACK_OPTIONS 作为占位选项，让玩家能选
  // 但更干净的做法是把 runTurn 中第一次没有选中项时的行为理解为「开场白」——
  // 当前实现里，首次进 game 屏没有选中项，由玩家点选项后才启动第一个回合。
  // 这就需要一套初始选项。FALLBACK_OPTIONS 从 turn.js 导出，正好用。
  // 但导入会增加一个模块依赖，而 gameViewModel 中 选项 在 回合==null 时返回 []。
  // 计划：让首次进入时显示「开始徒步」的单一选项。
  const APP初始选项 = [
    { id: 'start', 文本: '出发上路！', 类型: '徒步', require: {}, cost: {}, 可点: true, 档: '达标', 概率文案: '', 理由: '' },
  ]

  // 当前待选选项（回合结束后更新）
  let APP当前选项 = APP初始选项
  let APP进行中 = false   // 防止连点
  let APP当前打字机 = null
  let APP打字机Timer = null

  function APP停止打字机() {
    if (APP打字机Timer !== null) {
      clearInterval(APP打字机Timer)
      APP打字机Timer = null
    }
  }

  function APP渲染剧情(文本) {
    clear(APP剧情正文)
    for (const 段 of splitParagraphs(文本)) {
      const p = el('p')
      setText(p, 段)
      APP剧情正文.appendChild(p)
    }
  }

  function APP渲染面板(st) {
    const panelVm = panelViewModel(st)
    clear(APP左栏)
    APP左栏.appendChild(renderPanel(panelVm))
  }

  function APP渲染舞台(st, 说话人) {
    const 所有人物 = st.party.filter((p) => p.在队)
    clear(APP舞台)
    for (const p of 所有人物) {
      const npc = getNpc(p.npcId)
      const 名称 = npc ? npc.名称 : p.npcId
      const APP人物 = el('div', { class: p.npcId === 说话人 ? 'stage-figure speaking' : 'stage-figure' })
      const APP立绘容器 = el('div', { class: 'stage-portrait' })
      portraitInto(APP立绘容器, p.npcId)
      const APP名字 = el('span', { class: 'stage-name' })
      setText(APP名字, 名称)
      APP人物.appendChild(APP立绘容器)
      APP人物.appendChild(APP名字)
      APP舞台.appendChild(APP人物)
    }
  }

  function APP渲染万象(万象) {
    clear(APP万象区)
    for (const 条 of (万象 || [])) {
      const APP条 = el('div', { class: 'event-notice' })
      setText(APP条, 条)
      APP万象区.appendChild(APP条)
    }
  }

  function APP渲染选项(选项, 禁用) {
    clear(APP选项区)
    for (const o of 选项) {
      const 可点 = !禁用 && o.可点
      let cls = 'option'
      if (o.档 === '勉强') cls += ' warn-option'
      const APP选项 = el('button', {
        class: cls,
        disabled: !可点 || undefined,
        onclick: () => {
          if (APP进行中) return
          APP执行回合(o)
        },
      })
      // 选项主文案
      const APP文本节点 = el('span')
      setText(APP文本节点, o.文本 || '')
      APP选项.appendChild(APP文本节点)
      // 副文案：概率 or 缺少理由
      if (o.概率文案 || o.理由) {
        const APP副文案 = el('span', { class: o.档 === '勉强' ? 'option-meta warn-meta' : 'option-meta' })
        setText(APP副文案, o.概率文案 || ('差 ' + o.理由))
        APP选项.appendChild(APP副文案)
      }
      APP选项区.appendChild(APP选项)
    }
  }

  let APP载入计时器 = null

  function APP显示载入(开) {
    if (APP载入计时器) {
      clearInterval(APP载入计时器)
      APP载入计时器 = null
    }
    if (!开) {
      APP载入位.hidden = true
      return
    }
    // 等模型是全程最长的一段静默，点完到第一个字可能十几秒。
    // 没有动的东西，玩家会以为卡死了——所以要有一个明显在走的秒表。
    const 起 = Date.now()
    APP载入位.hidden = false
    const 刷 = () => {
      const 秒 = Math.floor((Date.now() - 起) / 1000)
      setText(APP载入位, `正在推演这一回合…… ${秒}s`)
    }
    刷()
    APP载入计时器 = setInterval(刷, 200)
  }

  let APP当前控制器 = null

  function APP渲染控制按钮(模式) {
    // 模式：'idle' | 'typing' | 'done'
    clear(APP控制区)
    if (模式 === 'typing') {
      const APP跳过 = el('button', {
        onclick: () => {
          if (!APP当前打字机) return
          const 全文 = APP当前打字机.flush()
          APP停止打字机()
          APP渲染剧情(全文)
        },
      }, ['跳过'])
      APP控制区.appendChild(APP跳过)
      // 取消：中断本回合请求，runTurn 整体回滚，玩家的选择不被消费。
      // 没有它，模型挂起或写飞时玩家只能干等或刷新——刷新会丢掉最近回合上下文。
      const APP取消 = el('button', {
        onclick: () => { if (APP当前控制器) APP当前控制器.abort() },
      }, ['取消本回合'])
      APP控制区.appendChild(APP取消)
    }
  }

  let APP上次场景 = state.place.nodeId

  function APP刷新顶栏() {
    const v = gameViewModel({ state, 回合: null, 说话人: null })
    setText(APP节点名, v.顶栏.地点)
    setText(APP时间, v.顶栏.时间)
    setText(APP海拔, v.顶栏.海拔 + 'm')
    setText(APP天气, v.顶栏.天气)
    // 换了路段才重新探测场景图，原地不动不发无谓的图片请求
    if (state.place.nodeId !== APP上次场景) {
      APP上次场景 = state.place.nodeId
      sceneInto(APP场景带, state.place.nodeId)
    }
  }

  // 原生操作共用的收尾：存档、刷面板、刷顶栏，并接住可能触发的结局。
  // 返回 true 表示已经跳去结局页，调用方不要再动界面。
  function APP结算原生操作(反馈) {
    writeSave(localStorage, 'auto', state, journal, APP会话.最近回合)
    APP渲染面板(state)
    APP刷新顶栏()
    setText(APP行动反馈, 反馈 || '')
    const ending = checkEnding(state)
    if (ending) {
      applyEnding(state, ending)
      writeSave(localStorage, 'auto', state, journal, APP会话.最近回合)
      router.go('ending')
      return true
    }
    APP渲染行动区()
    return false
  }

  let APP求救待确认 = false

  function APP渲染行动区() {
    const avm = actionsViewModel(state)
    clear(APP行动区)
    const 排 = [
      ['热食', () => {
        const 前 = state.pc.体力
        if (eatHot(state)) APP结算原生操作(`吃了顿热食，体力 ${前}→${state.pc.体力}`)
      }],
      ['冷食', () => {
        const 前 = state.pc.体力
        if (eatCold(state)) APP结算原生操作(`啃了点路餐，体力 ${前}→${state.pc.体力}`)
      }],
      ['休整', () => {
        const 前 = state.pc.体力
        rest(state)
        const r = advanceTimeSlot(state)
        APP结算原生操作(`原地休整了一个时段，体力 ${前}→${state.pc.体力}${r.跨天 ? '，已过夜' : ''}`)
      }],
    ]
    for (const [键, 动作] of 排) {
      const a = avm[键]
      APP行动区.appendChild(el('button', {
        disabled: (!a.可用 || APP进行中) || undefined,
        title: a.原因 || undefined,
        onclick: () => { if (!APP进行中) 动作() },
      }, [a.文案]))
    }
    // 求救两段式确认——它直接终局，误触代价太大。设备是玩家花钱买的，
    // 这个按钮就是它「保命」承诺兑现的地方。
    const 救 = avm.求救
    APP行动区.appendChild(el('button', {
      disabled: (!救.可用 || APP进行中) || undefined,
      title: 救.原因 || undefined,
      onclick: () => {
        if (APP进行中) return
        if (!APP求救待确认) {
          APP求救待确认 = true
          APP渲染行动区()
          setText(APP行动反馈, '再点一次确认——救援队来了，这一局就结束了。')
          return
        }
        state.flags.已求救 = true
        APP求救待确认 = false
        APP结算原生操作('')
      },
    }, [APP求救待确认 ? '确认求救？' : 救.文案]))
  }

  async function APP执行回合(选中项) {
    if (APP进行中) return
    APP进行中 = true

    // 清除上一次的错误提示
    clear(APP错误位)
    setText(APP行动反馈, '')
    // 请求中禁用全部选项与原生操作
    APP渲染选项(APP当前选项, true)
    APP渲染行动区()
    APP渲染控制按钮('typing')

    APP显示载入(true)

    // 清空剧情区，准备打字机
    setText(APP剧情标题, '')
    clear(APP剧情正文)
    APP渲染万象([])

    // 为这一回合建一个新打字机
    const tw = createTypewriter()
    APP当前打字机 = tw

    // 启动 40ms 的匀速吐字 interval
    APP停止打字机()
    APP打字机Timer = setInterval(() => {
      const 文本 = tw.tick()
      if (文本 !== null) {
        APP显示载入(false)
        APP渲染剧情(文本)
      }
      if (tw.done()) {
        APP停止打字机()
        APP渲染控制按钮('done')
      }
    }, 40)

    // 掷骰种子由引擎按「存档种子 + 回合序号」自行推导（见 turn.js 的 turnSeed）。
    // 不在这里算——UI 层曾用「最近回合数组长度」当偏移，数组封顶在 4 之后
    // 每回合掷出的点数就再也不变了。
    const 控制器 = new AbortController()
    APP当前控制器 = 控制器

    const r = await runTurn({
      state,
      journal,
      选中项,
      最近回合: APP会话.最近回合,
      config: APP会话.config,
      signal: 控制器.signal,
      // window.__testStreamImpl 仅供手动浏览器验证，不走真实 API
      streamImpl: typeof window !== 'undefined' && window.__testStreamImpl ? window.__testStreamImpl : undefined,
      onDelta: (块) => {
        // 只推入打字机，绝不直接操作 DOM
        tw.push(块)
      },
    })
    APP当前控制器 = null

    APP进行中 = false
    APP显示载入(false)

    if (!r.ok) {
      // 出错：回滚（state 已在 runTurn 里回滚）、显示提示、保留选项
      APP停止打字机()
      clear(APP剧情正文)
      const APP错误 = el('div', { class: 'error-notice' })
      setText(APP错误, r.error && r.error.提示 ? r.error.提示 : '回合出错，请重试')
      APP错误位.appendChild(APP错误)
      // 恢复选项可点，让玩家重试
      APP渲染选项(APP当前选项, false)
      APP渲染行动区()
      APP渲染控制按钮('idle')
      return
    }

    // 把本回合推入 最近回合（保留最近 4 条）。
    // 必须是字符串——prompt.js 直接 join 拼进 user message。
    // 三条铁律：
    // 1. 正文保留全文（上限只防跑飞）——曾经截前 200 字，把结尾切掉了，
    //    而下一回合要续写的恰恰是结尾，剧情断档就是这么来的；
    // 2. 万象要跟着进上下文——它们是模型自己埋的钩子（天气转坏、他队动向），
    //    用完即扔的话下一回合只能另编一套，前后就对不上了；
    // 3. 选择与判定写明白，让模型知道玩家刚做了什么。
    APP会话.最近回合.push([
      r.标题 ? `【${r.标题}】` : '',
      (r.剧情 || '').slice(0, 600),
      (r.万象 || []).length ? `万象：${r.万象.join('；')}` : '',
      `（玩家选了「${选中项.文本 || 选中项.id}」，判定${r.判定 ? (r.判定.outcome === 'success' ? '成功' : '失败') : '—'}）`,
    ].filter(Boolean).join('\n'))
    if (APP会话.最近回合.length > 4) APP会话.最近回合.shift()

    // 降级诊断。此前 UI 完全无视 r.降级 与 r.warnings——模型没按格式回时，
    // 玩家只会看到四个来路不明的兜底选项，既不知道出了什么事，也没法反馈。
    // 静默降级比报错更难查。
    if (r.降级 || (r.warnings && r.warnings.length)) {
      // 降级是真出事了，要显眼；被拦一两条提议是校验层在正常干活，
      // 玩家不需要看到「合法相邻节点」「驳回」这种开发者黑话——
      // 收成一行可展开的小字就够了。
      const APP诊断 = el('div', { class: r.降级 ? 'notice warn' : 'notice quiet' })
      if (r.降级) {
        APP诊断.appendChild(el('div', {
          text: '模型这回合没按格式回复，已用备用选项让你继续走。本回合的好感与记忆未结算。',
        }))
        for (const w of r.warnings || []) {
          APP诊断.appendChild(el('div', { class: 'muted', text: '· ' + w }))
        }
      } else {
        const APP详情 = el('div', { hidden: true })
        for (const w of r.warnings || []) {
          APP详情.appendChild(el('div', { class: 'muted', text: '· ' + w }))
        }
        const APP开关 = el('button', { class: 'link-btn' }, [`本回合有 ${r.warnings.length} 处提议被拦下 · 详情`])
        APP开关.addEventListener('click', () => {
          APP详情.hidden = !APP详情.hidden
          setText(APP开关, APP详情.hidden ? `本回合有 ${r.warnings.length} 处提议被拦下 · 详情` : '收起')
        })
        APP诊断.appendChild(APP开关)
        APP诊断.appendChild(APP详情)
      }
      if (r.原文) {
        const APP展开 = el('button', { class: 'link-btn' }, ['查看模型原始回复'])
        const APP原文 = el('pre', { class: 'raw-dump', hidden: true })
        setText(APP原文, r.原文)
        APP展开.addEventListener('click', () => {
          APP原文.hidden = !APP原文.hidden
          setText(APP展开, APP原文.hidden ? '查看模型原始回复' : '收起')
        })
        APP诊断.appendChild(APP展开)
        APP诊断.appendChild(APP原文)
      }
      APP错误位.appendChild(APP诊断)
    }

    // 回合解析完成：停止打字机，用干净的 r.剧情 替换原文。
    // 打字机在流式阶段推送的是完整原文（含协议头，如 == 标题 ==、== STATE == 等），
    // 解析后要换成只有正文的版本，否则玩家会看到协议行。
    APP停止打字机()
    setText(APP剧情标题, r.标题 || '')
    APP渲染剧情(r.剧情 || '')

    // 更新说话人 / 舞台
    APP渲染舞台(state, r.说话人 || null)

    // 更新万象
    APP渲染万象(r.万象)

    // 写自动存档
    writeSave(localStorage, 'auto', state, journal, APP会话.最近回合)
    // 刷新面板
    APP渲染面板(state)
    // 更新顶栏
    const vm2 = gameViewModel({ state, 回合: r, 说话人: r.说话人 })
    setText(APP节点名, vm2.顶栏.地点)
    setText(APP时间, vm2.顶栏.时间)
    setText(APP海拔, vm2.顶栏.海拔 + 'm')
    setText(APP天气, vm2.顶栏.天气)
    // 结局跳转
    if (state.phase === '结局') {
      router.go('ending')
      return
    }
    // 更新选项
    APP当前选项 = vm2.选项
    APP渲染选项(APP当前选项, false)
    APP渲染行动区()
    APP渲染控制按钮('idle')
  }

  // 初始渲染选项与原生操作
  APP渲染选项(APP初始选项, false)
  APP渲染行动区()
  APP渲染控制按钮('idle')
}

// ──────────────────────────────────────────────────────────────────
// renderPanel：左侧面板（可独立刷新）
// ──────────────────────────────────────────────────────────────────
function renderPanel(vm) {
  const APP面板 = el('div', { class: 'panel' })

  // PC 基础信息
  const APP名字行 = el('div', { class: 'game-stat-row' })
  const APP名字标签 = el('span', { class: 'game-stat-label' })
  setText(APP名字标签, '角色')
  const APP名字值 = el('span', { class: 'game-stat-val' })
  setText(APP名字值, vm.名字 + '（' + vm.职业 + '）')
  APP名字行.appendChild(APP名字标签)
  APP名字行.appendChild(APP名字值)
  APP面板.appendChild(APP名字行)

  // 体力
  const APP体力行 = el('div', { class: 'game-stat-row' })
  const APP体力标签 = el('span', { class: 'game-stat-label' })
  setText(APP体力标签, '体力')
  const APP体力值 = el('span', { class: vm.体力告警 ? 'game-stat-val danger' : 'game-stat-val' })
  setText(APP体力值, vm.体力)
  APP体力行.appendChild(APP体力标签)
  APP体力行.appendChild(APP体力值)
  APP面板.appendChild(APP体力行)

  const APP体力条容器 = el('div', { class: 'meter' })
  const APP体力条 = el('div', {
    class: vm.体力告警 ? 'meter-bar danger' : 'meter-bar',
    style: 'width:' + vm.体力 + '%',
  })
  APP体力条容器.appendChild(APP体力条)
  APP面板.appendChild(APP体力条容器)

  // 负重
  const APP负重行 = el('div', { class: 'game-stat-row', style: 'margin-top:8px' })
  const APP负重标签 = el('span', { class: 'game-stat-label' })
  setText(APP负重标签, '负重')
  const APP负重档 = vm.负重.档
  const APP负重值 = el('span', {
    class: APP负重档 === '超重' ? 'game-stat-val danger' : (APP负重档 === '偏重' ? 'game-stat-val warn' : 'game-stat-val'),
  })
  setText(APP负重值, vm.负重.当前 + 'kg / ' + vm.负重.上限 + 'kg')
  APP负重行.appendChild(APP负重标签)
  APP负重行.appendChild(APP负重值)
  APP面板.appendChild(APP负重行)

  const APP负重条容器 = el('div', { class: 'meter' })
  const APP负重条 = el('div', {
    class: APP负重档 === '超重' ? 'meter-bar danger' : (APP负重档 === '偏重' ? 'meter-bar warn' : 'meter-bar'),
    style: 'width:' + Math.round(vm.负重.比 * 100) + '%',
  })
  APP负重条容器.appendChild(APP负重条)
  APP面板.appendChild(APP负重条容器)

  // 现金
  const APP现金行 = el('div', { class: 'game-stat-row', style: 'margin-top:8px' })
  const APP现金标签 = el('span', { class: 'game-stat-label' })
  setText(APP现金标签, '现金')
  const APP现金值 = el('span', { class: 'game-stat-val' })
  setText(APP现金值, '¥' + vm.现金)
  APP现金行.appendChild(APP现金标签)
  APP现金行.appendChild(APP现金值)
  APP面板.appendChild(APP现金行)

  // 同行者
  if (vm.同行者.length > 0) {
    const APP同行者标题 = el('div', { class: 'game-stat-row', style: 'margin-top:10px' })
    const APP同行者标签 = el('span', { class: 'game-stat-label' })
    setText(APP同行者标签, '同行者')
    APP同行者标题.appendChild(APP同行者标签)
    APP面板.appendChild(APP同行者标题)

    for (const p of vm.同行者) {
      const APP同行行 = el('div', { class: 'companion-row' })
      const APP同行立绘 = el('div', { class: 'companion-portrait' })
      portraitInto(APP同行立绘, p.npcId)
      const APP同行信息 = el('div')
      const APP同行名 = el('div')
      setText(APP同行名, p.名称)
      const APP同行好感 = el('div', { class: 'muted' })
      setText(APP同行好感, p.分级 + ' · ' + p.好感)
      APP同行信息.appendChild(APP同行名)
      APP同行信息.appendChild(APP同行好感)
      APP同行行.appendChild(APP同行立绘)
      APP同行行.appendChild(APP同行信息)
      APP面板.appendChild(APP同行行)
    }
  }

  // 背包概览（只展示有余量告警的物品）
  const APP告警物品 = vm.背包.filter((i) => i.余量告警)
  if (APP告警物品.length > 0) {
    const APP背包标题 = el('div', { class: 'game-stat-row', style: 'margin-top:10px' })
    const APP背包标签 = el('span', { class: 'game-stat-label' })
    setText(APP背包标签, '告急物资')
    APP背包标题.appendChild(APP背包标签)
    APP面板.appendChild(APP背包标题)

    for (const i of APP告警物品) {
      const APP物品行 = el('div', { class: 'pack-item low' })
      const APP物品名 = el('span')
      setText(APP物品名, i.名称)
      const APP物品余 = el('span')
      setText(APP物品余, '余' + i.余量 + '%')
      APP物品行.appendChild(APP物品名)
      APP物品行.appendChild(APP物品余)
      APP面板.appendChild(APP物品行)
    }
  }

  return APP面板
}

// ──────────────────────────────────────────────────────────────────
// renderEnding：结局页
// ──────────────────────────────────────────────────────────────────
function renderEnding(router) {
  const root = document.getElementById('screen-ending')
  clear(root)

  const { state, journal } = APP会话
  const vm = endingViewModel(state, journal)

  if (!vm) {
    // 不该发生（只有 phase==='结局' 才路由到这里），保底处理
    root.appendChild(el('p', { class: 'muted', text: '结局数据缺失，请检查状态。' }))
    return
  }

  // 标题区
  const APP标题区 = el('div', { class: 'ending-header' })
  const APP定性 = el('div', { class: 'ending-type' })
  setText(APP定性, vm.定性)
  const APP标题 = el('h1', { class: 'ending-title' })
  setText(APP标题, vm.标题)
  const APP说明 = el('p', { class: 'ending-desc' })
  setText(APP说明, vm.说明)
  APP标题区.appendChild(APP定性)
  APP标题区.appendChild(APP标题)
  APP标题区.appendChild(APP说明)

  if (vm.原因) {
    const APP原因 = el('p', { class: 'ending-desc' })
    setText(APP原因, vm.原因)
    APP标题区.appendChild(APP原因)
  }

  if (vm.罚款) {
    const APP罚款 = el('p', { class: 'ending-fine' })
    setText(APP罚款, '罚款：¥' + vm.罚款)
    APP标题区.appendChild(APP罚款)
  }

  root.appendChild(APP标题区)

  // 回顾：基本数据
  const APP基本回顾 = el('div', { class: 'recap-section' })
  const APP基本标题 = el('h2', { text: '旅程回顾' })
  APP基本回顾.appendChild(APP基本标题)

  const APP天数行 = el('div', { class: 'recap-item' })
  setText(APP天数行, '坚持了 ' + vm.回顾.天数 + ' 天')
  APP基本回顾.appendChild(APP天数行)

  if (vm.回顾.最高点) {
    const APP最高点行 = el('div', { class: 'recap-item recap-peak' })
    setText(APP最高点行, '最高点：' + vm.回顾.最高点.名称 + ' ' + vm.回顾.最高点.海拔 + 'm')
    APP基本回顾.appendChild(APP最高点行)
  }

  root.appendChild(APP基本回顾)

  // 经过节点
  if (vm.回顾.节点.length > 0) {
    const APP节点区 = el('div', { class: 'recap-section' })
    const APP节点标题 = el('h2', { text: '走过的地方' })
    APP节点区.appendChild(APP节点标题)
    const APP节点序列 = el('div', { class: 'recap-item' })
    setText(APP节点序列, vm.回顾.节点.join(' → '))
    APP节点区.appendChild(APP节点序列)
    root.appendChild(APP节点区)
  }

  // 关键事件
  if (vm.回顾.事件.length > 0) {
    const APP事件区 = el('div', { class: 'recap-section' })
    const APP事件标题 = el('h2', { text: '关键事件' })
    APP事件区.appendChild(APP事件标题)
    for (const e of vm.回顾.事件) {
      const APP事件行 = el('div', { class: 'recap-item' })
      setText(APP事件行, e)
      APP事件区.appendChild(APP事件行)
    }
    root.appendChild(APP事件区)
  }

  // 好感
  if (vm.回顾.好感.length > 0) {
    const APP好感区 = el('div', { class: 'recap-section' })
    const APP好感标题 = el('h2', { text: '同行者' })
    APP好感区.appendChild(APP好感标题)
    for (const p of vm.回顾.好感) {
      const APP好感行 = el('div', { class: 'recap-item' })
      const APP好感名 = el('span')
      setText(APP好感名, p.名称)
      const APP好感值 = el('span', { class: 'muted' })
      setText(APP好感值, '　' + p.分级 + '（' + (p.在队 ? '在队' : '已离队') + '）')
      APP好感行.appendChild(APP好感名)
      APP好感行.appendChild(APP好感值)
      APP好感区.appendChild(APP好感行)
    }
    root.appendChild(APP好感区)
  }

  // 再来一局。此前这一页没有任何按钮，自动存档又停在 phase=结局——
  // 刷新永远回到这里，重开的唯一办法是手动清 localStorage。死胡同。
  const APP再来 = el('button', {
    class: 'primary',
    onclick: () => {
      deleteSave(localStorage, 'auto')
      APP会话.state = null
      APP会话.journal = null
      APP会话.最近回合 = []
      APP会话.队友 = []
      APP会话.已重抽 = 0
      APP会话.cart = {}
      APP会话.种子 = Math.floor(Math.random() * 2 ** 31)
      APP会话.draft = randomDraft(makeRng(APP会话.种子))
      router.go('create')
    },
  }, ['再来一局 →'])
  root.appendChild(el('div', { class: 'row', style: 'margin-top:16px' }, [APP再来]))
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
  router.register('game', { onEnter: () => renderGame(router) })
  router.register('ending', { onEnter: () => renderEnding(router) })

  // 有存档就还原状态。但配置不可用（换了浏览器、key 被清）时必须先落在
  // 配置屏——此前见档就直进 game，第一回合报「还没填 API key」，且无路可回。
  const APP存档 = readSave(localStorage, 'auto')
  if (APP存档 && APP存档.state) {
    APP会话.state = APP存档.state
    APP会话.journal = APP存档.journal
    // 最近回合从存档还原——它是剧情连贯性的命脉。此前刷新即清零，
    // 模型拿不到上文，故事必从中间断档另起炉灶。
    APP会话.最近回合 = APP存档.最近回合 || []
  }

  const 配置可用 = validateConfig(APP会话.config).ok
  if (!配置可用) {
    router.go('config')
  } else if (APP会话.state && APP会话.state.phase !== '结局') {
    router.go('game')
  } else if (APP会话.state && APP会话.state.phase === '结局') {
    router.go('ending')
  } else {
    router.go('config')
  }
}

if (typeof document !== 'undefined') 启动()
