/**
 * 浏览器半区 DSH 契约的**结构性窄化投影**。
 *
 * 只保留本插件真正读取的叶子字段，避免引入对官方包的编译期依赖
 * （AGENTS.md 2.8）。字段形状以本机 DSH 0.1.5-rc.1 部署为准：
 * - 会话作用域 Slot 的标准 props（`sessionId`）：`dsh-client-ui-session/lib/types/client/index.d.ts`
 * - `conversation.input.overlay`（list / session）：`dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`
 * - 私有 RPC：`dsh-client-connection/lib/types/rpc.d.ts`
 * - locale：`dsh-client-locale/lib/client.js`（`register(ns, lang, dict)` / `bind(ns)`）
 */
import type { ActionOutcome, RpcResult, TurnChangesView } from '../shared/protocol.js'

/** cordis 客户端上下文的最小面。 */
export interface PluginClientContextLike {
  get(name: string): unknown
  /** 注册 effect；返回的 disposer 由当前 fiber 自动回收。 */
  effect?(execute: () => unknown, label?: string): unknown
}

/** `slots` 服务的最小面。 */
export interface SlotsServiceLike {
  inject(key: string, callback: () => unknown): unknown
  register(
    options: {
      name: string
      key?: string
      id?: string
      order?: number
      locale?: string
    },
    component: (props: any) => unknown,
  ): unknown
}

/** `locale` 服务的最小面（官方是三参非类型化形态）。 */
export interface LocaleLike {
  register(ns: string, language: string, dictionary: Record<string, string>): unknown
  bind(ns: string): ((key: string, params?: Record<string, string>) => string) | undefined
}

/** 客户端 `connection` 服务的最小面。 */
export interface ClientConnectionLike {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>
  }
}

/** 文案取值函数（locale 未就绪时退回 key 本身）。 */
export type Translate = (key: string, params?: Record<string, string>) => string

/** 本插件用的宿主 RPC 门面。 */
export interface TurnRevertApi {
  /** 读某回合的统计与状态。 */
  state(sessionId: string, turn: number): Promise<RpcResult<TurnChangesView>>
  /** 撤回该回合的全部改动。 */
  revert(sessionId: string, turn: number): Promise<RpcResult<ActionOutcome>>
  /** 重新应用该回合的全部改动。 */
  reapply(sessionId: string, turn: number): Promise<RpcResult<ActionOutcome>>
}
