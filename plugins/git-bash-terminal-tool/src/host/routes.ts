/**
 * `/api` 下的两条精确 Fetch 路由（AGENTS.md §2.4：**不要用** `ctx.connection.rpc.handle`）。
 *
 * - `POST /api/dsh-tweaks-terminal/state`    —— 平台、设置服务是否可见、当前值、能力探测。
 *   **不做任何文件系统/子进程扫描**：设置行每次挂载都要读它，扫描是秒级的。
 * - `POST /api/dsh-tweaks-terminal/discover` —— 重新扫描候选（纯查询、无副作用；
 *   只在用户点「自动发现」时被调用，插件自己不会触发）。
 *
 * 写设置**不经过这里**：浏览器半区把本插件 entry Config 的表单绑定到 `webUiSettings`
 * （namespace = profile entry id），由 host 的 `settings.update/mutate` 落盘。
 *
 * 信任栅栏与登录 cookie 由物理 `/api` 载体处理，插件不必自己鉴权。
 */
import { ROUTE_DISCOVER, ROUTE_STATE } from '../shared/protocol.js'
import { discoverBash } from './discover.js'
import { diag } from './diag.js'
import type { CandidateView, DiscoverView, StateView } from '../shared/protocol.js'
import type { ConnectionServiceLike, FetchRouteLike, HostContextLike, LoggerLike } from './types.js'

/** 路由需要的状态读取面（由 `index.ts` 提供）。 */
export interface RouteDeps {
  /** 当前设置值（host 解析后的）。 */
  readonly readSettings: () => { dialect: 'pwsh' | 'bash'; bashPath: string }
  /** capability 视图。 */
  readonly capability: () => { supported: boolean; reason?: string | undefined; shellSandboxMode?: string | undefined }
  /** 宿主设置服务是否可见（设置表单可写）。 */
  readonly settingsAvailable: () => boolean
  /** 最近的替换报告。 */
  readonly lastReplace: () => { applied: boolean; at: number; reason?: string | undefined } | undefined
}

/** 结构化 JSON 响应。 */
function jsonResponse(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 把错误压成一行（诊断用）。 */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error)
}

/** 往宿主 logger 写一条（拿不到就静默）。 */
function note(ctx: HostContextLike, level: 'info' | 'warn' | 'error', message: string): void {
  try {
    const logger = ctx.get('logger') as LoggerLike | undefined
    const write = logger?.[level]
    if (typeof write === 'function') write.call(logger, `[git-bash-terminal-tool] ${message}`)
  } catch {
    // 诊断本身失败不影响注册。
  }
}

/** 读取 JSON 请求体（失败时给一个空对象，路由本身不因坏 body 失败）。 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json()
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 候选的内部形状 → wire 视图。 */
function toView(candidate: { path: string; source: string; valid: boolean; version?: string | undefined }): CandidateView {
  return {
    path: candidate.path,
    source: candidate.source as CandidateView['source'],
    valid: candidate.valid,
    ...(candidate.version !== undefined ? { version: candidate.version } : {}),
  }
}

/**
 * 注册两条精确 Fetch 路由。
 *
 * `connection` 是可选服务：拿不到就只写诊断（设置行的「当前版本不支持」会显示出来）。
 * @param ctx - 宿主上下文。
 * @param deps - 状态读取面。
 */
export function registerRoutes(ctx: HostContextLike, deps: RouteDeps): void {
  const attach = (target: HostContextLike): void => {
    const connection = target.get('connection') as ConnectionServiceLike | undefined
    const register = connection?.fetch?.register
    if (connection === undefined || connection === null || typeof register !== 'function') {
      diag('routes: ctx.connection.fetch is not visible')
      note(target, 'warn', 'connection.fetch 不可见，设置行的自动发现不可用')
      return
    }

    const make = (path: string, handler: (body: Record<string, unknown>) => unknown): FetchRouteLike => ({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        try {
          const body = await readBody(request)
          return jsonResponse(handler(body), 200)
        } catch (error) {
          diag(`routes: ${path} failed: ${messageOf(error)}`)
          return jsonResponse({ ok: false, error: messageOf(error) }, 200)
        }
      },
    })

    const state = make(ROUTE_STATE, (): StateView => {
      const settings = deps.readSettings()
      const capability = deps.capability()
      const last = deps.lastReplace()
      return {
        platform: process.platform,
        settingsAvailable: deps.settingsAvailable(),
        dialect: settings.dialect,
        bashPath: settings.bashPath,
        capability: {
          supported: capability.supported,
          ...(capability.reason !== undefined ? { reason: capability.reason } : {}),
          ...(capability.shellSandboxMode !== undefined ? { shellSandboxMode: capability.shellSandboxMode } : {}),
        },
        ...(last !== undefined
          ? { lastReplace: { at: last.at, applied: last.applied, ...(last.reason !== undefined ? { reason: last.reason } : {}) } }
          : {}),
      }
    })

    const discover = make(ROUTE_DISCOVER, (body): DiscoverView => {
      const saved = typeof body.bashPath === 'string' && body.bashPath.length > 0 ? body.bashPath : undefined
      const candidates = discoverBash({ saved })
      return { candidates: candidates.map(toView) }
    })

    for (const route of [state, discover]) {
      try {
        const dispose = register.call(connection.fetch, route)
        target.effect(
          () => () => {
            void dispose()
          },
          `git-bash-terminal-tool: fetch route ${route.path}`,
        )
        diag(`routes: registered ${route.path}`)
      } catch (error) {
        diag(`routes: register ${route.path} failed: ${messageOf(error)}`)
        note(target, 'error', `路由 ${route.path} 注册失败：${messageOf(error)}`)
      }
    }
  }

  // 插件级 inject 保持为空（headless 组合里也要能挂）；这里用局部 inject 等 connection 就绪。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (scoped) => {
      attach(scoped)
    })
    return
  }
  attach(ctx)
}

