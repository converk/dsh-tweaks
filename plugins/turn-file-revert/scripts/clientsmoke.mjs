/**
 * 浏览器半区冒烟测试（纯 Node，不需要浏览器）。
 *
 * 覆盖 bundle 协议与入口行为：
 * - `lib/client.js` 是经典脚本（非 module），自注册 `window.__ModuleLoader__.load`，
 *   id 与包名一致，且带合法 sourcemap trailer；
 * - 工厂体内只 `require("react")` / `require("react/jsx-runtime")`（AGENTS.md 2.2）；
 * - `apply()` 在假 ctx 上只注册 overlay 席位 + zh/en 词典，不碰别的 Slot；
 * - 锚点组件渲染不抛错，并把宿主 RPC 门面透传给 `augment`。
 *
 * 运行：`node scripts/clientsmoke.mjs`
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let passed = 0
const failures = []

/** 断言。 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    return
  }
  failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/** 断言相等。 */
function equal(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(name, a === b, `expected ${b}, got ${a}`)
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const map = JSON.parse(readFileSync(new URL('../lib/client.js.map', import.meta.url), 'utf8'))

// --- bundle 协议 -----------------------------------------------------------
check('bundle: 不是 ESM（没有顶层 import/export）', !/^\s*(import|export)\s/m.test(bundle))
check('bundle: 自注册 __ModuleLoader__', bundle.startsWith('window.__ModuleLoader__.load({'))
check('bundle: 注册 id 与包名一致', bundle.includes(`id: ${JSON.stringify(pkg.name)}`))
check('bundle: 带 sourcemap trailer', bundle.trimEnd().endsWith('//# sourceMappingURL=client.js.map'))
equal('sourcemap: version 3', map.version, 3)
check('sourcemap: 有 sources 与 mappings', Array.isArray(map.sources) && typeof map.mappings === 'string')
const bareRequires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1])
equal('bundle: 裸说明符只有 react 两个种子模块', [...new Set(bareRequires)].sort(), ['react', 'react/jsx-runtime'])
check('dsh.client 声明了 web 平台', pkg.dsh?.client?.platform === 'web')
check('exports["./client"] 指向 lib/client.js', pkg.exports['./client'].default === './lib/client.js')

// --- 工厂物化 --------------------------------------------------------------
let captured = null
/** 浏览器侧第二条传输（回落用）的 fetch 桩：bundle 在 vm 里执行，`fetch` 取的是这里的全局。 */
const fetchCalls = []
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (record) => {
        captured = record
      },
    },
  },
  fetch: async (url, init) => {
    fetchCalls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: { via: 'fetch' } }),
    }
  },
}
vm.runInNewContext(bundle, sandbox)
check('工厂已注册', captured !== null && typeof captured.factory === 'function')

const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useEffect: () => undefined,
  useRef: (value) => ({ current: value }),
}
const jsxRuntime = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: Symbol('Fragment'),
}
const requested = []
const exportsObject = captured.factory((specifier) => {
  requested.push(specifier)
  if (specifier === 'react') return react
  if (specifier === 'react/jsx-runtime') return jsxRuntime
  throw new Error(`unexpected require: ${specifier}`)
})
check('工厂返回 apply', typeof exportsObject.apply === 'function')
equal('客户端 inject 声明', exportsObject.inject, ['slots', 'locale'])
void requested

// --- apply -----------------------------------------------------------------
const injected = []
const registered = []
const localeCalls = []
const rpcCalls = []
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
  bind: (ns) => (key, params) =>
    params === undefined ? `${ns}:${key}` : `${ns}:${key}(${Object.keys(params).sort().join(',')})`,
}
const connection = {
  rpc: {
    call: async (channel, endpoint, payload) => {
      rpcCalls.push({ channel, endpoint, payload })
      return { ok: true, value: { tracked: false } }
    },
  },
}
const ctx = {
  get: (name) => (name === 'slots' ? slots : name === 'locale' ? locale : name === 'connection' ? connection : undefined),
  effect: (run) => {
    run()
    return () => undefined
  },
}
exportsObject.apply(ctx)

equal('只注册 conversation.input.overlay', injected, ['conversation.input.overlay'])
equal('注册了一个席位', registered.length, 1)
equal('席位名', registered[0]?.options.name, 'conversation.input.overlay')
equal('席位 id 是插件自己的新 id', registered[0]?.options.id, 'turn-file-revert')
equal('席位 order', registered[0]?.options.order, 90)
check('席位组件是函数', typeof registered[0]?.component === 'function')
equal('词典注册 zh/en 两个命名空间', localeCalls.map((call) => call.language).sort(), ['en', 'zh'])
check('词典非空且同键', localeCalls[0]?.keys > 10 && localeCalls[0]?.keys === localeCalls[1]?.keys)

const component = registered[0].component
const wrapper = component({ sessionId: 'session-smoke' })
check('overlay 条目可渲染', wrapper !== undefined && wrapper !== null)
check('overlay 条目把 RPC 门面透传给锚点', typeof wrapper.props?.api?.state === 'function')
// 席位注册的是 (props) => createElement(TurnRevertAnchor, …)，再往里调一层才是锚点本体。
const anchor = wrapper.type(wrapper.props)
check('锚点本体是隐藏 span', anchor?.type === 'span' && anchor.props?.hidden === true)
equal('锚点带自有标记', anchor.props?.['data-dsh-tfr'], 'anchor')

// 通过门面真的打一次 RPC，确认 channel / endpoint / payload 正确
await wrapper.props.api.state('session-smoke', 7)
equal('RPC channel 与 endpoint', [rpcCalls[0]?.channel, rpcCalls[0]?.endpoint], ['/turn-file-revert', 'state'])
equal('RPC payload', rpcCalls[0]?.payload, { sessionId: 'session-smoke', turn: 7 })
await wrapper.props.api.revert('session-smoke', 7)
equal('revert endpoint', rpcCalls[1]?.endpoint, 'revert')
await wrapper.props.api.reapply('session-smoke', 7)
equal('reapply endpoint', rpcCalls[2]?.endpoint, 'reapply')
equal('RPC 通道可用时不走 fetch 兜底', fetchCalls.length, 0)

// 第一条传输失败（通道没注册 / 断线）时自动回落到宿主注册的 /api 精确路由
connection.rpc.call = async (channel, endpoint, payload) => {
  rpcCalls.push({ channel, endpoint, payload })
  throw new Error('transport failure for /turn-file-revert/state: HTTP 405')
}
const fallback = await wrapper.props.api.state('session-smoke', 9)
check('回落 fetch 后成功', fallback.ok === true && fallback.value?.via === 'fetch')
equal('回落请求打到 /api 精确路由', [fetchCalls[0]?.url, fetchCalls[0]?.init?.method], ['/api/turn-file-revert', 'POST'])
equal('回落请求是 { endpoint, payload } 形状', JSON.parse(fetchCalls[0]?.init?.body), {
  endpoint: 'state',
  payload: { sessionId: 'session-smoke', turn: 9 },
})
equal('回落请求带 JSON content-type', fetchCalls[0]?.init?.headers?.['content-type'], 'application/json')

console.log(`\nturn-file-revert clientsmoke: ${String(passed)} passed, ${String(failures.length)} failed`)
for (const failure of failures) console.log(`  ✗ ${failure}`)
if (failures.length > 0) process.exitCode = 1
