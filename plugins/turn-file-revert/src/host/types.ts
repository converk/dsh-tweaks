/**
 * 宿主侧 DSH 契约的**结构性窄化投影**。
 *
 * 本仓库规范（AGENTS.md 2.8）要求插件不引入对官方包的编译期依赖，因此这里
 * 只保留本插件真正读取的叶子字段。字段形状以本机 DSH 0.1.5-rc.1 部署
 * `D:\env\node-global\dsh-stable\node_modules\@deepseek-ai\` 的运行时行为与
 * 类型声明为准：
 * - `ctx.fs`：`@deepseek-ai/dsh-fs/lib/types/index.d.ts`
 * - `ctx.connection.rpc`：`@deepseek-ai/dsh-client-connection/lib/types/rpc.d.ts`
 * - `tools/pre-execute` / `tools/post-execute`：`@deepseek-ai/dsh-tools/lib/types/index.d.ts`
 * - `session/event` / `tool/call`：`@deepseek-ai/dsh-session/lib/types/types.d.ts`
 */

/** cordis 宿主上下文的最小面。 */
export interface HostContextLike {
  /** 读取可选服务；未挂载时为 undefined。 */
  get(name: string): unknown
  /** 监听事件；返回 disposer 由当前 fiber 自动回收。 */
  on(name: string, listener: (...args: any[]) => unknown): unknown
  /** 注册 effect（可返回 Promise<disposer>）。 */
  effect(execute: () => unknown, label?: string): unknown
  /**
   * 等待依赖服务就绪后执行回调（可选，动态插件上下文里没有）。
   * 用于 `connection`：它在宿主组合里可能比本插件晚就绪。
   */
  inject?(names: string[], callback: (scoped: HostContextLike) => unknown): unknown
}

/** `ctx.fs` 的目标标识（不解析、只传递）。 */
export interface FsTargetLike {
  /** 后端内部稳定标识。 */
  readonly targetKey: unknown
  /** 面向模型/UI 的展示路径。 */
  readonly displayPath: string
}

/** 文件沙箱模式（`@deepseek-ai/dsh-sandbox` 的 `SandboxMode`）。 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** 一次能力调用的沙箱策略（`SandboxExecutionPolicy` 的窄化）。 */
export interface SandboxPolicyLike {
  /** 本次写入允许的模式。 */
  readonly mode: SandboxMode
  /** `workspace-write` 允许写入的绝对根目录。 */
  readonly workspaceRoot: string
  /** 调用方会话身份（后端按它会话状态）。 */
  readonly sessionId?: unknown
}

/** `ctx.sandboxPolicy` 的最小面。 */
export interface SandboxPolicyServiceLike {
  /** 部署兜底的 workspace root（没有会话 cwd 时用）。 */
  readonly workspaceRoot?: string
  /**
   * 解析一次能力调用的完整策略；传 `session` 时**以该会话的 cwd 作为 workspace 边界**
   * （不传就会退回部署兜底 root，插件写回文件时会因此被沙箱拒绝）。
   */
  resolve(request?: { session?: object }): SandboxPolicyLike
}

/** `ctx.fs` 的最小面（只用到本插件需要的原语）。 */
export interface FsServiceLike {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetLike>
  stat(target: FsTargetLike, signal?: AbortSignal): Promise<unknown | undefined>
  readText(target: FsTargetLike, signal?: AbortSignal): Promise<string>
  writeText(
    target: FsTargetLike,
    content: string,
    expected?: unknown,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxPolicyLike,
  ): Promise<unknown>
  processPath(target: FsTargetLike): string
  contains(parent: FsTargetLike, child: FsTargetLike): boolean
}

/** 会话的最小面。 */
export interface SessionLike {
  readonly id: string
}

/** 会话事件的最小面（只读 type / seq / data）。 */
export interface SessionEventLike {
  readonly type?: unknown
  readonly seq?: unknown
  readonly data?: unknown
}

/** 一次工具调用的最小面。 */
export interface ToolExecutionLike {
  readonly callId: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: ToolAgentLike | undefined
  readonly signal?: AbortSignal | undefined
}

/** 发起调用的 agent：`id` 是 sessionId，`session.header.cwd` 是会话工作目录。 */
export interface ToolAgentLike {
  readonly id?: string | undefined
  readonly session?: { readonly header?: { readonly cwd?: string | undefined } | undefined } | undefined
}

/** 工具结果的最小面。 */
export interface ToolResultLike {
  readonly isError?: unknown
}

/** 一条精确 Fetch 路由（`HostConnectionFetch.register` 的入参）。 */
export interface FetchRouteLike {
  /** `/api` 之下的绝对路径。 */
  readonly path: string
  /** 该路由拥有的 HTTP 方法。 */
  readonly methods: readonly string[]
  /** 请求体处理方式。 */
  readonly requestBody: 'buffered' | 'streaming'
  /** 物理载体已完成信任与鉴权之后的处理函数。 */
  readonly fetch: (request: Request) => Promise<Response>
}

/** `ctx.connection` 的最小面：注册私有 RPC 通道 + 精确 Fetch 路由。 */
export interface ConnectionServiceLike {
  readonly rpc: {
    /** 注册通道（`docs: HostConnectionRpc.handle`）；返回的 disposer 由 effect 收回。 */
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
    ): () => Promise<void>
  }
  readonly fetch?: {
    /** 注册 `/api` 下的一条精确路由；返回的 disposer 由 effect 收回。 */
    register(route: FetchRouteLike): () => Promise<void>
  }
}

/** `ctx.logger` 的最小面（注册失败时要留下痕迹，不能静默）。 */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}
