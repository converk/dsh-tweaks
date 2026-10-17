/**
 * dsh-tweaks-smart-list 自测。
 *
 * 三部分：
 * 1. 不需要 DSH 部署（CI 也跑这一段）：
 *    - 插件源码契约面：inject 服务名、席位键 / 条目 id、键盘拦截配方（Shift+Enter /
 *      IME / 修饰键 / 相位）、DOM 判据、[data-dsh-smart-list] 自有标记，以及
 *      「行识别逻辑只在 shared/」；
 *    - 纯逻辑（列表标记 + 行文本提取）：用 esbuild 把 src/shared/*.ts 现场 bundle 成
 *      ESM data URL 再 import，覆盖有序 / 无序 / 中文分隔符 / 缩进 / 前导零 / 空条目 /
 *      软换行 / 多段落 / 字面 \n；行提取用假 DOM 驱动；
 *    - client bundle 协议：window.__ModuleLoader__.load({ id, factory }) 外壳、
 *      工厂只 require 页面种子模块（react / react/jsx-runtime）、sourcemap trailer 合法；
 *    - 入口行为：在 vm 里执行构建产物，用结构化 stub 驱动 apply，再渲染 overlay 组件、
 *      用假 document 派发 keydown，核对「插入 \n + 下一个标记 / 何时不接管」。
 * 2. 需要一份完整 DSH 安装（DSH_CONTRACT_HOMES=<部署根>）：
 *    - 按 README「DSH 兼容性」表逐条断言官方产物原文：InputActions.captureInsertion /
 *      insertText、TokenSpan、overlay 席位 kind / scope、运行期正文换行语义
 *      （contenteditable 白空格 pre-wrap + 粘贴路径允许字面换行）与 composer 卡片 DOM 判据。
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
  assert.ok(bundle.includes('id: "dsh-tweaks-smart-list",'), '工厂 id 必须等于包名')
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
  assert.ok(index.includes("export const inject = ['slots']"), 'inject 必须是 slots（inputActions / useInput 是 props，不是服务）')
  assert.ok(index.includes("slots.inject('conversation.input.overlay'"), 'slots.inject 的席位键')
  assert.ok(index.includes("name: 'conversation.input.overlay'"), 'register 的席位键')
  assert.ok(index.includes("export const OVERLAY_ENTRY_ID = 'smart-list'"), 'overlay 条目 id')
  assert.ok(index.includes('id: OVERLAY_ENTRY_ID'), '列表项必须用自有 id（不能替换官方条目）')
  assert.ok(index.includes('order: 60'), '列表项 order')
  assert.ok(
    index.includes("slots.inject('conversation.input.overlay', () =>"),
    '注册放在 slots.inject 回调内（disposer 由调用方 fiber 撤销，不要另包 ctx.effect）',
  )
})

test('插件源码契约面：键盘拦截配方与 DOM 判据', () => {
  const overlay = pluginFile('src/client/overlay.tsx')
  assert.ok(overlay.includes("document.addEventListener('keydown', onKeyDown, true)"), 'document 捕获相监听')
  assert.ok(overlay.includes("if (event.key !== 'Enter' || event.shiftKey !== true) return"), '只接管 Shift+Enter')
  assert.ok(
    overlay.includes('if (event.ctrlKey || event.metaKey || event.altKey) return'),
    '带 Ctrl / Meta / Alt 的组合必须放行',
  )
  assert.ok(overlay.includes('if (event.isComposing || event.keyCode === 229) return'), '避开 IME 组合期')
  assert.ok(overlay.includes("closest(COMPOSER_CARD_SELECTOR)"), 'composer 卡片作用域判据')
  assert.ok(overlay.includes("const COMPOSER_CARD_SELECTOR = '[data-composer-card]'"), 'composer 卡片判据原文')
  assert.ok(overlay.includes("const EDITABLE_SELECTOR = '[contenteditable=\"true\"]'"), 'contenteditable 判据原文')
  assert.ok(overlay.includes('!selection.isCollapsed'), '有选区（非折叠）时不接管')
  assert.ok(overlay.includes("if (currentPhase !== undefined && currentPhase !== 'plain') return"), '非 plain 相位不接管')
  assert.ok(overlay.includes('inputActions.captureInsertion()'), '插入前必须捕获带修订号的选区')
  assert.ok(overlay.includes("inputActions.insertText('\\n' + marker, span)"), '换行只能通过 insertText 插入')
  assert.ok(overlay.includes('event.preventDefault()'), '接管成功后必须 preventDefault')
  assert.ok(overlay.includes('event.stopPropagation()'), '必须阻止 Lexical 的 KEY_ENTER_COMMAND 再插软换行')
  assert.ok(overlay.includes("'data-dsh-smart-list'"), '自有 DOM 必须有统一标记属性')
  assert.ok(!overlay.includes('setDraft('), '不能整段重写草稿（会丢 @ 引用 chip、移动光标）')
})

test('插件源码契约面：行识别 / 行提取在 shared/，overlay 只消费', () => {
  const overlay = pluginFile('src/client/overlay.tsx')
  const list = pluginFile('src/shared/list.ts')
  const line = pluginFile('src/shared/line.ts')
  assert.ok(overlay.includes("import { lineTextBeforeCaret } from '../shared/line.js'"), 'overlay 从 shared/line.ts 导入行提取')
  assert.ok(overlay.includes("import { nextListMarker } from '../shared/list.js'"), 'overlay 从 shared/list.ts 导入标记推导')
  assert.ok(overlay.includes('lineTextBeforeCaret(asDomNode(editable)'), 'overlay 必须实际调用行提取')
  assert.ok(overlay.includes('nextListMarker(line)'), 'overlay 必须实际调用标记推导')
  assert.ok(!overlay.includes('function nextListMarker'), '标记推导不能内联回 overlay（会与纯逻辑自测脱节）')
  assert.ok(!overlay.includes('function lineTextBeforeCaret'), '行提取不能内联回 overlay')
  assert.ok(list.includes('export function nextListMarker('), 'list.ts 必须导出 nextListMarker')
  assert.ok(list.includes('const ORDERED_LINE_ASCII'), '有序列表的西文分隔符分支')
  assert.ok(list.includes('const ORDERED_LINE_CJK'), '有序列表的中文分隔符分支')
  assert.ok(list.includes('const UNORDERED_LINE'), '无序列表分支')
  assert.ok(line.includes('export function lineTextBeforeCaret('), 'line.ts 必须导出 lineTextBeforeCaret')
  for (const field of ['nodeType', 'tagName', 'data', 'childNodes']) {
    assert.ok(line.includes('readonly ' + field), 'line.ts 只依赖结构投影字段 ' + field)
  }
  assert.ok(!line.includes('document.'), 'line.ts 不能直接引用浏览器 API（要能用假 DOM 测）')
})

test('包声明与 bundle patch：双面插件 + selftest 脚本', () => {
  const pkg = JSON.parse(pluginFile('package.json'))
  assert.equal(pkg.name, 'dsh-tweaks-smart-list')
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
  assert.ok(patch.includes('- id: smart-list'), 'bundle patch 的 entry id')
  assert.ok(patch.includes('name: dsh-tweaks-smart-list'), 'bundle patch 的包名')
})

test('宿主半区：纯 UI 插件是空 apply', () => {
  const host = pluginFile('src/index.ts')
  assert.ok(host.includes('export function apply(): void {}'), '宿主半区必须是空 apply')
})

// ---------------------------------------------------------------------------
// 纯逻辑：列表标记推导（esbuild 现场 bundle src/shared/list.ts）
// ---------------------------------------------------------------------------

async function loadSharedModule(relative) {
  const entry = fileURLToPath(new URL('../' + relative, import.meta.url))
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
  assert.ok(code !== undefined, 'esbuild 没有产出 ' + relative)
  return await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'))
}

const { nextListMarker } = await loadSharedModule('src/shared/list.ts')

test('纯逻辑：有序列表续号（. / ) / 、/ ））', () => {
  assert.equal(nextListMarker('1. foo'), '2. ')
  assert.equal(nextListMarker('9. foo'), '10. ')
  assert.equal(nextListMarker('1) foo'), '2) ')
  assert.equal(nextListMarker('1、中文'), '2、')
  // 中文分隔符的编号限制 1–2 位：年份开头的正文不算列表。
  assert.equal(nextListMarker('2026、年度总结'), null)
  assert.equal(nextListMarker('99、第九十九项'), '100、')
  assert.equal(nextListMarker('1）中文'), '2）')
  assert.equal(nextListMarker('1、 中文'), '2、 ')
  assert.equal(nextListMarker('  1. foo'), '  2. ')
  assert.equal(nextListMarker('\t1. foo'), '\t2. ')
  assert.equal(nextListMarker('\u30001. foo'), '\u30002. ')
})

test('纯逻辑：保留分隔空白与前导零宽度', () => {
  assert.equal(nextListMarker('1.   foo'), '2.   ')
  assert.equal(nextListMarker('1.\tfoo'), '2.\t')
  assert.equal(nextListMarker('01. foo'), '02. ')
  assert.equal(nextListMarker('009. foo'), '010. ')
  assert.equal(nextListMarker('999999999. foo'), '1000000000. ')
})

test('纯逻辑：无序列表重复标记', () => {
  assert.equal(nextListMarker('- foo'), '- ')
  assert.equal(nextListMarker('* foo'), '* ')
  assert.equal(nextListMarker('+ foo'), '+ ')
  assert.equal(nextListMarker('• foo'), '• ')
  assert.equal(nextListMarker('  - foo'), '  - ')
})

test('纯逻辑：空条目 / 非列表 / 行中编号都不触发', () => {
  for (const line of ['', '   ', '1. ', '1.   ', '1.', '1', '1.foo', '1.5 million', '12) ', '1、', '1、 ', '-', '- ', 'plain text', 'foo 1. bar', 'a. foo']) {
    assert.equal(nextListMarker(line), null, '不应接管: ' + JSON.stringify(line))
  }
  // 正文里带编号的列表项仍按行首编号续号。
  assert.equal(nextListMarker('1. foo 2. bar'), '2. ')
  // 编号超过 9 位不猜（避免精度问题）。
  assert.equal(nextListMarker('1234567890. foo'), null)
})

test('纯逻辑：标记推导按「单行前缀」工作（取最后一行的责任在 line.ts）', () => {
  // 行首是列表标记时，函数只关心标记本身；正文里出现换行不会改变推导结果。
  assert.equal(nextListMarker('1. foo\nbar'), '2. ')
  assert.equal(nextListMarker('1. foo\n2. bar'), '2. ')
  // 行首不是标记的输入一律 null（即使后面还有内容）。
  assert.equal(nextListMarker('foo\n1. bar'), null)
})

// ---------------------------------------------------------------------------
// 纯逻辑：行文本提取（假 DOM，驱动 src/shared/line.ts）
// ---------------------------------------------------------------------------

const { lineTextBeforeCaret } = await loadSharedModule('src/shared/line.ts')

const NODE_TYPE_ELEMENT = 1
const NODE_TYPE_TEXT = 3

/** 假文本节点（只提供 line.ts 读取的结构字段）。 */
class FakeText {
  constructor(data) {
    this.nodeType = NODE_TYPE_TEXT
    this.data = data
    // 真实 DOM 的文本节点也有（空的）childNodes；line.ts 的 contains 遍历依赖它。
    this.childNodes = []
    this.parentElement = null
  }
}

/** 假元素节点（提供 line.ts / overlay 读取的最少 DOM 面）。 */
class FakeElement {
  constructor(tagName) {
    this.nodeType = NODE_TYPE_ELEMENT
    this.tagName = tagName.toUpperCase()
    this.attrs = {}
    this.childNodes = []
    this.parentElement = null
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      this.childNodes.push(child)
    }
    return this
  }

  /** 只支持本插件用到的两种属性选择器：[data-composer-card] / [contenteditable="true"]。 */
  closest(selector) {
    const match = /^\[([a-z-]+)(?:="([^"]*)")?\]$/u.exec(selector)
    if (match === null) return null
    const attribute = match[1]
    const expected = match[2]
    let node = this
    while (node !== null) {
      if (node.nodeType === NODE_TYPE_ELEMENT && attribute in node.attrs) {
        if (expected === undefined || node.attrs[attribute] === expected) return node
      }
      node = node.parentElement
    }
    return null
  }

  contains(node) {
    let current = node
    while (current !== null) {
      if (current === this) return true
      current = current.parentElement
    }
    return false
  }
}

test('纯逻辑：行提取（普通段落，光标在行中 / 行尾）', () => {
  const text = new FakeText('1. hello world')
  const p = new FakeElement('p').append(text)
  const editable = new FakeElement('div').append(p)
  assert.equal(lineTextBeforeCaret(editable, text, 3), '1. ')
  assert.equal(lineTextBeforeCaret(editable, text, text.data.length), '1. hello world')
  assert.equal(lineTextBeforeCaret(editable, text, 0), '')
})

test('纯逻辑：行提取（软换行 <br> 后只取当前行）', () => {
  const first = new FakeText('1. first item')
  const br = new FakeElement('br')
  const second = new FakeText('2. second item')
  const p = new FakeElement('p').append(new FakeElement('span').append(first), br, new FakeElement('span').append(second))
  const editable = new FakeElement('div').append(p)
  assert.equal(lineTextBeforeCaret(editable, second, second.data.length), '2. second item')
  assert.equal(lineTextBeforeCaret(editable, second, 3), '2. ')
  assert.equal(lineTextBeforeCaret(editable, second, 0), '')
  assert.equal(lineTextBeforeCaret(editable, first, first.data.length), '1. first item')
})

test('纯逻辑：行提取（多段落只取光标所在段落；setDraft 恢复的草稿是这种结构）', () => {
  const first = new FakeText('1. first item')
  const second = new FakeText('2. second item')
  const editable = new FakeElement('div').append(
    new FakeElement('p').append(new FakeElement('span').append(first)),
    new FakeElement('p').append(new FakeElement('span').append(second)),
  )
  assert.equal(lineTextBeforeCaret(editable, second, second.data.length), '2. second item')
  assert.equal(lineTextBeforeCaret(editable, first, first.data.length), '1. first item')
})

test('纯逻辑：行提取（文本节点里的字面 \\n 也只保留最后一行）', () => {
  const text = new FakeText('1. first item\n2. second item')
  const editable = new FakeElement('div').append(new FakeElement('p').append(new FakeElement('span').append(text)))
  assert.equal(lineTextBeforeCaret(editable, text, text.data.length), '2. second item')
  // 光标正好落在字面换行之后（偏移量只包含换行本身）→ 当前行还是空行。
  assert.equal(lineTextBeforeCaret(editable, text, 14), '')
  assert.equal(lineTextBeforeCaret(editable, text, 17), '2. ')
})

test('纯逻辑：行提取（光标锚点是元素：只取该元素 offset 之前的子节点）', () => {
  const marker = new FakeText('1. ')
  const content = new FakeText('content')
  const p = new FakeElement('p').append(new FakeElement('span').append(marker), new FakeElement('span').append(content))
  const editable = new FakeElement('div').append(p)
  assert.equal(lineTextBeforeCaret(editable, p, 1), '1. ')
  assert.equal(lineTextBeforeCaret(editable, p, 2), '1. content')
})

test('纯逻辑：行提取（锚点不在可编辑根内返回 null）', () => {
  const outside = new FakeText('outside')
  const p = new FakeElement('p').append(new FakeText('inside'))
  const editable = new FakeElement('div').append(p)
  assert.equal(lineTextBeforeCaret(editable, outside, 0), null)
  assert.equal(lineTextBeforeCaret(editable, p, 0), '')
})

// ---------------------------------------------------------------------------
// 客户端入口 + overlay 组件行为（vm 执行构建产物 + 假 DOM / 假 React）
// ---------------------------------------------------------------------------

/**
 * 在 vm 里执行客户端 bundle，返回自注册记录。
 * 工厂 require 只解析页面种子模块（react / react/jsx-runtime），与真实页面一致。
 */
function createClientBundleEnvironment() {
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
  assert.equal(registration.id, 'dsh-tweaks-smart-list')
  return { sandbox, registration }
}

/** 渲染一次 client apply + overlay 组件：返回 apply 调用面与已挂载的 keydown 监听。 */
function mountOverlay(documentStub, options = {}) {
  const { sandbox, registration } = createClientBundleEnvironment()
  sandbox.document = documentStub
  const effects = []
  const seed = {
    react: {
      createElement: (type, props) => ({ type, props }),
      useRef: (initial) => ({ current: initial }),
      useEffect: (effect) => {
        effects.push(effect)
      },
    },
    'react/jsx-runtime': {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
  }
  const client = registration.factory((specifier) => {
    assert.ok(Object.hasOwn(seed, specifier), '工厂 require 了非页面种子模块：' + specifier)
    return seed[specifier]
  })

  const slots = { injectCalls: [], registerCalls: [], injected: undefined }
  slots.service = {
    inject(key, callback) {
      slots.injectCalls.push(key)
      slots.injected = callback()
      return () => undefined
    },
    register(registerOptions, component) {
      slots.registerCalls.push({ options: registerOptions, component })
      return () => undefined
    },
  }
  // apply 只用 ctx.get 取 slots；slots.inject 的 disposer 归调用方 fiber（不需要再包 ctx.effect）。
  client.apply({ get: (name) => (name === 'slots' ? slots.service : undefined) })

  assert.equal(slots.registerCalls.length, 1, 'apply 必须注册一个 overlay 条目')
  const registrationResult = slots.registerCalls[0]
  const element = registrationResult.component(options.props ?? {})
  const rendered = element.type(element.props)
  const anchor = new FakeElement('div')
  const card = documentStub.card
  card.append(anchor)
  rendered.props.ref.current = anchor

  // 执行 useEffect（注册 keydown 监听）。
  for (const effect of effects) {
    const disposer = effect()
    if (typeof disposer === 'function') documentStub.cleanups.push(disposer)
  }
  return { client, slots, rendered, anchor, card, documentStub }
}

/** 假 document：记录捕获监听、提供可选区。 */
function createDocumentStub() {
  const listeners = []
  const documentStub = {
    card: new FakeElement('div'),
    selection: null,
    cleanups: [],
    listeners,
    addEventListener(type, listener, capture) {
      listeners.push({ type, listener, capture })
    },
    removeEventListener(type, listener) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
      if (index >= 0) listeners.splice(index, 1)
    },
    getSelection() {
      return this.selection
    },
    dispatchKey(event) {
      for (const entry of listeners) if (entry.type === 'keydown') entry.listener(event)
    },
  }
  documentStub.card.attrs = { 'data-composer-card': '' }
  return documentStub
}

/**
 * 构造一个「composer 卡片 + 可编辑根 + 行文本」的假 DOM，并把光标放到行尾。
 * @returns 派发 keydown 需要的一切。
 */
function prepareComposer(documentStub, line, caret = line.length) {
  const text = new FakeText(line)
  const p = new FakeElement('p').append(new FakeElement('span').append(text))
  const editable = new FakeElement('div')
  editable.attrs = { contenteditable: 'true' }
  editable.append(p)
  documentStub.card.append(editable)
  documentStub.selection = {
    rangeCount: 1,
    isCollapsed: true,
    anchorNode: text,
    anchorOffset: caret,
  }
  return { text, p, editable }
}

/** 构造一个 keydown 事件（只带 overlay 读取的字段）。 */
function createKeyEvent(overrides = {}) {
  const event = {
    key: 'Enter',
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 13,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...overrides,
  }
  return event
}

/** 标准 inputActions stub：记录插入调用并返回可配置结果。 */
function createInputActions(result = true) {
  const calls = []
  return {
    calls,
    captureInsertion() {
      return { start: 3, end: 3, draftRev: 7 }
    },
    insertText(text, span) {
      calls.push({ text, span })
      return result
    },
  }
}

/**
 * 挂载 overlay，在给定行上派发一次 keydown。
 * @param line - 假 composer 里的行文本（光标默认在行尾）。
 * @param options - 可替换 inputActions / props / 事件字段，或在派发前改假 DOM（setup）。
 * @returns 插入调用记录、事件对象与假 document。
 */
function pressShiftEnter(line, options = {}) {
  const documentStub = createDocumentStub()
  const inputActions = options.inputActions ?? createInputActions()
  mountOverlay(documentStub, {
    props: options.props?.(inputActions) ?? { useInput: (select) => select({ phase: 'plain' }), inputActions },
  })
  const prepared = prepareComposer(documentStub, line)
  options.setup?.(documentStub, prepared)
  const event = createKeyEvent(options.event)
  documentStub.dispatchKey(event)
  return { documentStub, inputActions, event }
}

test('客户端入口 apply：inject / 席位接线与缺 slots 静默降级', () => {
  const { sandbox, registration } = createClientBundleEnvironment()
  const seed = {
    react: { createElement: (type, props) => ({ type, props }), useRef: (initial) => ({ current: initial }), useEffect: () => undefined },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  }
  const client = registration.factory((specifier) => seed[specifier])
  assert.deepEqual([...client.inject], ['slots'])
  assert.doesNotThrow(() => client.apply({ get: () => undefined }))

  const slots = { injectCalls: [], registerCalls: [] }
  let injected
  slots.service = {
    inject(key, callback) {
      slots.injectCalls.push(key)
      injected = callback()
      return () => undefined
    },
    register(options, component) {
      slots.registerCalls.push({ options, component })
      return 'register-disposer'
    },
  }
  // 只给 get：slot 注入的 disposer 挂在调用方 fiber 上，apply 不需要 ctx.effect。
  client.apply({ get: (name) => (name === 'slots' ? slots.service : undefined) })
  assert.deepEqual(slots.injectCalls, ['conversation.input.overlay'])
  assert.equal(slots.registerCalls.length, 1)
  assert.equal(slots.registerCalls[0].options.name, 'conversation.input.overlay')
  assert.equal(slots.registerCalls[0].options.id, 'smart-list')
  assert.equal(slots.registerCalls[0].options.order, 60)
  assert.equal(typeof slots.registerCalls[0].component, 'function')
  assert.equal(injected, 'register-disposer', 'slots.inject 回调要把注册 disposer 交还')
  assert.equal(sandbox.document, undefined)
})

test('overlay 行为：列表行 Shift+Enter → 插入换行 + 下一个编号', () => {
  const { inputActions, event } = pressShiftEnter('1. first item')
  assert.deepEqual(inputActions.calls, [{ text: '\n2. ', span: { start: 3, end: 3, draftRev: 7 } }])
  assert.equal(event.prevented, true, '成功接管后必须 preventDefault')
  assert.equal(event.stopped, true, '成功接管后必须 stopPropagation（压掉 Lexical 的软换行）')
})

test('overlay 行为：中文顿号 / 括号 / 无序 / 缩进 / 字面换行都能续号', () => {
  const cases = [
    ['1、中文列表', '\n2、'],
    ['1）中文列表', '\n2）'],
    ['1) parenthesized', '\n2) '],
    ['- bullet', '\n- '],
    ['  12. nested', '\n  13. '],
    ['1. first item\n2. second item', '\n3. '],
  ]
  for (const [line, expected] of cases) {
    const { inputActions, event } = pressShiftEnter(line)
    assert.equal(inputActions.calls.length, 1, '应接管: ' + line)
    assert.equal(inputActions.calls[0].text, expected, '插入文本: ' + line)
    assert.equal(event.prevented, true)
  }
})

test('overlay 行为：非列表 / 空条目 / 修饰键 / IME / 非 plain 相位 / 有选区 都不接管', () => {
  const cases = [
    { name: '非列表行', line: 'plain paragraph' },
    { name: '空条目', line: '2. ' },
    { name: '只有标记无空白', line: '1.' },
    { name: '数字正文', line: '1.5 million' },
  ]
  for (const testCase of cases) {
    const { inputActions, event } = pressShiftEnter(testCase.line)
    assert.equal(inputActions.calls.length, 0, '不应接管: ' + testCase.name)
    assert.equal(event.prevented, false)
  }

  const variations = [
    { name: 'Ctrl+Shift+Enter', event: { ctrlKey: true } },
    { name: 'Alt+Shift+Enter', event: { altKey: true } },
    { name: 'Meta+Shift+Enter', event: { metaKey: true } },
    { name: 'IME 组合期', event: { isComposing: true } },
    { name: 'IME keyCode 229', event: { keyCode: 229 } },
    { name: '普通 Enter（不带 Shift）', event: { shiftKey: false } },
    { name: '非 Enter 键', event: { key: 'Tab' } },
  ]
  for (const testCase of variations) {
    const { inputActions } = pressShiftEnter('1. first item', { event: testCase.event })
    assert.equal(inputActions.calls.length, 0, '不应接管: ' + testCase.name)
  }

  const busy = pressShiftEnter('1. first item', {
    props: (inputActions) => ({ useInput: (select) => select({ phase: 'claimed' }), inputActions }),
  })
  assert.equal(busy.inputActions.calls.length, 0, '相位不是 plain 时不能接管')

  const selected = pressShiftEnter('1. first item', {
    setup(documentStub, { text }) {
      documentStub.selection = { rangeCount: 1, isCollapsed: false, anchorNode: text, anchorOffset: 0 }
    },
  })
  assert.equal(selected.inputActions.calls.length, 0, '有选区时不能接管')
})

test('overlay 行为：选区在别的 composer 卡片里不接管', () => {
  const { inputActions, event } = pressShiftEnter('1. first item', {
    setup(documentStub) {
      // 换一个不在本 overlay 卡片里的可编辑根
      const otherCard = new FakeElement('div')
      otherCard.attrs = { 'data-composer-card': '' }
      const otherText = new FakeText('1. other')
      const otherEditable = new FakeElement('div')
      otherEditable.attrs = { contenteditable: 'true' }
      otherEditable.append(new FakeElement('p').append(new FakeElement('span').append(otherText)))
      otherCard.append(otherEditable)
      documentStub.selection = {
        rangeCount: 1,
        isCollapsed: true,
        anchorNode: otherText,
        anchorOffset: otherText.data.length,
      }
    },
  })
  assert.equal(inputActions.calls.length, 0, '不能接管其他 composer 卡片')
  assert.equal(event.prevented, false)
})

test('overlay 行为：insertText 拒绝（修订号过期 / 提交中）时放行给编辑器', () => {
  const { inputActions, event } = pressShiftEnter('1. first item', { inputActions: createInputActions(false) })
  assert.equal(inputActions.calls.length, 1, '会尝试插入')
  assert.equal(event.prevented, false, '插入失败时必须放行（否则 Shift+Enter 吞键）')
  assert.equal(event.stopped, false)
})

test('overlay 行为：useInput 缺省时仍按 insertText 自身的相位守卫工作', () => {
  const { inputActions, event } = pressShiftEnter('1. first item', {
    props: (actions) => ({ inputActions: actions }),
  })
  assert.equal(inputActions.calls.length, 1)
  assert.equal(event.prevented, true)
})

test('overlay 行为：卸载后移除 keydown 监听', () => {
  const documentStub = createDocumentStub()
  const inputActions = createInputActions()
  mountOverlay(documentStub, { props: { useInput: (select) => select({ phase: 'plain' }), inputActions } })
  prepareComposer(documentStub, '1. first item')
  for (const cleanup of documentStub.cleanups) cleanup()
  const event = createKeyEvent()
  documentStub.dispatchKey(event)
  assert.equal(inputActions.calls.length, 0, '卸载后不能再接管')
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
    includes: ["'conversation.input.overlay': {", 'useInput: SnapshotSelectorHook<InputState>;', 'inputActions: InputActions;'],
  },
  {
    name: 'InputActions.captureInsertion / insertText（唯一的文本插入入口）',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/input.d.ts',
    includes: [
      'export interface InputActions {',
      'captureInsertion(): TokenSpan;',
      'insertText(text: string, span: TokenSpan): boolean;',
      "readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting';",
    ],
  },
  {
    name: 'TokenSpan 形状（start / end / draftRev）',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/draft-editor.d.ts',
    includes: ['export interface TokenSpan {', 'readonly start: number;', 'readonly end: number;', 'readonly draftRev: number;'],
  },
  {
    name: 'client bundle 加载协议 window.__ModuleLoader__.load({ id, factory })',
    path: 'dsh-client-modules/lib/types/client/manifest.d.ts',
    includes: ['window.__ModuleLoader__.load({id, factory})', 'ClientModuleLoader'],
  },
]

/**
 * 顺序 / 结构 / 运行期语义判据：单纯「包含」表达不了的契约。
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
    name: 'InputActions 块里仍有 captureInsertion / insertText',
    path: 'dsh-client-ui-conversation/lib/types/client/contract/input.d.ts',
    check(source) {
      const start = source.indexOf('export interface InputActions {')
      if (start < 0) return 'missing export interface InputActions'
      const next = source.indexOf('export interface', start + 1)
      const body = source.slice(start, next < 0 ? start + 4000 : next)
      if (!body.includes('captureInsertion(): TokenSpan;')) return 'InputActions.captureInsertion is missing'
      if (!body.includes('insertText(text: string, span: TokenSpan): boolean;')) return 'InputActions.insertText is missing'
      return undefined
    },
  },
  {
    name: '运行时 DOM：overlay 仍渲染在 data-composer-card 卡片子树内（Shift+Enter 静默失效的告警线）',
    path: 'dsh-client-ui-conversation/lib/client.js',
    check(source) {
      const card = source.indexOf('"data-composer-card": true')
      if (card < 0) return 'missing "data-composer-card": true attribute'
      const overlay = source.indexOf('renderSlot("conversation.input.overlay"')
      if (overlay < 0) return 'missing renderSlot("conversation.input.overlay") call'
      if (overlay < card) return 'overlay renderSlot no longer follows the composer card attribute in source order'
      const distance = overlay - card
      if (distance > 2000) return 'overlay renderSlot moved out of the composer card subtree (distance ' + String(distance) + ')'
      return undefined
    },
  },
  {
    name: '运行时语义：composer 可编辑根保留字面换行 + insertText / 粘贴路径允许纯文本带 \\n',
    path: 'dsh-client-ui-conversation/lib/client.js',
    check(source) {
      if (!source.includes('white-space:pre-wrap')) return 'composer editable lost white-space:pre-wrap (literal newlines would collapse)'
      const paste = source.indexOf('paste(text) {')
      if (paste < 0) return 'missing DraftEditorRuntime.paste(text)'
      const pasteBody = source.slice(paste, paste + 800)
      if (!pasteBody.includes('selection.insertText(clean)')) return 'paste no longer routes plain text through selection.insertText'
      if (!source.includes('insertAsyncText(span, text)')) return 'insertAsyncText is missing (inputActions.insertText implementation changed)'
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
  for (const key of ['DSH_CONTRACT_HOMES', 'DSH_CONTRACT_HOME', 'DSH_STABLE_HOME']) {
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
    '  info 未提供 DSH_CONTRACT_HOMES / DSH_CONTRACT_HOME / DSH_STABLE_HOME：跳过官方产物契约核对（无部署的 CI 只跑插件侧断言）',
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
