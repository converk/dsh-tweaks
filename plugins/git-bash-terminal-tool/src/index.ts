/**
 * dsh-tweaks-git-bash-terminal-tool —— 宿主半区入口。
 *
 * 目标（设计文档 §5）：在 Windows 上把 DSH 的默认终端工具从 pwsh 换成 Git Bash，
 * 对所有 preset 统一生效，且**不修改 DSH 源码、不修改任何 preset 文件、不接管
 * host 的 `ctx.shell`**。
 *
 * 本文件只做装配，三块逻辑各自独立：
 * - `host/settings.ts` 登记 `terminal-tool` namespace（默认 pwsh + 校验）；
 * - `host/routes.ts` 开两条 `/api` 精确路由给设置行取数；
 * - `host/replace.ts` 在 `agent/session-start` 时按设置做 per-agent 替换。
 *
 * `inject` 故意保持为空（AGENTS.md §2.1：可选服务用 `ctx.get` + 判空），
 * 这样 headless 组合里也能挂上，服务缺失时只降级、不抛错。
 */
import { registerReplacement } from './host/replace.js'
import { registerRoutes } from './host/routes.js'
import { registerTerminalToolSettings, validateSettings, SETTINGS_DEFAULTS } from './host/settings.js'
import { diag } from './host/diag.js'
import type { CapabilityProbeInput, HostContextLike, SettingsProviderLike, TerminalToolSettings } from './host/types.js'
import type { ReplaceReport } from './shared/protocol.js'

/** 本插件没有硬依赖：所有服务都用 `ctx.get` 读，缺失时降级。 */
export const inject: string[] = []

/**
 * 供 Node 侧自测直接驱动纯逻辑（不经过 cordis 运行时）。
 *
 * 这里刻意只再导出 **纯逻辑**：发现算法、设置解析/校验、工具定义与渲染、
 * 升级契约、替换判定。自测（`scripts/selftest.mjs`）只 import `lib/index.js`，
 * 因此这份清单同时验证了「host bundle 可加载 + 零 @deepseek-ai 运行时依赖」。
 */
export { discoverBash, isBlockedBash, validateBashPath } from './host/discover.js'
export { validateSettings, resolveSettings, createSettingsSchema, SETTINGS_DEFAULTS } from './host/settings.js'
export {
  createBashTool,
  renderResult,
  renderProcessRead,
  parseExitStatus,
  parseBashArgs,
  composePath,
  bashOutputSchema,
} from './host/bash-tool.js'
export {
  ESCALATION_TARGETS,
  WIDER_MODES,
  approveEscalation,
  validateEscalationArgs,
  sandboxDenialMarker,
  escalationHintMarker,
} from './host/escalation.js'
export { probeCapability, replaceTerminalTool } from './host/replace.js'

/**
 * 能力探测（对应 `../shared/protocol.ts` 的 `CapabilityView`）。
 *
 * 判定「本部署是否具备替换的全部必要条件」：平台、`tools.restrict` / `tools.register`、
 * `systemPrompt.section`、`settings`。缺任何一项都不启用功能，只在设置行里说明原因。
 * @param input - 探测输入。
 * @returns capability 视图。
 */
export function probeDeploymentCapability(input: CapabilityProbeInput): {
  supported: boolean
  reason?: string | undefined
  shellSandboxMode?: string | undefined
} {
  const shellSandboxMode = input.shellSandboxMode
  const base = shellSandboxMode !== undefined ? { shellSandboxMode: String(shellSandboxMode) } : {}
  if (input.platform !== 'win32') {
    return { supported: false, reason: '仅 Windows 支持切换终端工具', ...base }
  }
  if (!input.hasTools) return { supported: false, reason: '当前 DSH 版本不提供 ctx.tools（无法隐藏 pwsh）', ...base }
  if (!input.hasSystemPrompt) {
    return { supported: false, reason: '当前 DSH 版本不提供 ctx.systemPrompt（无法压掉 pwsh 提示词）', ...base }
  }
  if (!input.hasSettings) return { supported: false, reason: '当前 DSH 版本不提供 ctx.settings（无法保存选择）', ...base }
  return { supported: true, ...base }
}

/**
 * 宿主插件体。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: HostContextLike): void {
  const state: {
    settings: TerminalToolSettings
    namespaceRegistered: boolean
    lastReplace?: ReplaceReport | undefined
    applied: boolean
    agents: number
  } = {
    settings: { ...SETTINGS_DEFAULTS, bashCandidates: [] },
    namespaceRegistered: false,
    applied: false,
    agents: 0,
  }

  diag(`apply: platform=${process.platform} pid=${String(process.pid)}`)

  // 1) 设置 namespace（可选服务：拿不到就只降级，不抛）。
  const settingsHandleHolder: { handle?: { get(): TerminalToolSettings; watch(cb: (next: TerminalToolSettings) => void): () => void } | undefined } = {}
  const attachSettings = (target: HostContextLike): void => {
    const settings = target.get('settings') as SettingsProviderLike | undefined
    if (settings === undefined || settings === null || typeof settings.register !== 'function') {
      diag('apply: ctx.settings is not visible')
      return
    }
    const handle = registerTerminalToolSettings(
      settings as Parameters<typeof registerTerminalToolSettings>[0],
      (message) => {
        diag(`settings: register failed: ${message}`)
        state.namespaceRegistered = false
      },
    )
    if (handle === undefined) return
    state.namespaceRegistered = true
    state.settings = handle.get()
    settingsHandleHolder.handle = handle
    handle.watch((next) => {
      // 只更新 host 侧快照；**运行中的会话不受影响**（决策 B）。
      state.settings = next
      diag(
        `settings: dialect=${next.dialect} bashPath="${next.bashPath}" candidates=${String(next.bashCandidates.length)}（新会话生效）`,
      )
    })
    // 启动时校验一次当前值：选择 bash 但路径无效 → 打一行诊断，便于排查。
    try {
      validateSettings(state.settings)
    } catch (error) {
      diag(`settings: current value is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    diag(`settings: registered ${state.settings.dialect} bashPath="${state.settings.bashPath}"`)
  }

  if (typeof ctx.inject === 'function') ctx.inject(['settings'], (scoped) => attachSettings(scoped))
  else attachSettings(ctx)

  // 2) 两条 `/api` 路由。
  registerRoutes(ctx, {
    readSettings: () => state.settings,
    capability: () =>
      probeDeploymentCapability({
        platform: process.platform,
        hasTools: hasService(ctx, 'tools'),
        hasSystemPrompt: hasService(ctx, 'systemPrompt'),
        hasSettings: state.namespaceRegistered,
        shellSandboxMode: readShellSandboxMode(ctx),
      }),
    namespaceRegistered: () => state.namespaceRegistered,
    lastReplace: () => state.lastReplace,
  })

  // 3) per-agent 替换（核心机制）。
  const settingsForSession = (): TerminalToolSettings => {
    const handle = settingsHandleHolder.handle
    if (handle !== undefined) return handle.get()
    return state.settings
  }
  registerReplacement({
    host: ctx,
    settings: settingsForSession,
    onAttempt: (attempt, agent) => {
      state.agents += 1
      state.lastReplace = {
        at: Date.now(),
        applied: attempt.applied,
        ...(attempt.reason !== undefined ? { reason: attempt.reason } : {}),
      }
      if (attempt.applied) state.applied = true
      else diag(`replace: skipped agent=${agent.id} reason=${attempt.reason ?? 'unknown'}`)
    },
  })
}

/** 读 `ctx.shell.sandboxMode`（只看，不接管）。 */
function readShellSandboxMode(ctx: HostContextLike): CapabilityProbeInput['shellSandboxMode'] {
  try {
    const shell = ctx.get('shell') as { sandboxMode?: unknown } | undefined
    const mode = shell?.sandboxMode
    if (mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access') return mode
    return undefined
  } catch {
    return undefined
  }
}

/** 某个服务是否可见（能力探测用）。 */
function hasService(ctx: HostContextLike, name: string): boolean {
  try {
    const value = ctx.get(name)
    return value !== undefined && value !== null
  } catch {
    return false
  }
}

