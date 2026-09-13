/**
 * 宿主侧 DSH 契约的**结构性窄化投影**。
 *
 * 本仓库规范（AGENTS.md §2.8）要求插件不引入对官方包的编译期/运行时依赖，
 * 因此这里只保留本插件真正读取的叶子字段。字段形状以本机 DSH 0.1.5-rc.1 部署
 * `D:\env\node-global\dsh-stable\node_modules\@deepseek-ai\` 的 d.ts 与运行时源码为准：
 *
 * - `agent/session-start` / `Agent.ctx`：`dsh-agent/lib/types/runtime-types.d.ts`
 * - `tools.register` / `tools.restrict`：`dsh-tools/lib/types/index.d.ts`（`restrict` 实现见 `lib/index.js`）
 * - `systemPrompt.section`：`dsh-system-prompt/lib/types/index.d.ts`
 * - `sandboxPolicy.resolve`：`dsh-sandbox-policy/lib/types/index.d.ts`
 * - `sandbox.confine`：`dsh-sandbox/lib/types/index.d.ts`
 * - `subprocess.spawn`：`dsh-subprocess/lib/types/{index,types}.d.ts`
 * - `jobs.start`：`dsh-jobs/lib/types/{index,types}.d.ts`
 * - `shellEnv.collect`：`dsh-shell-env/lib/types/index.d.ts`
 * - `approval.request`：`dsh-user-approval/lib/types/index.d.ts`
 * - `connection.fetch.register`：`dsh-client-connection/lib/types/rpc.d.ts`
 * - `settings.register`：`dsh-settings/lib/types/index.d.ts`
 *
 * ⚠️ 契约变了集中改这里，不要散落到各文件。
 */

import type { BashSource } from './discover.js'
import type { CapabilityView, Dialect } from '../shared/protocol.js'

/** cordis 宿主上下文的最小面。 */
export interface HostContextLike {
  /** 读取可选服务；未挂载时为 undefined。 */
  get(name: string): unknown
  /** 监听事件；返回 disposer 由当前 fiber 自动回收。 */
  on(name: string, listener: (...args: any[]) => unknown): unknown
  /** 注册 effect（可返回 disposer），随插件 fiber 回收。 */
  effect(execute: () => unknown, label?: string): unknown
  /** 等待依赖服务就绪后执行回调。 */
  inject?(names: string[], callback: (scoped: HostContextLike) => unknown): unknown
}

/** `ctx.logger` 的最小面。 */
export interface LoggerLike {
  info?(message: string): void
  warn?(message: string): void
  error?(message: string): void
}

// ---------------------------------------------------------------------------
// agent / 事件
// ---------------------------------------------------------------------------

/** 会话启动原因（`SessionStartSource`）。 */
export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'

/** `agent/session-start` 的载荷（只取本插件需要的两个字段）。 */
export interface SessionStartPayload {
  readonly agent: AgentLike
  readonly source: SessionStartSource
}

/** 会话头（只读 `cwd`）。 */
export interface SessionHeaderLike {
  readonly cwd?: string | undefined
}

/** 会话的最小面。 */
export interface SessionLike {
  readonly id: string
  readonly header?: SessionHeaderLike | undefined
}

/**
 * agent 的最小面。
 *
 * `ctx` 是 **agent 自己的 scope context**（`dsh-agent` 的 `Agent.ctx`）：
 * 通过它注册的工具与提示词 section 只覆盖这个 agent，且随 agent 释放而撤销。
 */
export interface AgentLike {
  readonly id: string
  readonly session?: SessionLike | undefined
  readonly ctx: AgentContextLike
}

/** agent scope context：与宿主上下文同形，但注册会带上该 agent 的 scope。 */
export type AgentContextLike = HostContextLike

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

/** 沙箱模式。 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** 输出流投影（`CollectedOutput`）。 */
export interface CollectedOutputLike {
  readonly text: string
  readonly truncated: boolean
  readonly spillPath?: string | undefined
}

/** 内容块（只用到文本块）。 */
export interface ContentBlockLike {
  readonly type: 'text'
  readonly text: string
}

/** `tools.register` 的入参（`ToolDefinition` 的窄化）。 */
export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  /** 原始 JSON Schema（`ToolSchema.parameters`；register 不校验该字段）。 */
  readonly parameters: Record<string, unknown>
  /** 规范输出契约；`schema` 会被 `assertSupportedJsonSchema` 校验。 */
  readonly output: {
    readonly schema: Record<string, unknown>
    readonly render: (args: unknown, value: unknown) => ContentBlockLike[]
  }
  execute(args: unknown, exec: ToolRunContextLike): Promise<unknown>
  presentCall?(args: unknown): unknown
  presentResult?(args: unknown, result: ToolResultLike): unknown
}

/** `presentResult` 收到的结果视图。 */
export interface ToolResultLike {
  readonly content: readonly ContentBlockLike[]
  readonly isError: boolean
}

/** 一次工具执行（`ToolRunContext` 的窄化）。 */
export interface ToolRunContextLike {
  readonly callId: string
  readonly signal: AbortSignal
  readonly agent?: AgentLike | undefined
}

/** 工具过滤器（`ToolRestriction`）。 */
export interface ToolRestrictionLike {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

/** `ctx.tools` 的最小面。 */
export interface ToolRuntimeLike {
  /** 在当前 scope 注册工具；返回精确 disposer（由 effect 收回）。 */
  register(definition: ToolDefinitionLike): () => void
  /**
   * 限制**继承来的**全局工具（自己这一层注册的不受限制）。
   * ⚠️ 必须是 scoped context（`agent.ctx`）；名字未知时**抛错**。
   */
  restrict(filter: ToolRestrictionLike): () => void
}

// ---------------------------------------------------------------------------
// systemPrompt
// ---------------------------------------------------------------------------

/** 一个提示词 section（`PromptSection`）。 */
export interface PromptSectionLike {
  readonly name: string
  readonly order: number
  readonly text: string | ((context: unknown) => string)
}

/** `ctx.systemPrompt` 的最小面。 */
export interface SystemPromptLike {
  /** 在当前 scope 注册 section；同名会 shadow 更靠外的 section（空文本会被丢弃）。 */
  section(section: PromptSectionLike): () => void
  /** 读取集中分配的 section 顺序名。 */
  getSectionOrder(name: string): number
}

// ---------------------------------------------------------------------------
// sandbox / sandboxPolicy
// ---------------------------------------------------------------------------

/** 一次能力调用的沙箱策略（`SandboxExecutionPolicy` 的窄化）。 */
export interface SandboxPolicyLike {
  readonly mode: SandboxMode
  readonly workspaceRoot: string
  readonly sessionId?: unknown
}

/** 受限策略（`mode` 已收窄为非 `danger-full-access`）。 */
export interface ConfinedSandboxPolicyLike {
  readonly mode: 'read-only' | 'workspace-write'
  readonly workspaceRoot: string
  readonly sessionId?: unknown
}

/** `ctx.sandboxPolicy` 的最小面。 */
export interface SandboxPolicyServiceLike {
  readonly defaultMode?: SandboxMode
  readonly workspaceRoot?: string
  resolve(request?: { session?: object; mode?: SandboxMode }): SandboxPolicyLike
}

/** 沙箱 runner 生效度（`SandboxEnforcement`）。 */
export type SandboxEnforcement = 'full' | 'partial'

/** runner 失败判据（`RunnerFailureRule`）。 */
export interface RunnerFailureRuleLike {
  readonly allowedExitCodes?: readonly number[]
  readonly fatalSignatures: readonly string[]
  readonly informationalLines?: readonly string[]
}

/** `ctx.sandbox.confine` 的返回（`ConfinedArgv` 的窄化）。 */
export interface ConfinedArgvLike {
  readonly argv: string[]
  readonly enforcement: SandboxEnforcement
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: readonly RunnerFailureRuleLike[]
}

/** `ctx.sandbox` 的最小面。 */
export interface SandboxProviderLike {
  /** 用 runner 包住 caller 的 argv；无法强制时 fail closed（抛错）。 */
  confine(argv: readonly string[], policy: ConfinedSandboxPolicyLike): ConfinedArgvLike
}

/** 一次运行后的沙箱事实（`ShellSandboxInfo` 的窄化）。 */
export interface SandboxInfoLike {
  readonly mode: SandboxMode
  readonly denied: boolean
  readonly enforcement?: SandboxEnforcement | undefined
  readonly runnerFailed?: boolean | undefined
}

// ---------------------------------------------------------------------------
// subprocess
// ---------------------------------------------------------------------------

/** 单流的有界收集配置。 */
export interface SubprocessCollectLike {
  readonly maxBytes: number
  readonly spill?: { readonly maxBytes: number } | undefined
}

/** `SubprocessSpawnSpec` 的窄化。 */
export interface SubprocessSpawnSpecLike {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdin: 'ignore' | 'pipe' | { readonly data: string }
    readonly stdout: 'pipe' | 'inherit' | SubprocessCollectLike
    readonly stderr: 'pipe' | 'inherit' | SubprocessCollectLike
  }
  readonly graceMs: number
  readonly signal?: AbortSignal | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
}

/** 一次增量读取（`SubprocessOutputRead`）。 */
export interface SubprocessOutputReadLike {
  readonly text: string
  readonly nextOffset: number
  readonly lossy: boolean
  readonly spillPath?: string | undefined
}

/** 一个收集流的增量读取器。 */
export interface SubprocessOutputReaderLike {
  readFrom(fromByte: number): SubprocessOutputReadLike
}

/** 进程退出事实（`SubprocessOutcome`）。 */
export interface SubprocessOutcomeLike {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/** `SubprocessHandle` 的窄化。 */
export interface SubprocessHandleLike {
  readonly collected: {
    readonly stdout?: SubprocessOutputReaderLike | undefined
    readonly stderr?: SubprocessOutputReaderLike | undefined
  }
  readonly done: Promise<SubprocessOutcomeLike>
  terminate(): void
}

/** `ctx.subprocess` 的最小面。 */
export interface SubprocessRuntimeLike {
  spawn(spec: SubprocessSpawnSpecLike): SubprocessHandleLike
}

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------

/** 一个后台任务的终态（`JobOutcome` 的窄化）。 */
export interface JobOutcomeLike {
  readonly status: 'completed' | 'killed' | 'failed'
  readonly detail?: string | undefined
  readonly output?: string | undefined
}

/** 生产方交给 `jobs.start` 的钩子（`JobHooks` 的窄化）。 */
export interface JobHooksLike {
  cancel(reason?: string): void
  readonly done: Promise<JobOutcomeLike>
  readOutput?(): string
}

/** `jobs.start` 的入参（`JobStart` 的窄化）。 */
export interface JobStartLike {
  readonly kind: string
  readonly label: string
  readonly outputLimitBytes?: number | undefined
  readonly owner?: AgentLike | undefined
  run(): JobHooksLike
}

/** `ctx.jobs` 的最小面。 */
export interface JobRegistryLike {
  start(spec: JobStartLike): string
}

// ---------------------------------------------------------------------------
// shellEnv / approval
// ---------------------------------------------------------------------------

/** `ctx.shellEnv` 的最小面。 */
export interface ShellEnvRegistryLike {
  /** 收集本次执行的受管 `DSH_*` 环境。 */
  collect(execution: { readonly agent?: AgentLike | undefined }): Readonly<Record<string, string>>
}

/** `ctx.approval` 的最小面（`ApprovalService.request` 的结构形状）。 */
export interface ApprovalServiceLike {
  request(request: {
    agent: AgentLike
    toolName: string
    callId: string
    reason: string
    signal?: AbortSignal | undefined
  }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

// ---------------------------------------------------------------------------
// connection / settings
// ---------------------------------------------------------------------------

/** 一条精确 Fetch 路由（`ConnectionFetchRoute` 的窄化）。 */
export interface FetchRouteLike {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/** `ctx.connection` 的最小面（只用精确 Fetch 路由，绝不碰 `rpc.handle`）。 */
export interface ConnectionServiceLike {
  readonly fetch?: {
    register(route: FetchRouteLike): () => Promise<void>
  }
}

/** schemastery 兼容的 schema：既能 resolve 值，又能给出 wire 形状。 */
export interface SettingsSchemaLike<T> {
  (input: unknown): T
  toJSON(): unknown
}

/** `settings.register` 的选项（`SettingsRegisterOptions` 的窄化）。 */
export interface SettingsRegisterOptionsLike<T> {
  readonly base?: Partial<T> | undefined
  readonly applies?: 'live' | 'restart' | undefined
  /** 拒绝 schema 表达不了的跨字段约束；抛出即**拒绝这次写入**。 */
  readonly validate?: ((value: T) => void) | undefined
}

/** 一个已注册 namespace 的 owner scope（`SettingsScope` 的窄化）。 */
export interface SettingsScopeLike<T> {
  get(): T
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  update(patch: object): Promise<void>
  replace(section: object): Promise<void>
}

/** `ctx.settings` 的最小面。 */
export interface SettingsProviderLike {
  register<T>(
    ns: string,
    schema: SettingsSchemaLike<T>,
    options?: SettingsRegisterOptionsLike<T>,
  ): SettingsScopeLike<T>
  get(ns: string): unknown
}

// ---------------------------------------------------------------------------
// 本插件自己的类型
// ---------------------------------------------------------------------------

/** `terminal-tool` namespace 的值。 */
export interface TerminalToolSettings {
  readonly dialect: Dialect
  readonly bashPath: string
  /**
   * 上一次「自动发现」扫到的可用路径（用户主动点出来的结果）。
   *
   * 只用于设置行的下拉列表：持久化它，重启 dsh 后仍然能直接在下拉里换路径，
   * 不必为了「多看几条」再点一次自动发现。**绝不**用它自动改写 `dialect`。
   */
  readonly bashCandidates: readonly string[]
}

/** 一次 discovery 结果（host 内部使用）。 */
export interface BashCandidateInternal {
  readonly path: string
  readonly source: BashSource
  readonly valid: boolean
  readonly version?: string | undefined
}

/** capability 探测的输入（可注入，便于自测）。 */
export interface CapabilityProbeInput {
  readonly platform: string
  readonly hasTools: boolean
  readonly hasSystemPrompt: boolean
  readonly hasSettings: boolean
  /** `ctx.shell.sandboxMode`；undefined 表示本部署不 confine（不 advertise 升级字段）。 */
  readonly shellSandboxMode?: SandboxMode | undefined
}

/** capability 探测结果（与 wire 视图同形）。 */
export type CapabilityProbeResult = CapabilityView
