/**
 * 宿主侧通道注册与请求校验。
 *
 * 浏览器半区有两条取数路径，宿主半区**两条都注册**（谁可用用谁）：
 *
 * 1. **私有 RPC 前缀通道**：`ctx.connection.rpc.handle(RPC_CHANNEL, handler)`。
 *    它挂在与 `/api` 同一套浏览器信任栅栏之后，浏览器侧用
 *    `ctx.get('connection').rpc.call(channel, endpoint, payload)`。
 *    **它有个隐藏前提**：`handle()` 会拿**调用方 ctx**（`owner = this.ctx`）去
 *    `owner.webServer.register(route)` 挂物理路由，而 cordis 的属性访问要求那个 ctx
 *    在 inject 里声明过 `webServer`，否则抛
 *    `cannot get property "webServer" without inject`
 *    （动态插件沙箱里尤其明显：服务被包了 Proxy，绑定还会丢）。所以本模块一律在
 *    `ctx.inject(['connection', 'webServer'], …)` 的 scoped ctx 里调用它。
 *
 * 2. **`/api` 下的精确 Fetch 路由**：`ctx.connection.fetch.register({ path: HTTP_ROUTE, … })`。
 *    它只往 connection 自己的路由表塞一条记录（**不碰 `webServer`**），浏览器侧用同源
 *    `fetch(HTTP_ROUTE, …)` 调用；物理 `/api` 载体已经做过信任与鉴权。
 *
 * 两条都失败时会把原因写进宿主日志与诊断文件（`os.tmpdir()/dsh-turn-file-revert.log`），
 * 而不是静默丢掉整个功能。
 */
import { HTTP_ROUTE, RPC_CHANNEL, RPC_REAPPLY, RPC_REVERT, RPC_STATE } from '../shared/protocol.js'
import type { ActionOutcome, TurnChangesView } from '../shared/protocol.js'
import { diag } from './diag.js'
import type { TurnFileTracker } from './tracker.js'
import type { ConnectionServiceLike, FetchRouteLike, HostContextLike, LoggerLike } from './types.js'

/** 一次调用的回合定位参数。 */
interface TurnRequest {
  readonly sessionId: string
  readonly turn: number
}

/** 端点处理体：吃 `(endpoint, payload)`，吐 ConnectionRpcResult 形状。 */
type EndpointHandler = (endpoint: string, payload: unknown) => Promise<unknown>

/** 结构化失败结果（与 ConnectionRpcResult 的失败分支同形）。 */
function fail(code: string, message: string): unknown {
  return { ok: false, error: { code: `turn-file-revert/${code}`, message, details: {} } }
}

/** 结构化成功结果。 */
function ok<T>(value: T): unknown {
  return { ok: true, value }
}

/** 取对象里的非空字符串字段。 */
function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

/** 取对象里的非负整数字段。 */
function readTurn(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>).turn
  return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : null
}

/** 校验并窄化回合定位参数。 */
export function readTurnRequest(payload: unknown): TurnRequest | null {
  const sessionId = readString(payload, 'sessionId')
  const turn = readTurn(payload)
  if (sessionId === null || turn === null) return null
  return { sessionId, turn }
}

/** 把错误压成一行。 */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

/** 错误栈（诊断文件里带上，便于定位）。 */
function stackOf(error: unknown): string {
  return error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
}

/** 往宿主日志写一条诊断（拿不到 logger 时静默）。 */
function note(ctx: HostContextLike, level: 'info' | 'warn' | 'error', message: string): void {
  try {
    const logger = ctx.get('logger') as LoggerLike | undefined
    const write = logger?.[level]
    if (typeof write === 'function') write.call(logger, `[turn-file-revert] ${message}`)
  } catch {
    // 诊断本身失败不影响注册。
  }
}

/** JSON 响应（自己拼，避免依赖 `Response.json` 的运行时版本）。 */
function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 把追踪器包成端点处理体（两条传输共用同一份实现）。 */
function createHandler(tracker: TurnFileTracker): EndpointHandler {
  return async (endpoint: string, payload: unknown): Promise<unknown> => {
    try {
      const request = readTurnRequest(payload)
      if (request === null) return fail('bad-request', `${endpoint} 需要 { sessionId, turn }`)
      if (endpoint === RPC_STATE) {
        const view: TurnChangesView = tracker.view(request.sessionId, request.turn)
        return ok(view)
      }
      if (endpoint === RPC_REVERT) {
        const outcome: ActionOutcome = await tracker.revert(request.sessionId, request.turn)
        return ok(outcome)
      }
      if (endpoint === RPC_REAPPLY) {
        const outcome: ActionOutcome = await tracker.reapply(request.sessionId, request.turn)
        return ok(outcome)
      }
      return fail('unknown-endpoint', `未知 endpoint：${endpoint}`)
    } catch (error) {
      return fail('not-tracked', messageOf(error))
    }
  }
}

/**
 * 注册私有 RPC 前缀通道。
 * @param target - 已声明 connection + webServer 的 ctx。
 * @param connection - connection 服务视图。
 * @param handler - 端点处理体。
 * @returns `ok` 或失败原因（用于诊断）。
 */
function registerRpcChannel(target: HostContextLike, connection: ConnectionServiceLike, handler: EndpointHandler): string {
  if (typeof connection.rpc?.handle !== 'function') return 'no-rpc-handle'
  try {
    const dispose = connection.rpc.handle(RPC_CHANNEL, (endpoint, payload) => handler(endpoint, payload))
    target.effect(
      () => () => {
        void dispose()
      },
      'turn-file-revert: rpc channel',
    )
    return 'ok'
  } catch (error) {
    diag(`rpc.handle failed: ${messageOf(error)} | ${stackOf(error)}`)
    return `error:${messageOf(error)}`
  }
}

/**
 * 注册 `/api` 下的精确 Fetch 路由（不碰 webServer，是 RPC 通道不可用时的兜底）。
 * @param target - 已声明 connection + webServer 的 ctx。
 * @param connection - connection 服务视图。
 * @param handler - 端点处理体。
 * @returns `ok` 或失败原因（用于诊断）。
 */
function registerFetchRoute(target: HostContextLike, connection: ConnectionServiceLike, handler: EndpointHandler): string {
  const register = connection.fetch?.register
  if (typeof register !== 'function') return 'no-fetch-register'
  const route: FetchRouteLike = {
    path: HTTP_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return jsonResponse(fail('bad-json', 'body is not JSON'), 400)
      }
      const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
      const endpoint = typeof record.endpoint === 'string' ? record.endpoint : ''
      return jsonResponse(await handler(endpoint, record.payload), 200)
    },
  }
  try {
    const dispose = register.call(connection.fetch, route)
    target.effect(
      () => () => {
        void dispose()
      },
      'turn-file-revert: fetch route',
    )
    return 'ok'
  } catch (error) {
    diag(`fetch.register failed: ${messageOf(error)} | ${stackOf(error)}`)
    return `error:${messageOf(error)}`
  }
}

/**
 * 注册本插件的两条宿主传输（同一个 ctx 只会注册一次）。
 * @param ctx - 宿主上下文。
 * @param tracker - 追踪器实例。
 */
export function registerTurnFileRpc(ctx: HostContextLike, tracker: TurnFileTracker): void {
  let attached = false

  const attach = (target: HostContextLike): void => {
    if (attached) return
    attached = true
    const connection = target.get('connection') as ConnectionServiceLike | undefined
    if (connection === undefined || connection === null) {
      diag('register: connection service is not visible')
      note(target, 'warn', 'connection 服务不可见，浏览器半区无法取数')
      return
    }
    const handler = createHandler(tracker)
    const rpc = registerRpcChannel(target, connection, handler)
    const fetch = registerFetchRoute(target, connection, handler)
    diag(`register: rpc=${rpc} fetch=${fetch}`)
    if (rpc !== 'ok' && fetch !== 'ok') {
      note(target, 'error', `两条宿主传输都没注册成功（rpc=${rpc} fetch=${fetch}）`)
    }
  }

  // 关键：rpc.handle 需要注册方 ctx 声明过 webServer；fetch.register 不需要，但两者共用
  // 同一个 scoped ctx 即可（见文件头）。插件级 inject 保持为空，headless 组合里追踪照常。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection', 'webServer'], (scoped) => {
      attach(scoped)
    })
    return
  }
  // 极简上下文（Node 侧自测、没有 ctx.inject 的运行器）：当场注册。
  attach(ctx)
}
