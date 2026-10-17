/**
 * 浏览器半区冒烟：bundle 协议 + apply + 行组件的平台闸门（纯 Node，不需要浏览器、不装 react）。
 *
 * 覆盖（AGENTS.md §3.3 的协议约束）：
 * 1. `lib/client.js` 是**经典脚本**（不是 ESM），用 `window.__ModuleLoader__.load` 自注册；
 * 2. 工厂体是 CJS，只 `require` 页面种子模块（`react` / `react/jsx-runtime`）；
 * 3. 带**合法 v3 sourcemap trailer**；
 * 4. 工厂里 `exports.inject` 声明了 `slots` / `locale`
 *    —— 漏了它会「装上了但什么都不注册」且毫无日志；设置通道**不进** `inject`
 *    （0.1.7 起官方没有 `settingsScope`，声明成硬依赖会让条目永远 pending）；
 * 5. `apply(ctx)` 真的往 `settings.general.item` 注册了一行，id / order / locale 符合预期；
 * 5b. 设置通道名随宿主版本变化：`webUiSettings`（0.1.7 兼容层）/ `settingsScope`（旧宿主）
 *     都能用；都没就绪时改为等 `webUiSettings` 出现再登记；
 * 6. 行组件在**非 win32** 与**平台未知**时不渲染（需求 2），win32 时渲染出来；
 * 7. 设置快照契约：0.2.1 的 configForms 快照删除了 `mode`，写权限只由 `writable` 表达
 *    （0.4.0 因 `snapshot.mode === 'host'` 判据在 0.2.1 上整行只读，0.4.1 修复）。
 * 8. 首次 `/state` 失败时降级为 `ready` + 错误提示（平台未知不再永久停在 loading/空白）。
 *
 * ⚠️ 测试 renderer 的两个关键模拟（不对齐它们会得到假失败）：
 * - 注册到席位的是 `apply` 里的**包装组件**（只 `createElement(TerminalToolRow, …)` 一次），
 *   所以必须真的调用元素类型，而不是把元素当结果；
 * - `useEffect` 在 render 之后跑，且它改的 store 要在**下一次 render** 才可见，
 *   所以每次 commit 后都让出一次微任务再渲染。
 * 另外 vm 的新 context 里没有 `console` / `Response` / `AbortSignal`，必须显式补进 sandbox。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let passed = 0
let failed = 0

/** 一个断言。 */
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
    return
  }
  failed += 1
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** 分组标题。 */
function section(title) {
  console.log(`\n== ${title}`)
}

const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const map = JSON.parse(readFileSync(new URL('../lib/client.js.map', import.meta.url), 'utf8'))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
// bundle patch 里 insert 的 entry id：0.1.7 的设置 namespace 必须与它逐字一致。
const patchYml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const patchEntryId = /^\s*-\s*id:\s*([^\s#]+)/m.exec(patchYml)?.[1]

/**
 * 最小 react 桩 + 极简 renderer（真调用函数组件类型，render 后 flush effect）。
 * `useSyncExternalStore` 每次都读当前快照（真实 React 订阅变化后重渲）。
 */
let effectQueue = null
let memoCache = null
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  // React 的记忆化：一次挂载只跑一次 factory（否则每次 render 都新建 controller，
  // 异步取数的结果永远看不到）。测试里一个挂载点只有一个 useMemo，用一个槽位即可。
  useMemo: (factory) => {
    if (memoCache !== null) return memoCache
    memoCache = factory()
    return memoCache
  },
  useCallback: (callback) => callback,
  useEffect: (callback) => {
    effectQueue?.push(callback)
  },
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}
const jsxRuntime = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: Symbol('Fragment'),
}
const requested = []

/** 展平元素树（真调用函数组件）。 */
function flatten(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((child) => flatten(child))
  if (typeof node.type === 'function') return flatten(node.type(node.props ?? {}))
  return { type: node.type, props: node.props ?? {}, children: (node.children ?? []).map((child) => flatten(child)) }
}

/**
 * 在一个全新的 vm context 里物化 bundle 并取出工厂。
 * @param fetchImpl - 浏览器 fetch 的替身。
 * @returns 已注册的工厂记录。
 */
function loadFactory(fetchImpl) {
  const records = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (record) => records.push(record) } },
    // vm 的新 context 里没有这些全局对象；bundle 用它们构造 JSON 响应/合并取消信号。
    Response,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl,
  }
  vm.runInNewContext(bundle, sandbox)
  if (records.length !== 1) throw new Error(`expected exactly one registered factory, got ${records.length}`)
  return records[0]
}

const factoryRequire = (specifier) => {
  requested.push(specifier)
  if (specifier === 'react') return react
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  throw new Error(`unexpected require: ${specifier}`)
}

section('bundle 协议')
{
  check('不是 ESM（没有顶层 import/export）', !/^\s*(import|export)\s/m.test(bundle))
  check('自注册 __ModuleLoader__', bundle.startsWith('window.__ModuleLoader__.load({'))
  check('注册 id 与包名一致', bundle.includes(`id: ${JSON.stringify(pkg.name)}`), pkg.name)
  check('工厂体是 CJS', bundle.includes('var module = { exports: {} }'))
  const bareRequires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
  check(
    '裸说明符只有 react 两个种子模块',
    [...new Set(bareRequires)].sort().join(',') === 'react,react/jsx-runtime',
    [...new Set(bareRequires)].join(','),
  )
  check('带 sourcemap trailer', bundle.trimEnd().endsWith('//# sourceMappingURL=client.js.map'))
  check('sourcemap 是合法 v3', map.version === 3 && Array.isArray(map.sources) && typeof map.mappings === 'string')
  check('dsh.client.platform = web', pkg.dsh?.client?.platform === 'web')
  check('exports["./client"] 指向 lib/client.js', pkg.exports?.['./client']?.default === './lib/client.js')
  check('bundle 里不含 @deepseek-ai 运行时 require', !/require\("@deepseek-ai/.test(bundle))
}

const exportsObject = loadFactory(async () => ({ ok: true, status: 200, json: async () => ({}) })).factory(factoryRequire)
check('工厂返回 apply', typeof exportsObject.apply === 'function')
check(
  '客户端 inject 只声明 slots / locale（设置通道不硬依赖）',
  JSON.stringify([...exportsObject.inject].sort()) === JSON.stringify(['locale', 'slots']),
  JSON.stringify(exportsObject.inject),
)

section('apply：注册 settings.general.item')
{
  const injected = []
  const registered = []
  const localeCalls = []
  const boundNamespaces = []
  const boundSpecs = []
  const slots = {
    inject: (key, callback) => {
      injected.push(key)
      callback()
      return () => undefined
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => undefined
    },
  }
  const locale = {
    register: (ns, language, dictionary) => {
      localeCalls.push({ ns, language, keys: Object.keys(dictionary).length })
      return () => undefined
    },
    bind: (ns) => (key) => `${ns}:${key}`,
  }
  const ctx = {
    get: (name) =>
      name === 'slots'
        ? slots
        : name === 'locale'
          ? locale
          : name === 'webUiSettings'
            ? {
                bind: (spec) => {
                  boundNamespaces.push(spec.namespace)
                  boundSpecs.push(spec)
                  return {
                    // 0.2.1 的 ConfigFormSnapshot 没有 mode（只剩 status/value/base/user/revision/writable）。
                    getSnapshot: () => ({
                      status: 'ready',
                      value: { dialect: 'pwsh', bashPath: '' },
                      writable: true,
                      revision: 1,
                      base: undefined,
                      user: undefined,
                    }),
                    subscribe: () => () => undefined,
                    mutate: async () => undefined,
                    set: async () => undefined,
                    unset: async () => undefined,
                  }
                },
              }
            : undefined,
    effect: (run) => {
      run()
      return () => undefined
    },
  }
  exportsObject.apply(ctx)

  check(
    '只 inject 了 settings.general.item',
    JSON.stringify(injected) === JSON.stringify(['settings.general.item']),
    injected.join(','),
  )
  check('注册了一个席位', registered.length === 1, String(registered.length))
  check('席位 name', registered[0]?.options.name === 'settings.general.item', registered[0]?.options.name)
  check('席位 id 是 terminal-tool', registered[0]?.options.id === 'terminal-tool', registered[0]?.options.id)
  check('席位带 order', typeof registered[0]?.options.order === 'number')
  check('席位 locale 命名空间是 terminal-tool', registered[0]?.options.locale === 'terminal-tool')
  check(
    '注册了 zh/en 两份字典且键数一致',
    localeCalls.length === 2 && localeCalls[0].keys === localeCalls[1].keys,
    JSON.stringify(localeCalls),
  )
  check(
    'webUiSettings 绑定到 entry id（设置面按 entry id 寻址）',
    boundNamespaces.join(',') === 'git-bash-terminal-tool',
    boundNamespaces.join(','),
  )
  check(
    '绑定的 namespace 就是 cordis.patch.yml 里的 entry id',
    patchEntryId === boundNamespaces[0],
    `patch=${patchEntryId} bind=${boundNamespaces[0]}`,
  )
  check(
    'bind 传了 decode（读值不依赖 hand-written wire schema）',
    typeof boundSpecs[0]?.decode === 'function',
    typeof boundSpecs[0]?.decode,
  )
  check('组件是函数', typeof registered[0]?.component === 'function')
}

// --- 设置通道：宿主版本差异（0.1.7 的 webUiSettings / 0.1.5 的 settingsScope）---

section('设置通道：宿主版本差异')

/**
 * 造一个 apply 用的假 ctx：`names` 是提供设置通道的服务名数组，可随时改（模拟服务晚到）。
 * @param names - 当前提供设置通道的服务名。
 * @returns ctx 与登记/绑定/等待记录。
 */
function makeApplyCtx(names) {
  const registered = []
  const boundNamespaces = []
  const pending = []
  const binder = {
    bind: (spec) => {
      boundNamespaces.push(spec.namespace)
      return {
        // 0.2.1 快照形状：没有 mode。
        getSnapshot: () => ({
          status: 'ready',
          value: { dialect: 'pwsh', bashPath: '' },
          writable: true,
          revision: 1,
          base: undefined,
          user: undefined,
        }),
        subscribe: () => () => undefined,
        mutate: async () => undefined,
        set: async () => undefined,
        unset: async () => undefined,
      }
    },
  }
  const slots = {
    inject: (_key, callback) => {
      callback()
      return () => undefined
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => undefined
    },
  }
  const ctx = {
    get: (name) =>
      name === 'slots'
        ? slots
        : name === 'locale'
          ? { register: () => () => undefined, bind: () => (key) => key }
          : names.includes(name)
            ? binder
            : undefined,
    effect: (run) => {
      run()
      return () => undefined
    },
    inject: (services, callback) => {
      pending.push({ services: [...services], callback })
      return () => undefined
    },
  }
  return { ctx, registered, boundNamespaces, pending, binder }
}

{
  const live = makeApplyCtx(['webUiSettings'])
  exportsObject.apply(live.ctx)
  check('新宿主：webUiSettings 直接登记席位', live.registered.length === 1, String(live.registered.length))
  check(
    '新宿主：绑定到 entry id',
    live.boundNamespaces.join(',') === 'git-bash-terminal-tool',
    live.boundNamespaces.join(','),
  )
}
{
  const legacy = makeApplyCtx(['settingsScope'])
  exportsObject.apply(legacy.ctx)
  check('旧宿主：只有 settingsScope 时回退登记', legacy.registered.length === 1, String(legacy.registered.length))
}
{
  const names = []
  const late = makeApplyCtx(names)
  exportsObject.apply(late.ctx)
  check('通道未就绪时不登记半截行', late.registered.length === 0, String(late.registered.length))
  check(
    '通道未就绪时同时等 webUiSettings 与 configForms',
    late.pending.length === 2 &&
      late.pending.map((entry) => entry.services.join(',')).sort().join('|') === 'configForms|webUiSettings',
    JSON.stringify(late.pending.map((entry) => entry.services)),
  )
  names.push('webUiSettings')
  late.pending[0].callback()
  check('服务到位后补登记席位', late.registered.length === 1, String(late.registered.length))
}
{
  // 普通部署（没有家族兼容层）：只有官方原生 configForms。
  const registered = []
  const gotEntryIds = []
  const nativeForm = {
    // 0.2.1 原生 ConfigFormSnapshot：有 writable、没有 mode。
    getSnapshot: () => ({ status: 'ready', value: { dialect: 'bash', bashPath: 'D:/x/bash.exe', bashCandidates: [] }, base: undefined, user: undefined, revision: 1, writable: true }),
    subscribe: () => () => undefined,
    mutate: async () => true,
    set: async () => true,
    unset: async () => true,
  }
  const slots = {
    inject: (_key, callback) => {
      callback()
      return () => undefined
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => undefined
    },
  }
  const ctx = {
    get: (name) =>
      name === 'slots'
        ? slots
        : name === 'locale'
          ? { register: () => () => undefined, bind: () => (key) => key }
          : name === 'configForms'
            ? {
                get: (entryId) => {
                  gotEntryIds.push(entryId)
                  return nativeForm
                },
              }
            : undefined,
    effect: (run) => {
      run()
      return () => undefined
    },
    inject: () => () => undefined,
  }
  exportsObject.apply(ctx)
  check('原生宿主：没有 webUiSettings 时用 configForms.get(entryId)', registered.length === 1, String(registered.length))
  check('原生宿主：按 entry id 取表单', gotEntryIds.join(',') === 'git-bash-terminal-tool', gotEntryIds.join(','))
}

// --- 行组件：渲染闸门 + 路径栏的出现时机 -------------------------------------

section('行组件：渲染闸门与路径栏时机')

/**
 * 挂载行组件，用假的 `/state` + 假的设置表单驱动，返回最终渲染出的树。
 *
 * 渠道默认 `webUiSettings`：0.2.1 用户 profile 里家族兼容层会 promote 到官方原生
 * configForms，快照形状也就跟着官方走（无 mode）。回归用例可显式切 `configForms` /
 * `settingsScope` 并覆写快照字段（writable / mode）来锁语义。
 * @param state - 假的 `/state` 响应体。
 * @param settings - 假的设置值；不给就模拟 scope 还没就绪（走 host 快照）。
 * @param options - `channel`：设置通道；`snapshot`：覆写快照字段；
 *   `failState`：让 `/state` 请求失败（模拟宿主未就绪 / 路由报错）。
 * @returns 展平后的元素树。
 */
async function renderRow(state, settings, options = {}) {
  const channel = options.channel ?? 'webUiSettings'
  // 0.2.1 的快照形状：status/value/base/user/revision/writable，没有 mode。
  const snapshot = {
    status: 'ready',
    value: settings,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    ...(options.snapshot ?? {}),
  }
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    mutate: async () => undefined,
    set: async () => undefined,
    unset: async () => undefined,
  }
  memoCache = null
  let wrapper
  const factory = loadFactory(async (url) => {
    if (options.failState === true && String(url).includes('/state')) throw new Error('HTTP 500')
    return {
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/state') ? state : { candidates: [] }),
    }
  })
  factory.factory(factoryRequire).apply({
    get: (name) => {
      if (name === 'slots') {
        return {
          inject: (_key, callback) => callback(),
          register: (_options, component) => {
            wrapper = component
            return () => undefined
          },
        }
      }
      if (name === 'locale') return { register: () => () => undefined, bind: () => (key) => key }
      if (name === channel && channel === 'configForms') return { get: () => scope }
      if (name === channel) return { bind: () => scope }
      return undefined
    },
    effect: (run) => {
      run()
      return () => undefined
    },
  })

  // 行组件用 useMemo([scope, t]) 建 controller：`t` 必须是稳定引用。
  const t = String
  const renderOnce = () => {
    effectQueue = []
    const tree = flatten(wrapper({ t }))
    for (const effect of effectQueue.splice(0)) {
      const dispose = effect()
      if (typeof dispose === 'function') void dispose
    }
    effectQueue = null
    return tree
  }

  let tree = renderOnce()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (tree !== null) break
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve))
    tree = renderOnce()
  }
  return tree
}

/**
 * 收集树里所有指定类型的元素。
 * @param node - 展平后的节点。
 * @param type - 元素类型（如 `select` / `button`）。
 * @param out - 收集结果。
 * @returns 收集结果。
 */
function childrenOf(node) {
  if (Array.isArray(node.children) && node.children.length > 0) return node.children
  const inner = node.props?.children
  if (inner === undefined || inner === null) return []
  return Array.isArray(inner) ? inner : [inner]
}

function collect(node, type, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, type, out)
    return out
  }
  if (typeof node.type === 'string' && node.type === type) out.push(node)
  for (const child of childrenOf(node)) collect(child, type, out)
  return out
}

/** 树里 class 含指定片段的按钮（本插件用固定类名）。 */
function buttonWithClass(node, fragment) {
  return collect(node, 'button').find(
    (button) => typeof button.props?.className === 'string' && button.props.className.includes(fragment),
  )
}

/** 树里所有可交互控件（button / input / select）的 disabled 值。 */
function disabledStates(node) {
  const states = []
  for (const type of ['button', 'input', 'select']) {
    for (const element of collect(node, type)) states.push(element.props?.disabled)
  }
  return states
}

const linuxTree = await renderRow({
  platform: 'linux',
  dialect: 'pwsh',
  bashPath: '',
  settingsAvailable: true,
  capability: { supported: false },
})
check('非 win32（platform=linux）渲染 null', linuxTree === null, JSON.stringify(linuxTree))

const loadingTree = await renderRow({
  platform: '',
  dialect: 'pwsh',
  bashPath: '',
  settingsAvailable: false,
  capability: { supported: false },
})
check('平台未知（加载中）渲染 null', loadingTree === null, JSON.stringify(loadingTree))

// 回归（0.5.0）：首次 /state 失败时平台未知；若继续停在 loading，设置行会永久消失（只能重挂载）。
// 应降级为 ready + 错误提示，让用户看到「宿主状态读取失败」，而不是一行空白。
const failedStateTree = await renderRow(
  { platform: '', dialect: 'pwsh', bashPath: '', settingsAvailable: false, capability: { supported: false } },
  { dialect: 'pwsh', bashPath: '', bashCandidates: [] },
  { failState: true },
)
check(
  '首次 /state 失败仍渲染设置行并显示错误',
  failedStateTree !== null && JSON.stringify(failedStateTree).includes('HTTP 500'),
  JSON.stringify(failedStateTree),
)

// 需求 1 + 3：默认（pwsh）只有两个可点的工具选项，没有路径栏、没有自动发现按钮。
const pwshTree = await renderRow(
  { platform: 'win32', dialect: 'pwsh', bashPath: '', settingsAvailable: true, capability: { supported: true } },
  { dialect: 'pwsh', bashPath: '', bashCandidates: [] },
)
check('win32 时渲染出设置行', pwshTree !== null && pwshTree !== undefined, JSON.stringify(pwshTree))
check('行上带本插件的标记属性', pwshTree?.props?.['data-dsh-git-bash-terminal-tool'] === 'row', JSON.stringify(pwshTree?.props))
const pwshButtons = collect(pwshTree, 'button')
const pwshJson = JSON.stringify(pwshTree)
check('默认只给两个终端工具选项', pwshButtons.length === 2, String(pwshButtons.length))
check('两个选项都带文案', pwshJson.includes('row.dialect.pwsh') && pwshJson.includes('row.dialect.bash'))
check(
  '两个选项都可点（不因「还没发现路径」而置灰）',
  pwshButtons.every((button) => button.props.disabled === false),
  JSON.stringify(pwshButtons.map((button) => button.props.disabled)),
)
check('默认（pwsh）不显示 Git Bash 路径栏', !pwshJson.includes('row.path.label'))
check('默认（pwsh）不显示自动发现按钮', !pwshJson.includes('row.discover'))

// 需求 1 + 2：切到 bash 才出现路径栏与「自动发现」；单条路径是输入框。
const bashTree = await renderRow(
  { platform: 'win32', dialect: 'bash', bashPath: '', settingsAvailable: true, capability: { supported: true } },
  { dialect: 'bash', bashPath: 'D:/env/msys2/usr/bin/bash.exe', bashCandidates: [] },
)
const bashJson = JSON.stringify(bashTree)
const bashButtons = collect(bashTree, 'button')
const bashInputs = collect(bashTree, 'input')
check('切到 bash 后出现路径栏', bashJson.includes('row.path.label'))
check('切到 bash 后出现自动发现按钮', bashJson.includes('row.discover'))
check('bash 下按钮 = 两个 chip + 自动发现', bashButtons.length === 3, String(bashButtons.length))
check('只有一条已知路径时用输入框', bashInputs.length === 1 && collect(bashTree, 'select').length === 0)
check(
  '输入框里是已保存的路径',
  bashInputs[0]?.props?.defaultValue === 'D:/env/msys2/usr/bin/bash.exe',
  String(bashInputs[0]?.props?.defaultValue),
)
check('候选清单（可用候选/来源/版本）已不再渲染', !bashJson.includes('row.available') && !bashJson.includes('row.source.'))

// 需求 2：多条 git 路径 → 路径栏变成下拉列表。
const multiTree = await renderRow(
  { platform: 'win32', dialect: 'bash', bashPath: '', settingsAvailable: true, capability: { supported: true } },
  {
    dialect: 'bash',
    bashPath: 'D:/env/msys2/usr/bin/bash.exe',
    bashCandidates: ['D:/env/msys2/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'],
  },
)
const selects = collect(multiTree, 'select')
check('多条路径时路径栏是下拉列表', selects.length === 1, String(selects.length))
check(
  '下拉列表的当前值就是选中的路径',
  selects[0]?.props?.value === 'D:/env/msys2/usr/bin/bash.exe',
  String(selects[0]?.props?.value),
)
const options = collect(selects[0], 'option')
check('下拉列表列出两条持久化路径', options.length === 2, String(options.length))

// --- 设置快照契约：0.2.1 configForms 快照删除 mode（回归：0.4.0 在 0.2.1 上整行只读）---

section('设置快照契约：0.2.1 configForms 快照没有 mode 仍可写')

const snapshotState = {
  platform: 'win32',
  dialect: 'bash',
  bashPath: '',
  settingsAvailable: true,
  capability: { supported: true },
}
const snapshotSettings = { dialect: 'bash', bashPath: 'D:/env/msys2/usr/bin/bash.exe', bashCandidates: [] }

/** 行控件是否全部可点：两个 chip、路径输入框、自动发现按钮都 enabled。 */
function rowControlsEnabled(tree) {
  if (tree === null || tree === undefined) return false
  const chips = collect(tree, 'button').filter(
    (button) => typeof button.props?.className === 'string' && button.props.className.includes('tterm-chip'),
  )
  const discover = buttonWithClass(tree, 'tterm-button')
  const inputs = [...collect(tree, 'input'), ...collect(tree, 'select')]
  return (
    chips.length === 2 &&
    chips.every((chip) => chip.props.disabled === false) &&
    discover !== undefined &&
    discover.props.disabled === false &&
    inputs.length === 1 &&
    inputs.every((input) => input.props.disabled === false)
  )
}

// ① 0.2.1 原生 configForms 快照（无 mode）+ writable:true → 控件可点
const nativeSnapshotTree = await renderRow(snapshotState, snapshotSettings, { channel: 'configForms' })
check('0.2.1 原生 configForms（快照无 mode）渲染出行', nativeSnapshotTree !== null && nativeSnapshotTree !== undefined)
check(
  '0.2.1 原生 configForms（快照无 mode）→ chips / 路径栏 / 自动发现全可点',
  rowControlsEnabled(nativeSnapshotTree),
  JSON.stringify(disabledStates(nativeSnapshotTree)),
)

// ② writable:false → 控件全部 disabled
const readOnlySnapshotTree = await renderRow(snapshotState, snapshotSettings, {
  channel: 'configForms',
  snapshot: { writable: false },
})
const readOnlyStates = disabledStates(readOnlySnapshotTree)
check(
  'writable:false（快照无 mode）→ chips / 路径栏 / 自动发现全 disabled',
  readOnlyStates.length > 0 && readOnlyStates.every((disabled) => disabled === true),
  JSON.stringify(readOnlyStates),
)

// ③ 0.2.0 memory 模式快照（mode:memory，宿主本身 writable:false）→ 仍然 disabled
const memorySnapshotTree = await renderRow(snapshotState, snapshotSettings, {
  channel: 'settingsScope',
  snapshot: { writable: false, mode: 'memory' },
})
const memoryStates = disabledStates(memorySnapshotTree)
check(
  "0.2.0 memory 模式快照（mode:'memory' + writable:false）→ 控件 disabled（语义保持）",
  memoryStates.length > 0 && memoryStates.every((disabled) => disabled === true),
  JSON.stringify(memoryStates),
)

// ④ 0.2.0 host 模式快照（带 mode）仍可写：向后兼容
const hostSnapshotTree = await renderRow(snapshotState, snapshotSettings, {
  channel: 'settingsScope',
  snapshot: { writable: true, mode: 'host' },
})
check("0.2.0 host 模式快照（mode:'host'）仍可写（向后兼容）", rowControlsEnabled(hostSnapshotTree))

// 静态防线：写权限判据不能再引用 mode。
const clientStoreSource = readFileSync(new URL('../src/client/store.ts', import.meta.url), 'utf8')
const clientTypesSource = readFileSync(new URL('../src/client/types.ts', import.meta.url), 'utf8')
check(
  "源码不再用 snapshot.mode === 'host' 判定写权限（0.2.1 快照没有 mode）",
  !clientStoreSource.includes("snapshot.mode === 'host'") && !clientStoreSource.includes('snapshot.mode'),
)
check(
  '构建产物不再包含 mode 写权限判据（防止回退）',
  !bundle.includes('mode === "host"') && !bundle.includes("mode === 'host'"),
)
check(
  'types.ts 的 mode 仍是可选（给 0.2.0 / 家族兼容层留类型位）',
  clientTypesSource.includes("readonly mode?: 'host' | 'memory'"),
)

check('组件渲染只 require react 种子模块', requested.every((id) => id === 'react' || id === 'react/jsx-runtime'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
