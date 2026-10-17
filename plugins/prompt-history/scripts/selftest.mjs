/**
 * dsh-tweaks-prompt-history 自测。
 *
 * 两部分：
 * 1. 不需要 DSH 部署（CI 也跑这一段）：
 *    - 插件源码契约面：inject 服务名、席位键 / 条目 id、键盘拦截配方（含 Shift 放行）、
 *      [data-composer-card] DOM 判据、locale 命名空间，以及「提取逻辑只在 shared/history.ts」；
 *    - 纯逻辑（历史提取）：用 esbuild 把 src/shared/history.ts 现场 bundle 成 ESM data URL
 *      再 import，覆盖 user / steering 过滤、多块换行、空块语义、相邻去重与上限；
 *    - client bundle 协议：window.__ModuleLoader__.load({ id, factory }) 外壳、
 *      工厂只 require 页面种子模块（react / react/jsx-runtime）、sourcemap trailer 合法；
 *    - 入口行为：在 vm 里执行构建产物，用结构化 stub 驱动 apply，
 *      核对 locale.register / bind 与 slots.inject / register 的接线。
 * 2. 需要一份完整 DSH 安装（DSH_CONTRACT_HOMES=<部署根>）：
 *    - 按 README「DSH 兼容性」表逐条断言官方产物原文：overlay 席位 kind / scope、
 *      会话标准 props、useChat / legacy.nodes 快照类型、节点 kind、inputActions.setDraft、
 *      locale 签名、client bundle 协议；
 *    - 运行时 DOM 判据：官方 conversation 产物里 "data-composer-card" 与
 *      renderSlot("conversation.input.overlay") 仍在同一个 composer 卡片子树。
 *    没有部署时这一段整体跳过（打印 info，exit 0），CI 行为不变。
 *
 * 用法：node build.mjs && node scripts/selftest.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

const CLIENT_BUNDLE = new URL('../lib/client.js', import.meta.url)
const CLIENT_MAP = new URL('../lib/client.js.map', import.meta.url)

if (!existsSync(CLIENT_BUNDLE)) {
  console.error('missing ' + fileURLToPath(CLIENT_BUNDLE) + '; run "node build.mjs" first')
  process.exit(2)
}

let passed = 0
const failures = []

/** 跑一个用例；失败不中断，最后统一退出码。 */
function test(name, run) {
  try {
    run()
    passed += 1
    console.log('ok - ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.error('not ok - ' + name)
    console.error(error)
  }
}

/** 读插件里的源码 / 构建产物。 */
function pluginFile(relative) {
  return readFileSync(new URL('../' + relative, import.meta.url), 'utf8')
}

// ---------------------------------------------------------------------------
// client bundle 协议（不需要 DSH 部署：读本仓库构建产物）
// ---------------------------------------------------------------------------

test('bundle 协议：经典脚本外壳 + 自注册 id + sourcemap trailer', () => {
  const bundle = pluginFile('lib/client.js')
  assert.ok(bundle.startsWith('window.__ModuleLoader__.load({'), '客户端产物必须是经典脚本外壳，不能是 ESM')
  assert.ok(bundle.includes('id: "dsh-tweaks-prompt-history",'), '工厂 id 必须等于包名')
  assert.ok(bundle.includes('factory: (require) => {'), '缺 loader 工厂')
  assert.ok(bundle.trimEnd().endsWith('//# sourceMappingURL=client.js.map'), '缺 sourcemap trailer')
  const required = [
    ...new Set(
      bundle
        .split('require("')
        .slice(1)
        .map((rest) => rest.slice(0, rest.indexOf('"'))),
    ),
  ].sort()
  assert.deepEqual(required, ['react', 'react/jsx-runtime'], '工厂只允许 require 页面种子模块')
})

test('bundle 协议：sourcemap 是合法 v3 且内嵌源码', () => {
  assert.ok(existsSync(CLIENT_MAP), '缺 lib/client.js.map（build.mjs 必须开 sourcemap）')
  const map = JSON.parse(readFileSync(CLIENT_MAP, 'utf8'))
  assert.equal(map.version, 3)
  assert.ok(Array.isArray(map.sources) && map.sources.length > 0)
  assert.ok(Array.isArray(map.sourcesContent) && map.sourcesContent.length === map.sources.length)
  assert.ok(typeof map.mappings === 'string' && map.mappings.length > 0)
})

// ---------------------------------------------------------------------------
// 插件源码契约面（不需要 DSH 部署）
// ---------------------------------------------------------------------------

test('插件源码契约面：inject / 席位键 / 条目 id', () => {
  const index = pluginFile('src/client/index.ts')
  assert.ok(index.includes("export const inject = ['slots', 'locale']"), 'inject 必须是 slots + locale')
  assert.ok(index.includes("slots.inject('conversation.input.overlay'"), 'slots.inject 的席位键')
  assert.ok(index.includes("name: 'conversation.input.overlay'"), 'register 的席位键')
  assert.ok(index.includes("export const OVERLAY_ENTRY_ID = 'prompt-history'"), 'overlay 条目 id')
  assert.ok(index.includes('id: OVERLAY_ENTRY_ID'), '列表项必须用自有 id（不能替换官方条目）')
  assert.ok(index.includes('order: 80'), '列表项 order')
  assert.ok(index.includes("locale.register(LOCALE_NS, 'zh', zh)"))
  assert.ok(index.includes("locale.register(LOCALE_NS, 'en', en)"))
  assert.ok(index.includes('bind(LOCALE_NS)'), 'locale.bind 绑定本插件命名空间')
})

test('插件源码契约面：键盘拦截配方与 DOM 判据', () => {
  const overlay = pluginFile('src/client/overlay.tsx')
  assert.ok(overlay.includes("closest('[data-composer-card]')"), 'composer 卡片作用域判据')
  assert.ok(overlay.includes("document.addEventListener('keydown', onKeyDown, true)"), 'document 捕获相监听')
  assert.ok(
    overlay.includes('if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return'),
    '避开修饰键：必须包含 event.shiftKey（Shift+↑/↓ 放行给编辑器自己的选择行为）',
  )
  assert.ok(overlay.includes('event.isComposing || event.keyCode === 229'), '避开 IME 组合期')
  assert.ok(overlay.includes('target.isContentEditable'), '只接管 contenteditable')
  assert.ok(overlay.includes('inputActions.setDraft(text)'), '改草稿只能走 setDraft')
  assert.ok(
    overlay.includes("if (currentDraft.trim() !== '' || history.length === 0) return"),
    '只在空草稿时接管 ↑（不与斜杠 / 引用菜单冲突）',
  )
  assert.ok(overlay.includes('snapshot.legacy.nodes'), '历史来自 useChat 的 legacy.nodes')
  assert.ok(overlay.includes("phase !== 'plain'"), '非 plain 相位不接管')
})

test('插件源码契约面：提取逻辑在 shared/history.ts，overlay 只消费', () => {
  const overlay = pluginFile('src/client/overlay.tsx')
  const history = pluginFile('src/shared/history.ts')
  assert.ok(
    overlay.includes("import { extractHistory } from '../shared/history.js'"),
    'overlay 必须从 shared/history.ts 导入提取逻辑（单一来源）',
  )
  assert.ok(overlay.includes('extractHistory(nodes)'), 'overlay 必须实际调用 extractHistory')
  assert.ok(!overlay.includes('function extractHistory'), '提取逻辑不能内联回 overlay（会与纯逻辑自测脱节）')
  assert.ok(history.includes("message.kind !== 'user' && message.kind !== 'steering'"), '只取 user / steering 节点')
  assert.ok(history.includes('export const HISTORY_LIMIT = 200'), '历史上限 200 条')
})

test('插件源码契约面：locale 命名空间与中英文案键集一致', () => {
  const locales = pluginFile('src/client/locales.ts')
  assert.ok(locales.includes("export const LOCALE_NS = 'prompt-history'"))
  const zhStart = locales.indexOf('export const zh')
  const enStart = locales.indexOf('export const en')
  assert.ok(zhStart >= 0 && enStart > zhStart, 'locales.ts 里应有 zh / en 两份字典')
  const keysOf = (segment) =>
    segment
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.endsWith(',') && line.includes(': '))
      .map((line) => line.slice(0, line.indexOf(':')))
      .sort()
  const zhKeys = keysOf(locales.slice(zhStart, enStart))
  const enKeys = keysOf(locales.slice(enStart))
  assert.deepEqual(zhKeys, ['browseTitle', 'position'])
  assert.deepEqual(enKeys, zhKeys, 'en 键集必须与 zh 一致')
  assert.ok(locales.includes("position: '历史 {n}/{total}'"))
  assert.ok(locales.includes("position: 'History {n}/{total}'"))
  assert.ok(locales.includes("browseTitle: '历史提示词（↑ / ↓ 切换）'"))
  assert.ok(locales.includes("browseTitle: 'Prompt history (↑ / ↓ to browse)'"))
})

test('包声明与 bundle patch：双面插件 + selftest 脚本', () => {
  const pkg = JSON.parse(pluginFile('package.json'))
  assert.equal(pkg.name, 'dsh-tweaks-prompt-history')
  const versionParts = String(pkg.version).split('.')
  assert.equal(versionParts.length, 3, 'version 必须是 x.y.z')
  for (const part of versionParts) assert.ok(Number.isInteger(Number(part)) && Number(part) >= 0)
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.scripts.selftest, 'node scripts/selftest.mjs')
  assert.equal(pkg.scripts.build, 'node build.mjs')
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('src'), 'files 必须含 src（发布的源码投影）')
  const patch = pluginFile('cordis.patch.yml')
  assert.ok(patch.includes('- id: prompt-history'), 'bundle patch 的 entry id')
  assert.ok(patch.includes('name: dsh-tweaks-prompt-history'), 'bundle patch 的包名')
})

// ---------------------------------------------------------------------------
// 纯逻辑：历史提取（不需要 DSH 部署：esbuild 现场 bundle shared/history.ts）
// ---------------------------------------------------------------------------

/**
 * 把 src/shared/history.ts 现场 bundle 成 ESM data URL 再 import：
 * 不必为测试单独产出构建文件，也不会把 React / DOM 带进来。
 */
async function loadHistoryModule() {
  const entry = fileURLToPath(new URL('../src/shared/history.ts', import.meta.url))
  const built = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const code = built.outputFiles[0]?.text
  assert.ok(code !== undefined, 'esbuild 没有产出历史提取模块')
  return await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))
}

const { extractHistory, HISTORY_LIMIT } = await loadHistoryModule()

test('纯逻辑：只取 user / steering 节点，时间正序', () => {
  const nodes = [
    { kind: 'assistant', content: [{ type: 'text', text: 'not me' }] },
    { kind: 'user', content: [{ type: 'text', text: 'first' }] },
    { kind: 'steering', content: [{ type: 'text', text: 'interjection' }] },
    { kind: 'tool', content: [{ type: 'text', text: 'tool output' }] },
    { kind: 'user', content: [{ type: 'text', text: 'last' }] },
  ]
  assert.deepEqual(extractHistory(nodes), ['first', 'interjection', 'last'])
})

test('纯逻辑：多段 text 块之间用换行连接（不粘连）', () => {
  const nodes = [
    {
      kind: 'user',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    },
  ]
  assert.deepEqual(extractHistory(nodes), ['line one\nline two'])
})

test('纯逻辑：空内容 / 非数组 / 非文本块被跳过', () => {
  const nodes = [
    { kind: 'user', content: 'not-an-array' },
    { kind: 'user', content: [] },
    { kind: 'user', content: [{ type: 'image', text: 'ignored' }] },
    { kind: 'user', content: [{ type: 'text', text: 42 }] },
    { kind: 'user', content: [{ type: 'text' }] },
    null,
    'not-an-object',
    { kind: 'user', content: [{ type: 'text', text: 'kept' }] },
  ]
  assert.deepEqual(extractHistory(nodes), ['kept'])
})

test('纯逻辑：纯空白 text 块不参与换行连接（不产生空行）', () => {
  const nodes = [
    {
      kind: 'user',
      content: [
        { type: 'text', text: '  ' },
        { type: 'text', text: 'a' },
        { type: 'text', text: '' },
        { type: 'text', text: '   ' },
        { type: 'text', text: 'b' },
        { type: 'text', text: '\n\t' },
      ],
    },
  ]
  // 未过滤空白块时会得到 'a\n\n   \nb' 这类带空行的结果。
  assert.deepEqual(extractHistory(nodes), ['a\nb'])
  // 整条消息只有空白块时不产生历史。
  assert.deepEqual(extractHistory([{ kind: 'user', content: [{ type: 'text', text: ' \n ' }] }]), [])
})

test('纯逻辑：相邻重复去重、非相邻保留', () => {
  const nodes = [
    { kind: 'user', content: [{ type: 'text', text: '  same  ' }] },
    { kind: 'user', content: [{ type: 'text', text: 'same' }] },
    { kind: 'user', content: [{ type: 'text', text: 'same' }] },
    { kind: 'user', content: [{ type: 'text', text: 'different' }] },
    { kind: 'user', content: [{ type: 'text', text: 'same' }] },
  ]
  assert.deepEqual(extractHistory(nodes), ['same', 'different', 'same'])
})

test('纯逻辑：超过上限时保留最近 HISTORY_LIMIT 条', () => {
  const nodes = Array.from({ length: HISTORY_LIMIT + 5 }, (_value, index) => ({
    kind: 'user',
    content: [{ type: 'text', text: 'prompt-' + String(index) }],
  }))
  const history = extractHistory(nodes)
  assert.equal(history.length, HISTORY_LIMIT)
  assert.equal(history[0], 'prompt-5', '应丢弃最早的 5 条')
  assert.equal(history.at(-1), 'prompt-' + String(HISTORY_LIMIT + 4), '应保留最新一条')
})

test('纯逻辑：HISTORY_LIMIT = 200（README 与测试共用口径）', () => {
  assert.equal(HISTORY_LIMIT, 200)
})

// ---------------------------------------------------------------------------
// 客户端入口行为（不需要 DSH 部署：vm 执行构建产物 + 结构化 stub）
// ---------------------------------------------------------------------------

/** 在 vm 里执行客户端 bundle，返回模块导出；工厂 require 只解析页面种子模块。 */
function loadClientBundle() {
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          registration = entry
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(pluginFile('lib/client.js'), sandbox, { filename: 'lib/client.js' })
  assert.ok(registration !== undefined, 'bundle 没有调用 window.__ModuleLoader__.load')
  assert.equal(registration.id, 'dsh-tweaks-prompt-history')
  const seed = {
    react: { createElement: (type, props) => ({ type, props }) },
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
  }
  return registration.factory((specifier) => {
    assert.ok(Object.hasOwn(seed, specifier), '工厂 require 了非页面种子模块：' + specifier)
    return seed[specifier]
  })
}

test('客户端入口 apply：locale.register / bind 与 slots.inject / register 接线', () => {
  const client = loadClientBundle()
  assert.deepEqual([...client.inject], ['slots', 'locale'])

  const locale = { registerCalls: [], bindCalls: [] }
  locale.service = {
    register(ns, language, dictionary) {
      locale.registerCalls.push({ ns, language, dictionary })
      return () => undefined
    },
    bind(ns) {
      locale.bindCalls.push(ns)
      return (key) => key
    },
  }
  const slots = { injectCalls: [], registerCalls: [] }
  slots.service = {
    inject(key, callback) {
      slots.injectCalls.push(key)
      slots.injected = callback()
    },
    register(options, component) {
      slots.registerCalls.push({ options, component })
      return () => undefined
    },
  }
  const effects = []
  const ctx = {
    get(name) {
      if (name === 'locale') return locale.service
      if (name === 'slots') return slots.service
      return undefined
    },
    effect(callback, label) {
      effects.push({ label, dispose: callback() })
    },
  }
  client.apply(ctx)

  assert.deepEqual(locale.registerCalls.map((call) => call.language), ['zh', 'en'])
  for (const call of locale.registerCalls) {
    assert.equal(call.ns, 'prompt-history')
    assert.deepEqual(Object.keys(call.dictionary).sort(), ['browseTitle', 'position'])
  }
  assert.deepEqual(locale.bindCalls, ['prompt-history'])
  assert.deepEqual(effects.map((effect) => effect.label), ['prompt-history: dictionaries'])
  assert.deepEqual(slots.injectCalls, ['conversation.input.overlay'])
  assert.equal(slots.registerCalls.length, 1)
  const registration = slots.registerCalls[0]
  // 这些对象来自 vm 里的另一个 realm，不能直接 deepStrictEqual（原型不同），逐字段核对。
  assert.equal(registration.options.name, 'conversation.input.overlay')
  assert.equal(registration.options.id, 'prompt-history')
  assert.equal(registration.options.order, 80)
  assert.equal(typeof registration.component, 'function')
  assert.equal(typeof slots.injected, 'function', 'slots.inject 回调必须把注册 disposer 交还')
})

test('客户端入口 apply：缺 locale / slots 时不抛（静默降级）', () => {
  const client = loadClientBundle()
  assert.doesNotThrow(() => client.apply({ get: () => undefined }))
  const localeOnly = {
    register: () => () => undefined,
    bind: () => (key) => key,
  }
  assert.doesNotThrow(() => client.apply({ get: (name) => (name === 'locale' ? localeOnly : undefined) }))
  const slotsCalls = []
  const slotsOnly = {
    inject(key) {
      slotsCalls.push(key)
    },
    register() {
      return () => undefined
    },
  }
  assert.doesNotThrow(() => client.apply({ get: (name) => (name === 'slots' ? slotsOnly : undefined) }))
  assert.deepEqual(slotsCalls, ['conversation.input.overlay'])
})

// ---------------------------------------------------------------------------
// 官方契约原文（需要一份完整 DSH 安装；未提供部署时整段跳过）
// ---------------------------------------------------------------------------

/**
 * 官方产物里必须逐字出现的契约原文（任一片段消失 = 契约漂移）。
 * path 相对 <部署>/node_modules/@deepseek-ai。
 */
const OFFICIAL_CONTRACT_FACTS = [
  {
    name: 'overlay 席位 + useInput / inputActions 会话标准 props',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts',
    includes: [
      "'conversation.input.overlay': {",
      'useInput: SnapshotSelectorHook<InputState>;',
      'inputActions: InputActions;',
    ],
  },
  {
    name: 'useChat 是 Chat 注入的会话标准 prop',
    path: 'dsh-client-ui-chat/lib/types/client/contract/slots.d.ts',
    includes: ["declare module '@deepseek-ai/dsh-client-ui-slots' {", 'useChat: UseChat;'],
  },
  {
    name: 'Chat 快照的 legacy 投影与 nodes 数组',
    path: 'dsh-client-ui-chat/lib/types/client/contract/snapshot.d.ts',
    includes: [
      'export interface LegacyConversationSlice {',
      'readonly nodes: readonly ConversationNode[];',
      'export interface ChatSnapshot {',
      'readonly legacy: LegacyConversationSlice;',
    ],
  },
  {
    name: '用户消息节点 kind user / steering 与 content 块',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/records.d.ts',
    includes: [
      'export interface UserMessageNode {',
      "kind: 'user';",
      'export interface SteeringMessageNode {',
      "kind: 'steering';",
      'content: readonly ContentBlock[];',
    ],
  },
  {
    name: 'inputActions.setDraft / InputState.draft / phase plain 并集',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/input.d.ts',
    includes: [
      'export interface InputActions {',
      'setDraft(text: string): void;',
      'export interface InputState {',
      'readonly draft: string;',
      "readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting';",
    ],
  },
  {
    name: 'locale 三参 register 与 bind 签名',
    path: 'dsh-client-locale/lib/types/client/index.d.ts',
    includes: ['register(ns: string, locale: string, dict: LocaleDict): () => void;', 'bind(ns: string): Translate;'],
  },
  {
    name: 'locale 运行时仍 provide locale 服务并实现 register / bind',
    path: 'dsh-client-locale/lib/client.js',
    includes: ['ctx.provide("locale", locale);', 'register(ns, localeOrDicts, dict) {', 'bind(ns) {'],
  },
  {
    name: 'client bundle 加载协议 window.__ModuleLoader__.load({ id, factory })',
    path: 'dsh-client-modules/lib/types/client/manifest.d.ts',
    includes: ['window.__ModuleLoader__.load({id, factory})', 'ClientModuleLoader'],
  },
]

/**
 * 顺序 / 结构判据：单纯「包含」表达不了的契约。
 * @returns 失败原因；通过时 undefined。
 */
const OFFICIAL_STRUCTURE_CHECKS = [
  {
    name: 'overlay 席位声明为 kind list / scope session（插件注册列表项的前提）',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts',
    check(source) {
      const start = source.indexOf("'conversation.input.overlay': {")
      if (start < 0) return 'missing conversation.input.overlay declaration'
      const block = source.slice(start, start + 240)
      if (!block.includes("kind: 'list';")) return 'overlay slot is no longer kind list'
      if (!block.includes("scope: 'session';")) return 'overlay slot is no longer session scoped'
      return undefined
    },
  },
  {
    name: 'useChat 仍声明在 Chat 的 SessionStandardProps 里',
    path: 'dsh-client-ui-chat/lib/types/client/contract/slots.d.ts',
    check(source) {
      const start = source.indexOf('interface SessionStandardProps {')
      if (start < 0) return 'missing interface SessionStandardProps'
      if (!source.slice(start, start + 600).includes('useChat: UseChat;')) {
        return 'useChat is no longer a Chat session standard prop'
      }
      return undefined
    },
  },
  {
    name: 'legacy.nodes 仍是 LegacyConversationSlice 的节点数组',
    path: 'dsh-client-ui-chat/lib/types/client/contract/snapshot.d.ts',
    check(source) {
      const start = source.indexOf('export interface LegacyConversationSlice {')
      if (start < 0) return 'missing LegacyConversationSlice'
      if (!source.slice(start, start + 500).includes('readonly nodes: readonly ConversationNode[];')) {
        return 'LegacyConversationSlice.nodes is missing'
      }
      return undefined
    },
  },
  {
    name: "用户 / steering 节点 kind 仍是 'user' / 'steering'（历史提取的过滤条件）",
    path: 'dsh-client-ui-conversation/lib/types/client/contract/records.d.ts',
    check(source) {
      const user = source.indexOf('export interface UserMessageNode {')
      if (user < 0) return 'missing UserMessageNode'
      if (!source.slice(user, user + 400).includes("kind: 'user';")) return "UserMessageNode kind is not 'user'"
      const steering = source.indexOf('export interface SteeringMessageNode {')
      if (steering < 0) return 'missing SteeringMessageNode'
      if (!source.slice(steering, steering + 500).includes("kind: 'steering';")) {
        return "SteeringMessageNode kind is not 'steering'"
      }
      return undefined
    },
  },
  {
    name: 'InputActions.setDraft(text) 仍在 InputActions 面上（插件改草稿的唯一入口）',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/input.d.ts',
    check(source) {
      const start = source.indexOf('export interface InputActions {')
      if (start < 0) return 'missing export interface InputActions'
      const next = source.indexOf('export interface', start + 1)
      const body = source.slice(start, next < 0 ? start + 4000 : next)
      if (!body.includes('setDraft(text: string): void;')) return 'InputActions.setDraft(text: string) is missing'
      return undefined
    },
  },
  {
    name: '运行时 DOM：overlay 仍渲染在 data-composer-card 卡片子树内（↑/↓ 静默失效的告警线）',
    path: 'dsh-client-ui-conversation/lib/client.js',
    check(source) {
      const card = source.indexOf('"data-composer-card": true')
      if (card < 0) return 'missing "data-composer-card": true attribute'
      const overlay = source.indexOf('renderSlot("conversation.input.overlay"')
      if (overlay < 0) return 'missing renderSlot("conversation.input.overlay") call'
      if (overlay < card) return 'overlay renderSlot no longer follows the composer card attribute in source order'
      const distance = overlay - card
      if (distance > 2000) {
        return 'overlay renderSlot moved out of the composer card subtree (distance ' + String(distance) + ')'
      }
      return undefined
    },
  },
]

/** 把环境变量给的一项收成「直接含 @deepseek-ai 的那层目录」。 */
function officialRootOf(entry) {
  const direct = join(entry, 'node_modules/@deepseek-ai')
  if (existsSync(direct)) return direct
  const trimmed = entry.endsWith('/') ? entry.slice(0, -1) : entry
  if (existsSync(trimmed) && trimmed.endsWith('@deepseek-ai')) return trimmed
  return undefined
}

/** 从环境变量解析要核对的 DSH 部署（可多份，用路径分隔符列表给 DSH_CONTRACT_HOMES）。 */
function resolveOfficialRoots() {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const roots = []
  for (const key of ['DSH_CONTRACT_HOMES', 'DSH_CONTRACT_HOME', 'DSH_STABLE_HOME', 'DSH_017_HOME']) {
    const value = process.env[key]
    if (value === undefined || value.length === 0) continue
    for (const entry of value.split(delimiter)) {
      if (entry.length === 0) continue
      const root = officialRootOf(entry)
      if (root !== undefined && !roots.includes(root)) roots.push(root)
    }
  }
  return roots
}

const officialRoots = resolveOfficialRoots()
if (officialRoots.length === 0) {
  console.log(
    '  info 未提供 DSH_CONTRACT_HOMES / DSH_CONTRACT_HOME / DSH_STABLE_HOME / DSH_017_HOME：' +
      '跳过官方产物契约核对（无部署的 CI 只跑插件侧断言）',
  )
} else {
  for (const root of officialRoots) {
    test('官方契约原文 @ ' + root, () => {
      for (const fact of OFFICIAL_CONTRACT_FACTS) {
        const file = join(root, fact.path)
        assert.ok(existsSync(file), '缺少官方产物 ' + fact.path)
        const source = readFileSync(file, 'utf8')
        for (const fragment of fact.includes) {
          assert.ok(
            source.includes(fragment),
            fact.name + '：' + fact.path + ' 里找不到 ' + JSON.stringify(fragment),
          )
        }
      }
      for (const structure of OFFICIAL_STRUCTURE_CHECKS) {
        const file = join(root, structure.path)
        assert.ok(existsSync(file), '缺少官方产物 ' + structure.path)
        const source = readFileSync(file, 'utf8')
        const failure = structure.check(source)
        assert.equal(failure, undefined, structure.name + '：' + (failure === undefined ? '' : failure))
      }
    })
  }
}

if (failures.length > 0) {
  console.error()
  console.error(String(failures.length) + ' of ' + String(passed + failures.length) + ' checks failed')
  process.exit(1)
}
console.log()
console.log('all ' + String(passed) + ' checks passed')
