/**
 * 核心替换逻辑：在 `agent/session-start` 时，**在该 agent 自己的 scope 里**
 * 把 preset（祖先层）注册的 `pwsh` 工具隐藏，并注册一个自包含的 Git Bash 工具。
 *
 * 三条动作（设计文档 §5.2.3）：
 *
 * 1. `agent.ctx.tools.restrict({ deny: ['pwsh'] })` —— 隐藏 preset 祖先层注册的 `pwsh`
 *    （`restrict` 只过滤**继承来的**工具，不动自己这一层注册的，也不影响 host / 其他 agent）；
 * 2. `agent.ctx.tools.register(<自包含 Git Bash ToolDefinition>)` —— 工具名 `bash`；
 * 3. `agent.ctx.systemPrompt.section({ name: 'tool:pwsh', order: 1010, text: '' })`
 *    —— 同名 scoped section 会 shadow 更靠外的 section，空文本会被丢弃，于是
 *    preset 留下的 PowerShell 提示词被压掉；再注册 `tool:bash` 的 bash 语义提示。
 *
 * 判定条件（全部满足才替换，见 §5.2.2）：
 * 1. `process.platform === 'win32'`；
 * 2. 设置为 `bash` 且 `bashPath` 非空且文件确实存在；
 * 3. 该 agent 当前能看见 `pwsh` —— 直接用 `restrict` 的成功/抛错判定
 *    （子代理会继承父层已经处理过的结果，此时 `pwsh` 已是不可限制的未知名 →
 *    `restrict` 抛错 → 直接跳过）；
 * 4. 能力探测通过（`tools.restrict` / `tools.register` / `systemPrompt.section` 都在）。
 *
 * 纪律：**不抛异常、不 veto**。任何失败只写诊断日志并把原因回给调用方（设置行/诊断），
 * 绝不让一次替换失败影响会话。
 */
import { createBashTool, type BashToolRuntime } from './bash-tool.js'
import { diag } from './diag.js'
import { validateSettings } from './settings.js'
import type {
  AgentContextLike,
  AgentLike,
  HostContextLike,
  SystemPromptLike,
  TerminalToolSettings,
  ToolRuntimeLike,
} from './types.js'

/** preset 注册的 Windows 终端工具名（`dsh-tool-pwsh`）。 */
export const PWSH_TOOL_NAME = 'pwsh'

/** `tool:bash` 提示词 section 的顺序（`SECTION_ORDERS.TOOL_BASH`）。 */
export const ORDER_TOOL_BASH = 1000

/** `tool:pwsh` 提示词 section 的顺序（`SECTION_ORDERS.TOOL_PWSH`）。 */
export const ORDER_TOOL_PWSH = 1010

/** `tool:bash` 的提示词正文（官方 `dsh-tool-bash` 用的同一句）。 */
export const TOOL_BASH_SECTION_TEXT =
  'Check the [exit code: N] marker on every bash result; investigate failures before moving on.'

/** 一次替换尝试的结果（用于诊断与设置行的状态显示）。 */
export interface ReplaceAttempt {
  /** 是否真的完成了替换。 */
  readonly applied: boolean
  /** 未替换的原因（成功时为 undefined）。 */
  readonly reason?: string
}

/** 能力探测：`agent.ctx` 上是否具备替换所需的三个方法。 */
export interface ReplaceCapability {
  readonly tools: ToolRuntimeLike | undefined
  readonly systemPrompt: SystemPromptLike | undefined
  readonly toolsLike: boolean
  readonly registerLike: boolean
  readonly restrictLike: boolean
  readonly promptLike: boolean
}

/** 以最小假设做特性探测（不信任任何 import 来的类型）。 */
export function probeCapability(agentCtx: AgentContextLike): ReplaceCapability {
  const tools = readService<ToolRuntimeLike>(agentCtx, 'tools')
  const systemPrompt = readService<SystemPromptLike>(agentCtx, 'systemPrompt')
  const registerLike = typeof tools?.register === 'function'
  const restrictLike = typeof tools?.restrict === 'function'
  const promptLike = typeof systemPrompt?.section === 'function'
  return {
    tools: registerLike && restrictLike ? tools : undefined,
    systemPrompt: promptLike ? systemPrompt : undefined,
    toolsLike: tools !== undefined,
    registerLike,
    restrictLike,
    promptLike,
  }
}

/** 安全地读一个可选服务（`get` 可能不存在或抛错）。 */
function readService<T>(ctx: { get?(name: string): unknown }, name: string): T | undefined {
  try {
    const value = typeof ctx.get === 'function' ? ctx.get(name) : undefined
    return value === undefined || value === null ? undefined : (value as T)
  } catch {
    return undefined
  }
}

/**
 * 对一个 agent 做一次替换尝试。
 *
 * 幂等由调用方（`registerReplacement` 的 `WeakSet`）保证；这里只负责判定与动作。
 * @param host - 宿主上下文（读 `subprocess` / `sandbox` / `jobs` 等全局服务）。
 * @param agent - 目标 agent。
 * @param settings - 当前设置（本会话建立时读到的快照，决策 B）。
 * @returns 本次尝试的结果。
 */
export function replaceTerminalTool(
  host: HostContextLike,
  agent: AgentLike,
  settings: TerminalToolSettings,
): ReplaceAttempt {
  if (process.platform !== 'win32') return { applied: false, reason: 'platform is not win32' }
  if (settings.dialect !== 'bash') return { applied: false, reason: 'dialect is pwsh' }
  if (settings.bashPath.length === 0) return { applied: false, reason: 'bashPath is empty' }

  // 0.1.7 的 Config schema 表达不了「路径存在且非 WSL」，校验放在使用点：
  // 不合法就跳过替换（会话照旧 pwsh），绝不注册一个指向坏路径的工具。
  try {
    validateSettings(settings)
  } catch (error) {
    return { applied: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const agentCtx = agent.ctx
  if (agentCtx === undefined || agentCtx === null) return { applied: false, reason: 'agent has no scoped ctx' }

  const capability = probeCapability(agentCtx)
  if (!capability.toolsLike) return { applied: false, reason: 'ctx.tools is not visible in the agent scope' }
  if (!capability.registerLike || !capability.restrictLike) {
    return { applied: false, reason: 'this DSH version has no tools.register/tools.restrict' }
  }
  if (!capability.promptLike) return { applied: false, reason: 'this DSH version has no systemPrompt.section' }
  if (!readService<{ spawn?: unknown }>(host, 'subprocess')?.spawn) {
    return { applied: false, reason: 'ctx.subprocess is not visible' }
  }

  const tools = capability.tools
  const systemPrompt = capability.systemPrompt
  if (tools === undefined || systemPrompt === undefined) {
    return { applied: false, reason: 'capability probe returned no usable services' }
  }

  // 第 3 条判定：`restrict` 的成功/抛错就是最准确、最省事的「该 agent 现在能看见 pwsh 吗」。
  let releaseRestriction: (() => void) | undefined
  try {
    releaseRestriction = tools.restrict({ deny: [PWSH_TOOL_NAME] })
  } catch (error) {
    // 未知名字 ⇒ 该 agent 的可见面上已经没有 pwsh（典型场景：子代理继承了父层的结果）。
    const message = error instanceof Error ? error.message : String(error)
    diag(`replace: restrict(deny:[${PWSH_TOOL_NAME}]) refused, skipping agent=${agent.id}: ${message}`)
    return { applied: false, reason: `pwsh is not restrictable here (already hidden?): ${message}` }
  }

  try {
    const runtime = buildRuntime(host, settings.bashPath)
    const releaseTool = tools.register(createBashTool(runtime))
    const releasePwshSection = systemPrompt.section({ name: 'tool:pwsh', order: ORDER_TOOL_PWSH, text: '' })
    const releaseBashSection = systemPrompt.section({
      name: 'tool:bash',
      order: ORDER_TOOL_BASH,
      text: TOOL_BASH_SECTION_TEXT,
    })
    // 所有 disposer 都登记到 agent 自己的 ctx 上：agent 释放时自动撤销。
    for (const release of [releaseRestriction, releaseTool, releasePwshSection, releaseBashSection]) {
      try {
        agentCtx.effect(() => release, 'git-bash-terminal-tool: replacement')
      } catch {
        // effect 登记失败不影响已经生效的注册（agent 释放时随 scope 一起清理）。
      }
    }
    diag(`replace: applied agent=${agent.id} bash=${settings.bashPath}`)
    return { applied: true }
  } catch (error) {
    // 注册失败要把已经生效的 restriction 撤回，避免留下「两个都看不见」的坏状态。
    try {
      releaseRestriction()
    } catch {
      // 忽略。
    }
    const message = error instanceof Error ? error.message : String(error)
    diag(`replace: failed agent=${agent.id}: ${message}`)
    return { applied: false, reason: message }
  }
}

/** 装配 Git Bash 工具的运行期依赖（全部走可选服务读取，缺失时在工具内部 fail loud）。 */
function buildRuntime(host: HostContextLike, bashPath: string): BashToolRuntime {
  const subprocess = readService<{ spawn: unknown }>(host, 'subprocess')
  const sandboxPolicy = readService<{ resolve: unknown }>(host, 'sandboxPolicy')
  const sandbox = readService<{ confine: unknown }>(host, 'sandbox')
  const jobs = readService<{ start: unknown }>(host, 'jobs')
  const shellEnv = readService<{ collect: unknown }>(host, 'shellEnv')
  const approval = readService<{ request: unknown }>(host, 'approval')
  const shell = readService<{ sandboxMode?: unknown }>(host, 'shell')
  if (subprocess === undefined || typeof subprocess.spawn !== 'function') {
    throw new Error('ctx.subprocess is not visible')
  }
  const sandboxMode =
    shell !== undefined && typeof shell.sandboxMode === 'string'
      ? (shell.sandboxMode as 'read-only' | 'workspace-write' | 'danger-full-access')
      : undefined
  return {
    bashPath,
    subprocess: subprocess as BashToolRuntime['subprocess'],
    ...(sandboxPolicy !== undefined && typeof sandboxPolicy.resolve === 'function'
      ? { sandboxPolicy: sandboxPolicy as NonNullable<BashToolRuntime['sandboxPolicy']> }
      : {}),
    ...(sandbox !== undefined && typeof sandbox.confine === 'function'
      ? { sandbox: sandbox as NonNullable<BashToolRuntime['sandbox']> }
      : {}),
    ...(jobs !== undefined && typeof jobs.start === 'function'
      ? { jobs: jobs as NonNullable<BashToolRuntime['jobs']> }
      : {}),
    ...(shellEnv !== undefined && typeof shellEnv.collect === 'function'
      ? { shellEnv: shellEnv as NonNullable<BashToolRuntime['shellEnv']> }
      : {}),
    ...(approval !== undefined && typeof approval.request === 'function'
      ? { approval: approval as NonNullable<BashToolRuntime['approval']> }
      : {}),
    ...(sandboxMode !== undefined ? { shellSandboxMode: sandboxMode } : {}),
  }
}

/** `registerReplacement` 的依赖。 */
export interface ReplaceListenerOptions {
  /** 宿主上下文。 */
  readonly host: HostContextLike
  /** 读取当前设置（每次会话启动读一次 —— 决策 B：只对新会话生效）。 */
  readonly settings: () => TerminalToolSettings
  /** 每次尝试后的回调（写诊断、更新状态）。 */
  readonly onAttempt: (attempt: ReplaceAttempt, agent: AgentLike) => void
  /** 幂等用的已处理集合（默认内部 WeakSet）。 */
  readonly seen?: WeakSet<object>
}

/**
 * 注册 `agent/session-start` 监听器。
 *
 * 根 context 上的监听器是**未带 scope 标签**的，按 `dsh-scope` 的投递规则会收到
 * 所有 agent 的事件（「untagged listeners globally」），所以一个插件实例就能覆盖
 * 这台机器上的每个会话（standard / ptc / cordis / 子代理）。
 * @param options - 监听器依赖。
 * @returns 解绑函数。
 */
export function registerReplacement(options: ReplaceListenerOptions): () => void {
  const seen = options.seen ?? new WeakSet<object>()
  const listener = (payload: unknown): void => {
    try {
      const agent = readAgent(payload)
      if (agent === null) return
      if (seen.has(agent as object)) return
      seen.add(agent as object)
      const attempt = replaceTerminalTool(options.host, agent, options.settings())
      options.onAttempt(attempt, agent)
    } catch (error) {
      // 绝不抛：通知型监听器抛出会影响会话启动路径。
      diag(`replace: listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  options.host.on('agent/session-start', listener)
  return () => {
    // WeakSet 无法清空；解绑后已处理的 agent 已释放，无需额外清理。
  }
}

/** 从 `agent/session-start` 载荷里取出 agent（结构窄化，不信任任何 import 类型）。 */
function readAgent(payload: unknown): AgentLike | null {
  if (typeof payload !== 'object' || payload === null) return null
  const agent = (payload as Record<string, unknown>).agent
  if (typeof agent !== 'object' || agent === null) return null
  const record = agent as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  const ctx = record.ctx
  if (typeof ctx !== 'object' || ctx === null) return null
  return agent as unknown as AgentLike
}
