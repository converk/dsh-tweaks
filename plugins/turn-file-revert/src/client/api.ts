/**
 * 浏览器侧的宿主门面。
 *
 * 与宿主半区的两条传输对应（见 `src/host/rpc.ts` 的说明）：
 * 1. 先用 `ctx.get('connection').rpc.call(RPC_CHANNEL, …)`——**传输失败**（通道没注册、
 *    断线、HTTP 非 2xx）时返回 `undefined`，交给下一条；
 * 2. 回落到同源 `fetch(HTTP_ROUTE, { endpoint, payload })`——宿主半区注册的 `/api`
 *    精确路由，同样在信任栅栏与登录 cookie 之后。
 *
 * 每次调用都重新取 `connection`：连接在页面生命周期里会重建（断线重连、HMR），
 * 缓存实例会拿到已经失效的 transport。
 */
import { HTTP_ROUTE, RPC_CHANNEL, RPC_REAPPLY, RPC_REVERT, RPC_STATE } from '../shared/protocol.js'
import type { ActionOutcome, RpcResult, TurnChangesView } from '../shared/protocol.js'
import type { ClientConnectionLike, PluginClientContextLike, TurnRevertApi } from './types.js'

/** 响应体是否符合 `{ ok, value }` / `{ ok, error }` 形状。 */
function asRpcResult(parsed: unknown): RpcResult<unknown> | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as { ok?: unknown }
  if (record.ok === true || record.ok === false) return parsed as RpcResult<unknown>
  return null
}

/**
 * 组装 RPC 门面。
 * @param ctx - 客户端上下文。
 * @returns 三个端点各自的强类型包装。
 */
export function createTurnRevertApi(ctx: PluginClientContextLike): TurnRevertApi {
  /** 第一条传输：私有 RPC 通道。返回 undefined = 传输层不可用，换下一条。 */
  const viaConnection = async (endpoint: string, payload: unknown): Promise<RpcResult<unknown> | undefined> => {
    const connection = ctx.get('connection') as ClientConnectionLike | undefined
    if (connection === undefined || connection === null) return undefined
    try {
      return await connection.rpc.call(RPC_CHANNEL, endpoint, payload)
    } catch {
      // 通道没注册 / 传输失败：静默回落，错误由下一条传输给出。
      return undefined
    }
  }

  /** 第二条传输：`/api` 下的精确 Fetch 路由。 */
  const viaFetch = async (endpoint: string, payload: unknown): Promise<RpcResult<unknown>> => {
    try {
      const response = await fetch(HTTP_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
      })
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: `turn-file-revert/http-${String(response.status)}`,
            message: `HTTP ${String(response.status)}`,
          },
        }
      }
      const parsed = asRpcResult(await response.json())
      if (parsed === null) {
        return { ok: false, error: { code: 'turn-file-revert/bad-response', message: '响应不是 { ok, value } 形状' } }
      }
      return parsed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { code: 'turn-file-revert/transport', message } }
    }
  }

  const call = async (endpoint: string, payload: unknown): Promise<RpcResult<unknown>> =>
    (await viaConnection(endpoint, payload)) ?? viaFetch(endpoint, payload)

  return {
    state: (sessionId: string, turn: number) =>
      call(RPC_STATE, { sessionId, turn }) as Promise<RpcResult<TurnChangesView>>,
    revert: (sessionId: string, turn: number) =>
      call(RPC_REVERT, { sessionId, turn }) as Promise<RpcResult<ActionOutcome>>,
    reapply: (sessionId: string, turn: number) =>
      call(RPC_REAPPLY, { sessionId, turn }) as Promise<RpcResult<ActionOutcome>>,
  }
}
