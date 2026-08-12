import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configViewModel, normalizeConfig, validateConfig, CONFIG_KEY, loadConfig, saveConfig } from '../src/ui/config.js'
import { PRESETS } from '../src/llm/client.js'

function 假存储() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

test('视图模型列出全部预设，并标出当前选中', () => {
  const vm = configViewModel({ presetId: 'siliconflow' })
  assert.equal(vm.预设.length, PRESETS.length)
  assert.equal(vm.预设.find((p) => p.选中).id, 'siliconflow')
})

test('选了预设就带出默认 baseURL 与模型', () => {
  const c = normalizeConfig({ presetId: 'deepseek' })
  const 预设 = PRESETS.find((p) => p.id === 'deepseek')
  assert.equal(c.baseURL, 预设.baseURL)
  assert.equal(c.model, 预设.默认模型)
})

test('自定义值不会被预设覆盖掉', () => {
  const c = normalizeConfig({ presetId: 'deepseek', model: 'deepseek-reasoner' })
  assert.equal(c.model, 'deepseek-reasoner')
})

test('校验：没填 key 不放行', () => {
  const r = validateConfig({ presetId: 'deepseek', apiKey: '' })
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('key')))
})

test('校验：baseURL 必须是 http(s)', () => {
  const r = validateConfig({ presetId: 'custom', apiKey: 'k', baseURL: 'ftp://x', model: 'm' })
  assert.equal(r.ok, false)
  assert.ok(r.问题.some((x) => x.includes('baseURL')))
})

test('校验：填齐了就放行', () => {
  assert.equal(validateConfig({ presetId: 'deepseek', apiKey: 'sk-x' }).ok, true)
})

test('存取走 localStorage，key 明确只留在本地', () => {
  const st = 假存储()
  saveConfig(st, { presetId: 'deepseek', apiKey: 'sk-secret', model: 'm' })
  assert.equal(loadConfig(st).apiKey, 'sk-secret')
  assert.ok(CONFIG_KEY.startsWith('aotai_'))
})

test('读不到配置时给一份可用的默认值，而不是 null', () => {
  const c = loadConfig(假存储())
  assert.equal(typeof c.presetId, 'string')
  assert.equal(c.apiKey, '')
})

test('坏掉的配置不拖垮应用', () => {
  const st = 假存储()
  st.setItem(CONFIG_KEY, '{坏的')
  assert.equal(loadConfig(st).apiKey, '')
})

test('脱敏只露头尾，中间一律遮住', () => {
  const vm = configViewModel({ presetId: 'deepseek', apiKey: 'sk-abcdefghijklmnop' })
  assert.ok(!vm.key脱敏.includes('defghijklm'), `脱敏没遮住：${vm.key脱敏}`)
  assert.ok(vm.key脱敏.startsWith('sk-'))
})

test('视图模型里不带明文 key', () => {
  const 密钥 = 'sk-abcdefghijklmnopqrstuvwxyz'
  const vm = configViewModel({ presetId: 'deepseek', apiKey: 密钥 })
  const 全文 = JSON.stringify(vm)
  assert.ok(!全文.includes(密钥), '整个视图模型序列化后仍能搜到明文 key')
  assert.equal(vm.config.apiKey, undefined)
  assert.equal(vm.有key, true, '但要能告诉界面「填过了」')
  assert.equal(configViewModel({ presetId: 'deepseek' }).有key, false)
  // 展示用字段仍在
  assert.ok(vm.config.baseURL && vm.config.model)
})
