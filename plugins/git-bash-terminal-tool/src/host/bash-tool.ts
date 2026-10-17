/**
 * 自包含的 Git Bash 工具（工具名 `bash`，替换 preset 里的 `pwsh`）。
 *
 * 为什么不用官方 `dsh-tool-bash`：本插件零 `@deepseek-ai/*` 运行时依赖（设计文档 §2.8），
 * 而官方工具是「`ctx.shell` 的消费者」——`ctx.shell` 在 win32 上就是 pwsh，我们**不接管它**
 * （设计文档明确禁止）。所以这里按契约手写 `ToolDefinition`：
 *
 * - `parameters` 用**原始 JSON Schema**（`ToolSchema.parameters: Record<string, unknown>`，
 *   `register` 只对 `output.schema` 跑 `assertSupportedJsonSchema`，见 `dsh-tools/lib/index.js`）；
 *   形状与官方 `defineTool` 编译出来的 JSON Schema 一致。
 * - `output.schema` 与官方**同形**（`oneOf`: background / promoted / foreground，三个分支都带
 *   `cwd`），所以 UI 的 terminal 卡片与退出码 pill 表现一致；`render` 逐字复刻官方
 *   `renderResult`，`presentationMeta` 把实际执行目录写进 `tool/result.meta`。
 * - `execute` 自己实现子进程执行：`argv = [bashPath, '-c', command]`；受限模式走
 *   `ctx.sandbox.confine`（Windows 的 ACL 后端是 argv 前缀 runner，与 shell 无关），
 *   未受限（`danger-full-access`）完全不走 confine —— 与 `dsh-pwsh-sandbox` 的口径一致。
 * - 默认 cwd 取 `ctx.workingDirectory.ensure()`（DSH 0.2.1；模型用 `working_directory`
 *   工具 cd 之后必须跟随），老版本退回 `session.header.cwd`。
 * - 环境注入 `TERM=dumb` / `NO_COLOR=1` / `PAGER=cat` / `GIT_PAGER=cat`
 *   （与 `dsh-bash-local` 的 `ENV_OVERRIDES` 一致），并把 Git/Bash 自己的目录补进 `PATH`。
 */
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
} from './escalation.js'
import type {
  ApprovalServiceLike,
  CollectedOutputLike,
  ConfinedArgvLike,
  ContentBlockLike,
  JobOutcomeLike,
  RunnerFailureRuleLike,
  SandboxInfoLike,
  SandboxMode,
  SandboxPolicyLike,
  SandboxPolicyServiceLike,
  SandboxProviderLike,
  ShellEnvRegistryLike,
  SubprocessCollectLike,
  SubprocessOutputReaderLike,
  SubprocessRuntimeLike,
  ToolDefinitionLike,
  ToolResultLike,
  ToolRunContextLike,
  WorkingDirectoryServiceLike,
} from './types.js'

/** 前台/后台单流的内存保留上限（对齐 `dsh-bash-local` 的 `maxOutputBytes`）。 */
const MAX_OUTPUT_BYTES = 64 * 1024

/** 单流 spill 文件上限（对齐 `dsh-bash-local` 的 `maxSpillBytes`）。 */
const MAX_SPILL_BYTES = 64 * 1024 * 1024

/** SIGTERM→SIGKILL 宽限期（对齐 `dsh-bash-local` 的 `graceMs`）。 */
const GRACE_MS = 3000

/** 未显式给出 `timeoutMs` 时的默认值（对齐官方 `bash-local` 的配置默认）。 */
export const DEFAULT_TIMEOUT_MS = 120_000

/** 单次调用允许的最大超时（对齐官方 `bash-local` 的 `maxTimeoutMs`）。 */
export const MAX_TIMEOUT_MS = 600_000

/** 模型友好环境覆盖（与 `dsh-bash-local` 的 `ENV_OVERRIDES` 一致）。 */
export const ENV_OVERRIDES: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  TERM: 'dumb',
  PAGER: 'cat',
  GIT_PAGER: 'cat',
}

/**
 * Windows 专属的环境默认值（**只在环境里没有该变量时才设**，不覆盖用户自己的设置）。
 *
 * 起因是一个真机可复现的读回乱码：原生 Windows 程序把 stdio 按 **ANSI 代码页**
 * （中文机器上是 936/GBK）编码后写进管道，而 DSH 的采集端按 UTF-8 解码 →
 * `cmd /c ver`、`tasklist`、`python -c "print('中文')"` 全是 `�汾` 这样的乱码。
 *
 * 实测结论（详见 README「已知限制」）：
 * - `chcp 65001` **没有用**：它只改控制台代码页，而写管道用的是 `GetACP()`/`GetOEMCP()`；
 * - `cmd` / `powershell` 这类**插件改不了**（解码发生在 `dsh-subprocess-local`）；
 * - 但 **Python 可以从这里修**：`PYTHONIOENCODING=utf-8` 让 Python 直接吐 UTF-8，
 *   而 Python 是 Windows 上最常被模型调用的输出中文的程序之一。
 *
 * 只设 stdio 编码、**不**设 `PYTHONUTF8=1`：后者还会改 `open()` 与文件系统编码的默认值，
 * 对一个「执行用户命令」的工具来说改动面太大。
 */
export const WINDOWS_ENV_DEFAULTS: Readonly<Record<string, string>> = {
  PYTHONIOENCODING: 'utf-8',
}

/** 未受限执行（`danger-full-access`）时给结果盖的沙箱事实。 */
const UNCONFINED_INFO: SandboxInfoLike = { mode: 'danger-full-access', denied: false }

/** 模型可见的工具入参（窄化后）。 */
export interface BashToolArgs {
  readonly command: string
  readonly description: string
  readonly timeoutMs?: number | undefined
  readonly workdir?: string | undefined
  readonly run_in_background?: boolean | undefined
  readonly sandbox_permissions?: string | undefined
  readonly justification?: string | undefined
}

/** 前台规范值（与官方 `output.schema` 的 foreground 分支同形）。 */
export interface ForegroundValue {
  readonly kind: 'foreground'
  /** 命令实际执行的目录（DSH 0.2.1 起官方三个分支都带；终端卡片读它显示 cwd）。 */
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly aborted: boolean
  /** 被 `job_kill` 停掉时的原因（官方 0.2.x 新增；只有停过的运行才有）。 */
  readonly stopped?: string | undefined
  readonly timeoutMs: number
  readonly stdout: CollectedOutputLike
  readonly stderr: CollectedOutputLike
  readonly sandbox?: SandboxInfoLike | undefined
}

/** 后台规范值（与官方 `output.schema` 的 background 分支同形）。 */
export interface BackgroundValue {
  readonly kind: 'background'
  readonly jobId: string
  readonly cwd: string
}

/**
 * 「前台等超时 → 转后台」规范值（官方 0.2.x 的第三分支）。
 *
 * 官方 0.2.x 的前台调用**不再在超时时杀进程**：等满 `timeoutMs` 后命令继续跑，
 * 调用改交回 job id 与「到目前为止的输出」，之后由 `job_output` / `job_kill` 接管。
 * 这样长命令既不会白跑，也不会卡住工具调用。
 */
export interface PromotedValue {
  readonly kind: 'promoted'
  readonly jobId: string
  readonly cwd: string
  readonly timeoutMs: number
  readonly output: string
}

/** 工具的规范输出值。 */
export type BashToolValue = ForegroundValue | BackgroundValue | PromotedValue

/** 一个任务输出「拉取源」（`ctx.jobs.start` 的 `output` 字段）。 */
export interface BashJobSourceLike {
  readonly channel: string
  read(fromByte: number): { text: string; nextOffset: number; lossy: boolean }
}

/** 一次 `ctx.jobs.read()` 的结果（只取本插件用到的字段）。 */
export interface BashJobReadLike {
  readonly chunks: readonly { channel: string; text: string }[]
  readonly lossy: boolean
  readonly job?: { output?: { spillPaths?: readonly string[] | undefined } | undefined } | undefined
}

/** `ctx.jobs.wait()` 的返回视图（只取状态与说明）。 */
export interface BashJobViewLike {
  readonly status: string
  readonly detail?: string | undefined
}

/**
 * `ctx.jobs` 的最小面。
 *
 * ⚠️ `wait` / `read` / `kill` / `remove` 是 **0.2.x 才齐**的注册表 API，本插件用它们实现
 * 「前台超时 → 转后台（promote）」；这四个缺失时（更老的 DSH）插件**自动退回**「超时即杀」。
 * 所以它们全是可选的，判定走 {@link canPromote}。
 */
export interface BashJobsLike {
  start(spec: {
    kind: string
    label: string
    /** ⚠️ 必须是 **agent id（即 session id）字符串**，不是 agent 对象：注册表拿它去 `agents.get()` 找活着的 agent。 */
    owner?: string | undefined
    /**
     * 创建该任务的工具调用（DSH 0.2.1 新增，写入 `job/registered` / `job/settled`
     * 会话事件）。PTC 子调用的 `callId` 不是根调用，必须同时给 `rootCallId`。
     */
    toolCall?: { readonly callId: string; readonly rootCallId: string } | undefined
    /** 输出拉取源：注册表按它把 stdout/stderr 泵进任务的输出环，`job_output` 读的就是这个环。 */
    output?: readonly BashJobSourceLike[] | undefined
    run(): {
      cancel(reason?: string): void
      done: Promise<JobOutcomeLike>
    }
  }): string
  wait?(id: string, timeoutMs: number, owner?: string | undefined, signal?: AbortSignal | undefined): Promise<BashJobViewLike>
  read?(id: string, owner?: string | undefined): BashJobReadLike
  kill?(id: string, owner?: string | undefined, reason?: string | undefined): void
  remove?(id: string, owner?: string | undefined): void
}

/** 工具运行期依赖（由 `replace.ts` 在 agent 建立时装配）。 */
export interface BashToolRuntime {
  /** Git Bash 可执行文件的绝对路径。 */
  readonly bashPath: string
  /** `ctx.subprocess`（必需）。 */
  readonly subprocess: SubprocessRuntimeLike
  /** `ctx.sandboxPolicy`（advertise 沙箱升级后必需）。 */
  readonly sandboxPolicy?: SandboxPolicyServiceLike | undefined
  /** `ctx.sandbox`（受限模式必需；`confine` 是 async，见 `types.ts`）。 */
  readonly sandbox?: SandboxProviderLike | undefined
  /** `ctx.jobs`（`run_in_background` 时必需）。 */
  readonly jobs?: BashJobsLike | undefined
  /**
   * `ctx.workingDirectory`（DSH 0.2.1 新增；老版本没有，退回 `session.header.cwd`）。
   *
   * ⚠️ `session.header.cwd` 是**不可变的原始项目目录**。模型用 `working_directory`
   * 工具 `cd` 之后，真正生效的是该服务里的 projection —— 不看它，命令会继续跑在旧目录。
   */
  readonly workingDirectory?: WorkingDirectoryServiceLike | undefined
  /** `ctx.shellEnv`（可选：拿得到就注入受管 `DSH_*`）。 */
  readonly shellEnv?: ShellEnvRegistryLike | undefined
  /** `ctx.approval`（沙箱升级时必需）。 */
  readonly approval?: ApprovalServiceLike | undefined
  /** `ctx.shell.sandboxMode`：定义了才 advertise 升级字段（对齐官方判据）。 */
  readonly shellSandboxMode?: SandboxMode | undefined
  /** 非致命告警的去处（例如「任务登记被拒 → 降级为前台硬超时」）；不传则静默。 */
  readonly warn?: ((message: string) => void) | undefined
}

/** 把一条已收集输出渲染成文本（含截断提示）。 */
function streamText(output: CollectedOutputLike): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/**
 * 把一次前台运行渲染成模型可见文本（**逐字**复刻官方 `renderResult`）。
 * @param result - 已完成的前台运行。
 * @param escalationModes - 本部署 advertise 的升级目标；非空时在拒绝标记后追加升级提示。
 * @returns 模型可见文本。
 */
export function renderResult(result: ForegroundValue, escalationModes: readonly SandboxMode[] = []): string {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'
  const markers: string[] = []
  if (result.sandbox?.denied === true) {
    markers.push(sandboxDenialMarker(result.sandbox.mode))
    if (escalationModes.length > 0) markers.push(escalationHintMarker('command'))
  }
  if (result.timedOut) markers.push(`[timed out after ${String(result.timeoutMs)}ms]`)
  if (result.stopped !== undefined) markers.push(`[stopped: ${result.stopped}]`)
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== 0) markers.push(`[exit code: ${String(result.exitCode ?? 0)}]`)
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/**
 * 把沙箱事实渲染成提示行（**逐字**复刻官方 `sandboxNotes`）。
 * @param sandbox - 沙箱事实。
 * @param escalationModes - advertise 的升级目标。
 * @returns 提示行数组（可能为空）。
 */
export function sandboxNotes(sandbox: SandboxInfoLike | undefined, escalationModes: readonly SandboxMode[] = []): string[] {
  if (sandbox?.runnerFailed === true) {
    return [
      `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`,
    ]
  }
  if (sandbox?.denied === true) {
    const notes = [sandboxDenialMarker(sandbox.mode)]
    if (escalationModes.length > 0) notes.push(escalationHintMarker('command'))
    return notes
  }
  return []
}

/**
 * 把已结束的后台进程映射到通用任务终态（**逐字**复刻官方 `processOutcome`，含沙箱注记）。
 *
 * 沙箱事实会被拼进 `detail`：任务的终态说明是模型状态行与任务列表唯一显示的那一行。
 * @param proc - 已结束的进程。
 * @param escalationModes - advertise 的升级目标。
 * @returns 交给 `ctx.jobs` 注册的结果。
 */
export function processOutcome(
  proc: {
    status: 'running' | 'completed' | 'killed'
    exitCode: number | null
    signal: string | null
    sandbox?: SandboxInfoLike | undefined
  },
  escalationModes: readonly SandboxMode[] = [],
): JobOutcomeLike {
  const base: JobOutcomeLike =
    proc.status === 'killed'
      ? { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
      : { status: 'completed', detail: `exit code: ${String(proc.exitCode ?? 0)}` }
  const notes = sandboxNotes(proc.sandbox, escalationModes)
  if (notes.length === 0) return base
  return { ...base, detail: `${base.detail}; ${notes.join(' ')}` }
}

/**
 * 把「转后台」结果渲染成模型可见文本（**逐字**复刻官方 `renderPromoted`）。
 * @param promoted - 转后台的值。
 * @returns 模型可见文本。
 */
export function renderPromoted(promoted: { output: string; timeoutMs: number; jobId: string }): string {
  const head = promoted.output.length > 0 ? (promoted.output.endsWith('\n') ? promoted.output : `${promoted.output}\n`) : ''
  return `${head}[still running after ${String(promoted.timeoutMs)}ms; moved to background job ${promoted.jobId}]\nThe command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.`
}

/**
 * 把一次消费式注册表读取的环块渲染成增量文本（**逐字**复刻官方 `ringDelta`）。
 *
 * stdout 按序在前，stderr 合成一个 `[stderr]` 段在后 —— 这样「前台等超时交回的输出」
 * 与之后 `job_output` 的读法完全一致。
 * @param chunks - 自模型游标以来的环块。
 * @returns 增量文本（可能为空）。
 */
export function ringDelta(chunks: readonly { channel: string; text: string }[]): string {
  const out = chunks
    .filter((chunk) => chunk.channel !== 'stderr')
    .map((chunk) => chunk.text)
    .join('')
  const err = chunks
    .filter((chunk) => chunk.channel === 'stderr')
    .map((chunk) => chunk.text)
    .join('')
  const separator = out.length > 0 && !out.endsWith('\n') ? '\n' : ''
  return out + (err.length > 0 ? `${separator}[stderr]\n${err}` : '')
}

/**
 * 渲染一次环读取（**逐字**复刻官方 `renderJobRead`）。
 * @param delta - 已渲染的增量文本。
 * @param lossy - 游标之前的字节是否已被挤出内存。
 * @param spillPaths - 任务当前公布的完整输出文件。
 * @param sandbox - 已确定的沙箱事实。
 * @param escalationModes - advertise 的升级目标。
 * @returns 追加了丢失/沙箱提示的增量文本。
 */
export function renderJobRead(
  delta: string,
  lossy: boolean,
  spillPaths: readonly string[],
  sandbox?: SandboxInfoLike | undefined,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const notices: string[] = []
  if (lossy) {
    notices.push(
      `[some output was dropped from memory; full output: ${spillPaths.length > 0 ? spillPaths.join(', ') : '(unavailable)'}]`,
    )
  }
  notices.push(...sandboxNotes(sandbox, escalationModes))
  if (notices.length === 0) return delta
  const separator = delta.length > 0 && !delta.endsWith('\n') ? '\n' : ''
  return `${delta}${separator}${notices.join('\n')}`
}

/**
 * 从渲染文本里拆出退出状态（对齐 `dsh-shell` 的 `parseExitStatus`）。
 * @param text - 已渲染的模型可见文本。
 * @returns 去掉标记的 body 与结构化的退出状态。
 */
export function parseExitStatus(text: string): { body: string } & ({ exitCode: number } | { signal: string }) {
  const exitMatch = /\n?\[exit code: (-?\d+)\]$/.exec(text)
  if (exitMatch !== null) return { body: text.slice(0, exitMatch.index), exitCode: Number(exitMatch[1]) }
  const signalMatch = /\n?\[killed by signal: ([A-Za-z0-9]+)\]$/.exec(text)
  if (signalMatch !== null) return { body: text.slice(0, signalMatch.index), signal: signalMatch[1] ?? '' }
  return { body: text, exitCode: 0 }
}

/**
 * 解析并校验模型给的参数（口径对齐官方 `validateBashArgs`）。
 * @param args - 原始参数。
 * @param escalationAdvertised - 本部署是否 advertise 了升级字段。
 * @returns 窄化后的参数。
 * @throws 参数非法时的逐字对齐文案。
 */
export function parseBashArgs(args: unknown, escalationAdvertised: boolean): BashToolArgs {
  const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
  const command = record.command
  const description = record.description
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  const timeoutMs = record.timeoutMs
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(timeoutMs)}`)
  }
  const workdir = record.workdir
  if (workdir !== undefined && typeof workdir !== 'string') throw new Error('invalid workdir: expected a string')
  const runInBackground = record.run_in_background
  if (runInBackground !== undefined && typeof runInBackground !== 'boolean') {
    throw new Error('invalid run_in_background: expected a boolean')
  }
  const sandboxPermissions = record.sandbox_permissions
  const justification = record.justification
  if (sandboxPermissions !== undefined && typeof sandboxPermissions !== 'string') {
    throw new Error('invalid sandbox_permissions: expected a string')
  }
  if (justification !== undefined && typeof justification !== 'string') {
    throw new Error('invalid justification: expected a string')
  }
  validateEscalationArgs(sandboxPermissions, justification)
  if (sandboxPermissions !== undefined && !escalationAdvertised) {
    throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
  }
  return {
    command,
    description,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(workdir !== undefined ? { workdir } : {}),
    ...(runInBackground !== undefined ? { run_in_background: runInBackground } : {}),
    ...(sandboxPermissions !== undefined ? { sandbox_permissions: sandboxPermissions } : {}),
    ...(justification !== undefined ? { justification } : {}),
  }
}

/**
 * 构造工具描述文本（口径与官方 `bashDescription` 一致，但明确是 Git Bash 方言）。
 * @param escalationModes - advertise 的升级目标。
 * @param workingDirectory - 本部署是否有会变的「会话当前目录」（0.2.1+）。
 * @returns 模型可见的工具描述。
 */
export function bashDescription(escalationModes: readonly SandboxMode[], workingDirectory = false): string {
  const base =
    'Execute a command in Git Bash (`bash -c` on Windows) and return its stdout/stderr. ' +
    'The shell is POSIX: use forward slashes and `$VAR`; a Windows path such as C:/work is accepted as-is, and /c/work reaches the same place when a POSIX spelling is required. ' +
    'Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. ' +
    (workingDirectory ? 'The session current working directory (see the `working_directory` tool) is the default for every call. ' : '') +
    'Non-zero exits are reported as `[exit code: N]`. Current harness environment facts are exposed through managed `$DSH_*` variables; inspect them when needed. ' +
    'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. ' +
    'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. ' +
    'Provide `description` before `command` in the arguments. ' +
    'Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'
  if (escalationModes.length === 0) return base
  return (
    base +
    ' Attempting a command the sandbox may deny is safe and expected: run it and read the marker rather than assuming the denial. ' +
    'When a command is denied and a wider mode would let it succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: ' +
    'retry the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) plus a one-sentence `justification`. ' +
    'Do not detour through chat to ask permission first — the approval prompt raised by that retry is how the user consents. ' +
    'If the session states approval prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. ' +
    'Never escalate speculatively: ground the request in a real denial — normally the one this command just hit; escalating up front is fine only when this session already denied the same access. ' +
    'A rejected escalation is final for that command — stop and explain, never work around it — but it does not forbid attempting or escalating other commands later.'
  )
}

/**
 * 原始 JSON Schema：模型可见的参数。
 *
 * ⚠️ 形状必须与官方 `defineTool` **编译后**的结果一致（`dsh-tool-bash` 用的是 DSL，
 * 源码里的 `required: true` 是 DSL 语法，编译后会**提升到父对象的 `required` 数组**）。
 * 权威形状由部署里的 `defineTool` 实测得到（见 `scripts/selftest.mjs` 的 schema 校验）：
 *
 * - 根是 `{ type:'object', properties, required:[...] }`（**没有** `additionalProperties`）；
 * - 叶子节点只放 `type` / `enum` / `description`，**不带** `required`。
 *
 * 为什么必须这样：官方子集校验器（`dsh-tools` 的 `checkSchemaNode`）规定
 * `required` 只能出现在 `type:"object"` 节点上且必须是**字符串数组**，
 * 写在字符串/布尔叶子上会直接被判为不合规（真机上栽过一次）。
 * @param escalationModes - advertise 的升级目标（空表示不暴露升级字段）。
 * @param promote - 本部署是否支持「前台超时转后台」（决定 `timeoutMs` 的措辞，与官方一致）。
 * @returns 参数 JSON Schema。
 */
export function bashParameters(
  escalationModes: readonly SandboxMode[],
  promote = false,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    description: {
      type: 'string',
      description:
        'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; "git status" → "Show working tree status"; "npm install" → "Install package dependencies".',
    },
    command: { type: 'string', description: 'The bash command to execute.' },
    timeoutMs: {
      type: 'number',
      description: promote
        ? 'Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.'
        : 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
    },
    workdir: {
      type: 'string',
      description:
        'Working directory for this command. Defaults to the session current working directory; a relative path is resolved against it.',
    },
  }
  properties.run_in_background = {
    type: 'boolean',
    description:
      'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.',
  }
  if (escalationModes.length > 0) {
    properties.sandbox_permissions = {
      type: 'string',
      enum: [...escalationModes],
      description:
        'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.',
    }
    properties.justification = {
      type: 'string',
      description:
        'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.',
    }
  }
  return { type: 'object', properties, required: ['command', 'description'] }
}

/**
 * 规范输出 schema：与官方**同形**（UI 的 terminal 卡片/退出码 pill 依赖它）。
 *
 * 与 `bashParameters` 同样的纪律：`required` 一律是**对象节点上的字符串数组**，
 * 叶子节点不带 `required`；`oneOf` 节点不能与 `properties`/`required`/
 * `additionalProperties` 并列（官方子集校验器的 `ONE_OF_SIBLING_KEYWORDS`）。
 * 形状由部署里 DSH 0.2.1 的 `defineTool` 编译结果实测得到，并由
 * `assertSupportedJsonSchema` 验证通过。
 *
 * 三个分支：`background`（一开始就声明后台）/ **`promoted`**（前台等超时后转后台，
 * 官方 0.2.x 新增）/ `foreground`（等到了终态，可能带 `stopped`）。
 *
 * ⚠️ DSH 0.2.1 起三个分支都**必须**带 `cwd`（官方 `presentationMeta` 把它写进
 * `tool/result.meta`，终端卡片据此显示实际执行目录；会话 `cd` 之后尤其重要）。
 * @returns `oneOf`（background / promoted / foreground）的 JSON Schema。
 */
export function bashOutputSchema(): Record<string, unknown> {
  const stream = (): Record<string, unknown> => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string' },
      truncated: { type: 'boolean' },
      spillPath: { type: 'string' },
    },
    required: ['text', 'truncated'],
  })
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'background' },
          jobId: { type: 'string' },
          cwd: { type: 'string' },
        },
        required: ['kind', 'jobId', 'cwd'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'promoted' },
          jobId: { type: 'string' },
          cwd: { type: 'string' },
          timeoutMs: { type: 'number' },
          output: { type: 'string' },
        },
        required: ['kind', 'jobId', 'cwd', 'timeoutMs', 'output'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'foreground' },
          cwd: { type: 'string' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean' },
          aborted: { type: 'boolean' },
          stopped: { type: 'string' },
          timeoutMs: { type: 'number' },
          stdout: stream(),
          stderr: stream(),
          sandbox: {
            type: 'object',
            additionalProperties: false,
            properties: {
              mode: { type: 'string' },
              denied: { type: 'boolean' },
              enforcement: { type: 'string' },
              runnerFailed: { type: 'boolean' },
            },
            required: ['mode', 'denied'],
          },
        },
        required: ['kind', 'cwd', 'exitCode', 'signal', 'timedOut', 'aborted', 'timeoutMs', 'stdout', 'stderr'],
      },
    ],
  }
}

/** 把绝对路径规范化（`realpathSync.native` 等价于官方的 `canonicalPath`）。 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/**
 * 解析本次命令的工作目录（对齐 DSH 0.2.1 官方的 `resolveWorkdir`）。
 *
 * `sessionCwd` 来自 `ctx.workingDirectory.ensure()`（0.2.1）或更低版本不可变的
 * `session.header.cwd`。`policyWorkspaceRoot` 只在没有会话 cwd 的老版本里兜底 ——
 * 0.2.1 的沙箱 workspace root 仍是**原始项目**，不能拿它覆盖用户用
 * `working_directory` 切过去的目录。
 * @param modelWorkdir - 模型给的 `workdir`。
 * @param sessionCwd - 会话当前工作目录（已由调用方决定是否 canonical 化）。
 * @param policyWorkspaceRoot - 旧部署的兜底 workspace root（可省略）。
 * @returns 最终 cwd，或 undefined（交给执行器默认 `process.cwd()`）。
 */
export function resolveWorkdir(
  modelWorkdir: string | undefined,
  sessionCwd: string | undefined,
  policyWorkspaceRoot?: string | undefined,
): string | undefined {
  const base = sessionCwd ?? policyWorkspaceRoot
  if (modelWorkdir === undefined) return base
  if (base !== undefined && !isAbsolute(modelWorkdir)) return resolve(base, modelWorkdir)
  return modelWorkdir
}

/** 判断失败运行是否匹配所选后端的拒绝方言（对齐官方 `matchesSignature`）。 */
function matchesDenial(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null || exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some((signature) => lowered.includes(signature.toLowerCase()))
}

/** 判断失败运行是否命中 runner 自身的失败证据（对齐官方 `classifyRunnerFailure`）。 */
function classifyRunnerFailure(
  exitCode: number | null,
  stderr: string,
  rules: readonly RunnerFailureRuleLike[],
): string | undefined {
  if (exitCode === null || exitCode === 0) return undefined
  const lines = stderr.split(/\r?\n/)
  for (const rule of rules) {
    if (rule.allowedExitCodes !== undefined && !rule.allowedExitCodes.includes(exitCode)) continue
    const informational = new Set((rule.informationalLines ?? []).map((line) => line.toLowerCase()))
    const fatal = rule.fatalSignatures
      .filter((signature) => signature.trim().length > 0)
      .map((signature) => signature.toLowerCase())
    for (const line of lines) {
      const lowered = line.toLowerCase()
      if (informational.has(lowered)) continue
      if (fatal.some((signature) => lowered.includes(signature))) return line
    }
  }
  return undefined
}

/** 中止原因（模型可见的失败）：`code` 对齐官方 `TOOL_ABORTED`，`name` 对齐 `AbortError`。 */
function abortError(): Error {
  const error = new Error('tool call aborted')
  error.name = 'AbortError'
  Object.assign(error, { code: 'ABORTED' })
  return error
}

/** 背景/前台共用的 collector 配置（有界收集 + spill）。 */
function collect(maxBytes: number): SubprocessCollectLike {
  return { maxBytes, spill: { maxBytes: MAX_SPILL_BYTES } }
}

/** 把一个 collect reader 投影成最终输出（对齐 `dsh-bash-local` 的 `finalOutput`）。 */
function finalOutput(reader: SubprocessOutputReaderLike): CollectedOutputLike {
  const read = reader.readFrom(0)
  return {
    text: read.text,
    truncated: read.lossy,
    ...(read.spillPath !== undefined ? { spillPath: read.spillPath } : {}),
  }
}

/**
 * PATH 条目比较用的归一化键：统一分隔符、抹掉末尾分隔符、忽略大小写。
 *
 * Windows 上同一个目录会有多种拼法（`C:\a\b` 与 `C:/a/b`，`Path` 与 `PATH`），
 * 不归一化就会出现「同一目录在 PATH 里出现两次」。
 * @param value - 原始路径或 PATH 片段。
 * @returns 比较用的键。
 */
export function pathKey(value: string): string {
  return value.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 从 `bash.exe` 的路径反推 Git for Windows / MSYS2 的**安装根目录**。
 *
 * ⚠️ 这里踩过一个真实的坑：早先的实现一律 `resolve(dir, '..', '..')`，即假设
 * `bash.exe` 在 `<root>/bin/bash.exe`。但 Git for Windows 有**两个** bash：
 *
 * - `<root>\bin\bash.exe`（29 KB 的启动器，负责摆好 MSYSTEM 与 PATH 再 exec）
 * - `<root>\usr\bin\bash.exe`（真正的 MSYS2 bash，`bin\bash.exe` 最终 exec 的就是它）
 *
 * 于是当用户选的是 `…\Git\bin\bash.exe` 时，`..\..` 会越过安装根落到
 * **`C:\Program Files`**，凭空往 PATH 里塞进 `C:\Program Files\bin`、
 * `C:\Program Files\usr\bin`、`C:\Program Files\mingw64\bin` 这些**不存在**的目录
 * （实测：每条命令的 PATH 里都会出现 4 个垃圾条目，且真正有用的 `…\Git\usr\bin` 反而没被补上）。
 *
 * 规则：往上走一层；若那一层叫 `usr`（即 `<root>/usr/bin/bash.exe`）再多走一层。
 * @param bashPath - bash 可执行文件绝对路径。
 * @returns 安装根目录的绝对路径。
 */
export function bashInstallRoot(bashPath: string): string {
  const dir = dirname(bashPath)
  const parent = dirname(dir)
  return basename(parent).toLowerCase() === 'usr' ? dirname(parent) : parent
}

/**
 * Git/Bash 自己所在的相关目录（用来补 `PATH`，确保 `bash` 与 `git` 可用）。
 *
 * 两条纪律（都是实测逼出来的）：
 * 1. **只收真实存在的目录**——Git for Windows 与 MSYS2 的子环境布局不同
 *    （`ucrt64` / `mingw64` / `clang64` 三选一，老版本还有 `mingw32`），盲加会产生垃圾条目；
 * 2. **`<root>/bin` 与 `<root>/usr/bin` 都要在**：前者是启动器所在（保证 `bash` 可再调用自己），
 *    后者才有 `git.exe` 之外的 POSIX 工具；`<root>/cmd` 提供 `git.exe` 的 Windows 入口。
 * @param bashPath - bash 可执行文件绝对路径。
 * @param exists - 存在性判定（默认 `existsSync`，自测可注入）。
 * @returns 目录列表（顺序即优先级）。
 */
export function bashPathEntries(bashPath: string, exists: (path: string) => boolean = existsSync): string[] {
  const root = bashInstallRoot(bashPath)
  const entries: string[] = []
  // 去重必须按**归一化后的键**：`dirname(bashPath)` 可能是 `C:/…/Git/bin`（正斜杠），
  // 而 `resolve(root, 'bin')` 是 `C:\…\Git\bin`（反斜杠）—— 同一个目录、两种拼法，
  // 按原字符串去重会把它算成两个条目。
  const seen = new Set<string>()
  // 子环境目录按 MSYS2 的约定顺序探测；哪个存在就用哪个（UCRT64 是当前 Git for Windows 的默认）。
  for (const candidate of [
    dirname(bashPath),
    resolve(root, 'usr', 'bin'),
    resolve(root, 'ucrt64', 'bin'),
    resolve(root, 'mingw64', 'bin'),
    resolve(root, 'clang64', 'bin'),
    resolve(root, 'mingw32', 'bin'),
    resolve(root, 'bin'),
    resolve(root, 'cmd'),
  ]) {
    if (!exists(candidate)) continue
    const key = pathKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(candidate)
  }
  return entries
}

/**
 * 拼接子进程的 `PATH`（Git/Bash 目录在前，环境里原有的 PATH 在后，`;` 分隔）。
 *
 * 补进来的目录会与原有 PATH **去重**：Git for Windows 的用户 PATH 里通常已经有一份
 * `…\Git\cmd` 或 `…\Git\ucrt64\bin`，不去重就会让同一目录在 PATH 里出现两次
 * （实测原来有 `/ucrt64/bin` 重复项）。比较时用 `path.win32` 的大小写不敏感口径，
 * 并抹掉末尾分隔符。
 * @param bashPath - bash 可执行文件绝对路径。
 * @param ambientPath - 环境里原有的 PATH。
 * @param exists - 存在性判定（透传给 {@link bashPathEntries}）。
 * @returns 新的 PATH 字符串。
 */
export function composePath(
  bashPath: string,
  ambientPath: string | undefined,
  exists: (path: string) => boolean = existsSync,
): string {
  const entries = bashPathEntries(bashPath, exists)
  // 归一化要同时抹掉**分隔符差异**与大小写：`resolve()` 产出的是 `C:\Program Files\Git\cmd`，
  // 而环境 PATH 里常见的是 `C:/Program Files/Git/cmd` —— 不归一化就会判成两条不同的目录。
  const normalize = pathKey
  const taken = new Set(entries.map(normalize))
  const ambient: string[] = []
  for (const raw of (ambientPath ?? '').split(';')) {
    const entry = raw.trim()
    if (entry.length === 0) continue
    const key = normalize(entry)
    if (taken.has(key)) continue
    taken.add(key)
    ambient.push(entry)
  }
  return [...entries, ...ambient].join(';')
}

/**
 * 构造交给子进程的环境（PATH 前置 + `ENV_OVERRIDES` + 受管 `DSH_*`）。
 * @param runtime - 运行期依赖。
 * @param exec - 本次执行。
 * @returns 显式环境覆盖。
 */
export function composeEnv(runtime: BashToolRuntime, exec: ToolRunContextLike): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  env.PATH = composePath(runtime.bashPath, process.env.PATH)
  for (const [key, value] of Object.entries(ENV_OVERRIDES)) env[key] = value
  // Windows 专属默认：**只在环境里没有该变量时**才设，绝不覆盖用户自己的选择。
  for (const [key, value] of Object.entries(WINDOWS_ENV_DEFAULTS)) {
    if (process.env[key] === undefined) env[key] = value
  }
  try {
    // 官方 collect 接收完整 ToolExecution（会读 agent 以及将来的字段）；
    // 本插件的 exec 投影是它的结构子集，直接透传比只给 { agent } 更稳。
    const collected = runtime.shellEnv?.collect(exec) ?? undefined
    if (collected !== undefined) for (const [key, value] of Object.entries(collected)) env[key] = value
  } catch {
    // shellEnv 失败不影响命令执行。
  }
  return env
}

/** 一次调用里解析出来的执行上下文（策略、cwd、超时）。 */
interface ResolvedCall {
  readonly args: BashToolArgs
  readonly policy: SandboxPolicyLike | undefined
  readonly workdir: string
  readonly timeoutMs: number
  readonly env: NodeJS.ProcessEnv
}

/**
 * 创建自包含的 Git Bash 工具定义。
 * @param runtime - 运行期依赖（由 `replace.ts` 装配）。
 * @returns 可直接交给 `agent.ctx.tools.register` 的工具定义。
 */
export function createBashTool(runtime: BashToolRuntime): ToolDefinitionLike {
  const escalationModes: readonly SandboxMode[] = runtime.shellSandboxMode === undefined ? [] : ESCALATION_TARGETS
  /**
   * 本部署能否「前台超时 → 转后台」（官方 0.2.x 的 `promoteOnTimeout`）。
   *
   * 需要注册表齐 `wait` / `read` / `kill` / `remove` 四个方法（0.2.x 才齐）。缺任何一个就
   * **自动退回**「超时即杀」——所以插件在更老的 DSH 上仍然可用，只是长命令会被杀掉。
   */
  const jobs = runtime.jobs
  const promote =
    jobs !== undefined &&
    typeof jobs.wait === 'function' &&
    typeof jobs.read === 'function' &&
    typeof jobs.kill === 'function' &&
    typeof jobs.remove === 'function'

  /** 解析一次调用的生效策略（advertise 了升级就必须有 sandboxPolicy，fail loud）。 */
  const resolvePolicy = (exec: ToolRunContextLike): SandboxPolicyLike | undefined => {
    if (escalationModes.length === 0) return undefined
    const service = runtime.sandboxPolicy
    if (service === undefined) throw new Error('bash: the mounted executor confines but ctx.sandboxPolicy is missing')
    return service.resolve(exec.agent !== undefined ? { session: exec.agent.session as object } : {})
  }

  /**
   * 受限模式：把 argv 交给 `ctx.sandbox.confine`；未受限则原样执行。
   *
   * ⚠️ `confine` 是 **async**，必须 await，否则拿到 Promise（`argv` 与 `runnerFailureRules` 全是 undefined）。
   */
  const confineArgv = async (
    argv: readonly string[],
    policy: SandboxPolicyLike | undefined,
  ): Promise<{ argv: readonly string[]; confined?: ConfinedArgvLike | undefined }> => {
    if (policy === undefined || policy.mode === 'danger-full-access') return { argv }
    const provider = runtime.sandbox
    if (provider === undefined) throw new Error('bash: this call is confined but ctx.sandbox is missing')
    const confined = await provider.confine(argv, {
      mode: policy.mode,
      workspaceRoot: policy.workspaceRoot,
      ...(policy.sessionId !== undefined ? { sessionId: policy.sessionId } : {}),
    })
    return { argv: confined.argv, confined }
  }

  /** 是否要按模型要求升级（有序 fail-closed 序列在 `approveEscalation` 里）。 */
  const approveIfAsked = async (
    args: BashToolArgs,
    exec: ToolRunContextLike,
    standing: SandboxPolicyLike | undefined,
  ): Promise<SandboxMode | undefined> => {
    if (args.sandbox_permissions === undefined) return undefined
    if (standing === undefined) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
    }
    return approveEscalation(
      {
        requestedMode: args.sandbox_permissions,
        justification: args.justification ?? '',
        effectiveMode: standing.mode,
        subject: 'command',
      },
      {
        approver: runtime.approval,
        agent: exec.agent,
        callId: exec.callId,
        toolName: 'bash',
        signal: exec.signal,
      },
    )
  }

  /** 解析本次调用的策略 / cwd / 超时 / 环境。 */
  const prepare = async (rawArgs: unknown, exec: ToolRunContextLike): Promise<ResolvedCall> => {
    const args = parseBashArgs(rawArgs, escalationModes.length > 0)
    const standing = resolvePolicy(exec)
    const approvedMode = await approveIfAsked(args, exec, standing)
    const policy: SandboxPolicyLike | undefined =
      standing === undefined
        ? undefined
        : approvedMode === undefined
          ? standing
          : { ...standing, mode: approvedMode }
    /**
     * 会话当前目录：DSH 0.2.1 起以 `ctx.workingDirectory` 的 projection 为准
     * （`session.header.cwd` 只是不可变的原始项目目录，模型 `cd` 后不会变）。
     * 老版本没有这个服务，退回 header cwd；两者都没有才用策略的 workspace root。
     */
    const projectedCwd =
      runtime.workingDirectory !== undefined && exec.agent !== undefined
        ? await runtime.workingDirectory.ensure(exec.agent as object, exec.signal)
        : undefined
    const headerCwd = exec.agent?.session?.header?.cwd
    const legacyCwd = projectedCwd === undefined && headerCwd !== undefined ? canonicalPath(headerCwd) : undefined
    const workdir =
      projectedCwd !== undefined
        ? (resolveWorkdir(args.workdir, projectedCwd) ?? process.cwd())
        : (resolveWorkdir(args.workdir, legacyCwd, policy?.workspaceRoot) ?? process.cwd())
    const timeoutMs = Math.min(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    return { args, policy, workdir, timeoutMs, env: composeEnv(runtime, exec) }
  }

  /** 一次已 spawn 的运行：两路流的读取器 + 结算后的规范值。 */
  interface RunningProcess {
    /** 两路 collect 读取器（`readFrom(offset)` 是非消费式读，可重复调）。 */
    readonly observed: { readonly stdout: SubprocessOutputReaderLike; readonly stderr: SubprocessOutputReaderLike }
    /** 结算完成（从不 reject）。 */
    readonly done: Promise<void>
    /** spawn 前就失败时的说明（官方口径），否则 undefined。 */
    failureNote(): string | undefined
    /** 已确定的沙箱事实（未结算时为 undefined）。 */
    sandbox(): SandboxInfoLike | undefined
    /** 结算后的任务终态（`ctx.jobs` 的 `done`）。 */
    jobOutcome(): JobOutcomeLike
    /** 结算后的规范前台值（必须在 `done` 之后调用）。 */
    result(flags: { timeoutMs: number; timedOut: boolean; aborted: boolean }): ForegroundValue
    /** 终止进程树（Windows 上由 `ctx.subprocess` 走 Job Object / `taskkill /T /F`）。 */
    kill(): void
  }

  /** 已登记进 `ctx.jobs` 的运行。 */
  interface AttachedJob {
    readonly jobId: string
    /** spawn 之后的进程（「准备阶段就超时」靠它判定，与官方同口径）。 */
    process(): RunningProcess | undefined
    /** 被停掉时的原因（`registry.kill(id, owner, reason)` 记下来的）。 */
    stopped(): string | undefined
  }

  /** 空输出流。 */
  const emptyStream = (): CollectedOutputLike => ({ text: '', truncated: false })

  /**
   * `spawn` 一次运行并包成 {@link RunningProcess}。
   *
   * ⚠️ 必须**同步**调用：`ctx.jobs.start` 的 `run()` 要求同步交回 hooks。受限 argv 由调用方
   * 提前 `await confineArgv` 好再传进来（`confine` 是 async，不能在这里等）。
   * @param argv - 已受限（或未受限）的完整 argv。
   * @param call - 本次调用的解析结果（cwd / 环境 / 策略）。
   * @param confined - `confine` 的产物；未受限时 undefined。
   * @param signal - 本次运行的取消信号。
   * @returns 运行句柄。
   */
  const launch = (
    argv: readonly string[],
    call: ResolvedCall,
    confined: ConfinedArgvLike | undefined,
    signal: AbortSignal,
  ): RunningProcess => {
    const handle = runtime.subprocess.spawn({
      argv,
      cwd: call.workdir,
      stdio: { stdin: 'ignore', stdout: collect(MAX_OUTPUT_BYTES), stderr: collect(MAX_OUTPUT_BYTES) },
      graceMs: GRACE_MS,
      signal,
      env: call.env,
    })
    const stdout = handle.collected.stdout
    const stderr = handle.collected.stderr
    if (stdout === undefined || stderr === undefined) {
      throw new Error('bash: subprocess implementation dropped a requested collect stream')
    }
    const proc = {
      status: 'running' as 'running' | 'completed' | 'killed',
      exitCode: null as number | null,
      signal: null as string | null,
      runnerFailed: false,
    }
    let note: string | undefined
    /**
     * provider（子进程实现）在 spawn **之后**失败时保留的原始错误。
     *
     * ⚠️ 必须留着并在 {@link result} 里抛出去：官方 `dsh-bash-local` 的 `result()` 就是这么做的
     * （`if (providerFailure !== undefined) throw providerFailure.error`）。吞掉它、返回
     * `exitCode: null` 的话，`renderResult` 会渲染成 `[exit code: 0]` —— 一个**基础设施失败**
     * 看起来像命令成功、只是没输出（真机上「不报错、只是永远不对」的那一类）。
     * 后台/转后台路径仍然靠 `note` 走输出拉取源，模型能从 `job_output` 读到这条说明。
     */
    let providerError: unknown
    const done = handle.done.then(
      (outcome) => {
        proc.status = outcome.signal !== null ? 'killed' : 'completed'
        proc.exitCode = outcome.exitCode
        proc.signal = outcome.signal
        if (confined !== undefined && outcome.signal === null) {
          proc.runnerFailed =
            classifyRunnerFailure(outcome.exitCode, stderr.readFrom(0).text, confined.runnerFailureRules) !== undefined
        }
      },
      (error: unknown) => {
        proc.status = 'killed'
        providerError = error
        note = `subprocess failed before reporting an outcome: ${String(error)}`
      },
    )
    /**
     * 是否是**我们主动终止**了它。
     *
     * Windows 上终止只体现为退出码（`signal` 恒为 `null`），所以「被停掉」这件事
     * 只能在这里记 —— 见 {@link RunningProcess.jobOutcome}。
     */
    let killedByUs = false
    /**
     * 沙箱事实：**只在结算后**给出。
     *
     * ⚠️ 早先的实现在后台分支里「第一次读时算一次并永久缓存」，于是第一次 `job_output`
     * 发生在进程还在跑的时候，就会把 `denied: false` / 无 `runnerFailed` **永久钉死**，
     * 真正的沙箱拒绝再也不会报给模型。现在按「未结算 → undefined，结算后按终态算」。
     */
    const sandbox = (): SandboxInfoLike | undefined => {
      if (call.policy === undefined) return undefined
      // 有策略但没走 confine ⇒ danger-full-access：如实报告「未受限、未拒绝」。
      if (confined === undefined) return UNCONFINED_INFO
      if (proc.status === 'running') return undefined
      return {
        mode: call.policy.mode,
        denied: matchesDenial(proc.exitCode, stderr.readFrom(0).text, confined.denialSignatures),
        enforcement: confined.enforcement,
        ...(proc.runnerFailed ? { runnerFailed: true } : {}),
      }
    }
    return {
      observed: { stdout, stderr },
      done,
      failureNote: () => note,
      sandbox,
      /**
       * 任务终态。
       *
       * ⚠️ 这里必须自己记「是不是我们杀掉的」，**不能**只看 `outcome.signal`：
       * Windows 上终止进程给的是**退出码**（`taskkill` / Job Object 都是 `exit code 1`），
       * `signal` 恒为 `null` —— 只按 signal 判定的话 `killed` 分支在 win32 上**永远走不到**，
       * 一个被 `job_kill` 停掉的任务会显示成「completed, exit code: 1」，
       * 看起来像命令自己失败了。所以由 {@link kill} 记下事实，`cancel` 把原因传进来。
       * ⚠️ `detail` 只用官方的「信号 / 未退出」口径，**不要再带停掉的原因**：
       * `dsh-jobs-local` 在 `outcome.status === 'killed'` 时会自己把 `job.killReason`
       * 追加在后面（`job.detail = `${outcome.detail}; ${job.killReason}``），
       * 我们这边再带一次就会渲染成 `原因; 原因`（真机实测到的重复）。
       * @returns 交给 `ctx.jobs` 的结果。
       */
      jobOutcome: () => {
        if (!killedByUs) {
          return processOutcome(
            {
              status: proc.status,
              exitCode: proc.exitCode,
              signal: proc.signal,
              ...(sandbox() !== undefined ? { sandbox: sandbox() } : {}),
            },
            escalationModes,
          )
        }
        const base: JobOutcomeLike = {
          status: 'killed',
          detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit',
        }
        const notes = sandboxNotes(sandbox(), escalationModes)
        return notes.length === 0 ? base : { ...base, detail: `${base.detail}; ${notes.join(' ')}` }
      },
      kill: () => {
        if (proc.status !== 'running') return
        killedByUs = true
        try {
          handle.terminate()
        } catch {
          // 已经结束，忽略。
        }
      },
      result: (flags) => {
        // ⚠️ provider 失败要在**渲染之前**抛回原错误（官方口径）：让这次工具调用直接 isError。
        // 不抛的话 `exitCode: null` 会被 `renderResult` 渲染成 `[exit code: 0]`，把
        // 「沙箱 runner / 子进程实现崩了」伪装成「命令成功但没输出」。
        if (providerError !== undefined) throw providerError
        const stdoutValue = finalOutput(stdout)
        let stderrValue = finalOutput(stderr)
        if (note !== undefined) {
          const separator = stderrValue.text.length > 0 && !stderrValue.text.endsWith('\n') ? '\n' : ''
          stderrValue = { ...stderrValue, text: `${stderrValue.text}${separator}${note}` }
        }
        const facts = sandbox()
        return {
          kind: 'foreground',
          cwd: call.workdir,
          exitCode: proc.exitCode,
          signal: proc.signal,
          timedOut: flags.timedOut,
          aborted: flags.aborted,
          timeoutMs: flags.timeoutMs,
          stdout: stdoutValue,
          stderr: stderrValue,
          ...(facts !== undefined ? { sandbox: facts } : {}),
        }
      },
    }
  }

  /**
   * 把一次运行登记成 `ctx.jobs` 任务（官方 `startJob` 的等价物）。
   *
   * 两条与官方逐字对齐、且**写错就静默失效**的要点：
   *
   * 1. `owner` 必须是 **agent id（session id）字符串**。注册表拿它 `agents.get()` 反查活着的
   *    agent（`dsh-jobs-local` 的 `resolveOwner`）；传 agent 对象会直接抛
   *    `session "[object Object]" has no live agent`，任务起不来。
   * 2. 必须给 `output` **拉取源**。注册表只认它——它按源把 stdout/stderr 泵进任务的输出环，
   *    `job_output` 读的就是那个环。早先那种「在 hooks 上返回 `readOutput()`」的写法注册表
   *    根本不认识（`dsh-jobs-local` 里没有 `readOutput`），表现是：任务照常跑完、状态也对，
   *    但 **`job_output` 永远是空的**。
   * @param call - 本次调用的解析结果。
   * @param exec - 工具运行上下文。
   * @returns 已登记的任务。
   */
  const startJob = async (call: ResolvedCall, exec: ToolRunContextLike): Promise<AttachedJob> => {
    const jobs = runtime.jobs
    if (jobs === undefined) {
      throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
    }
    const { args } = call
    // `jobs.start` 要求 `run()` **同步**交回 hooks，而 `confine` 是 async ——
    // 所以在进 run() 之前先把受限 argv 解析好（confine 只物化策略，不 spawn）。
    const { argv, confined } = await confineArgv([runtime.bashPath, '-c', args.command], call.policy)
    const owner = exec.agent?.id
    let live: RunningProcess | undefined
    let stopped: string | undefined
    /** spawn 同步失败时的说明（此时 `live` 还没建立，只能挂在源这一层）。 */
    let startupFailure: string | undefined
    let startupFailureSent = false
    /** 一次性把「spawn 前失败」的说明随 stderr 送进输出环。 */
    const pendingNote = (): string | undefined => {
      if (startupFailure !== undefined && !startupFailureSent) {
        startupFailureSent = true
        return startupFailure
      }
      return live?.failureNote()
    }
    const source = (channel: 'stdout' | 'stderr') => ({
      channel,
      read: (fromByte: number) => {
        const reader = live?.observed[channel]
        if (reader === undefined) {
          const note = channel === 'stderr' ? pendingNote() : undefined
          return note === undefined
            ? { text: '', nextOffset: fromByte, lossy: false }
            : { text: note, nextOffset: fromByte, lossy: false }
        }
        const read = reader.readFrom(fromByte)
        const note = channel === 'stderr' ? pendingNote() : undefined
        if (note === undefined) return read
        const separator = read.text.length > 0 && !read.text.endsWith('\n') ? '\n' : ''
        return { ...read, text: `${read.text}${separator}${note}` }
      },
    })
    const jobId = jobs.start({
      kind: 'bash',
      label: args.command,
      ...(owner !== undefined ? { owner } : {}),
      // DSH 0.2.1 把这次工具调用写进 job/registered / job/settled 会话事件；
      // PTC 子调用的 callId 不是根调用，rootCallId 才让 UI 归位到模型发起的那次调用。
      toolCall: { callId: exec.callId, rootCallId: exec.rootCallId ?? exec.callId },
      output: [source('stdout'), source('stderr')],
      run: () => {
        const controller = new AbortController()
        let process: RunningProcess
        try {
          process = launch(argv, call, confined, controller.signal)
        } catch (error) {
          startupFailure = `subprocess failed before reporting an outcome: ${String(error)}`
          return {
            cancel: () => {
              stopped = 'killed before start'
            },
            done: Promise.resolve({ status: 'failed', detail: startupFailure }),
          }
        }
        live = process
        return {
          cancel: (reason?: string) => {
            if (controller.signal.aborted) return
            stopped = reason
            controller.abort(reason)
            process.kill()
          },
          done: process.done.then(
            () => process.jobOutcome(),
            () => process.jobOutcome(),
          ),
        }
      },
    })
    return { jobId, process: () => live, stopped: () => stopped }
  }

  /**
   * 前台等一个已登记的任务（官方 `waitOnJob` 的等价物）。
   *
   * 三条出口与官方一致：
   * 1. 等到了终态 → `remove` 后返回 foreground（被停过则带 `stopped`）；
   * 2. 等满了但**进程还没起来**（准备阶段超时）→ 停掉、返回 `timedOut` 的 foreground；
   * 3. 等满了而进程还在跑 → **转后台**，交回 job id 与「到目前为止的输出」。
   * @param attached - 已登记的任务。
   * @param call - 本次调用的解析结果。
   * @param exec - 工具运行上下文。
   * @returns 前台值或转后台值。
   */
  const waitOnJob = async (
    attached: AttachedJob,
    call: ResolvedCall,
    exec: ToolRunContextLike,
  ): Promise<ForegroundValue | PromotedValue> => {
    const jobs = runtime.jobs
    if (
      jobs?.wait === undefined ||
      jobs.read === undefined ||
      jobs.kill === undefined ||
      jobs.remove === undefined
    ) {
      throw new Error('bash: ctx.jobs lacks the wait/read/kill/remove registry API')
    }
    const owner = exec.agent?.id
    const { timeoutMs } = call
    /** 因本次调用自身的原因停掉任务，并等它结算（免得结算通知追在一个已经交回的结果后面）。 */
    const stop = async (reason: string): Promise<void> => {
      jobs.kill?.(attached.jobId, owner, reason)
      const settled = await jobs.wait?.(attached.jobId, timeoutMs, owner)
      if (settled !== undefined && settled.status !== 'running' && settled.status !== 'stopping') {
        jobs.remove?.(attached.jobId, owner)
      }
    }
    let view: BashJobViewLike
    try {
      view = await jobs.wait(attached.jobId, timeoutMs, owner, exec.signal)
    } catch {
      await stop('tool call aborted')
      throw abortError()
    }
    if ((view.status === 'running' || view.status === 'stopping') && attached.process() === undefined) {
      await stop('timed out during preparation')
      return {
        kind: 'foreground',
        cwd: call.workdir,
        exitCode: null,
        signal: null,
        timedOut: true,
        aborted: false,
        timeoutMs,
        stdout: emptyStream(),
        stderr: emptyStream(),
        ...(call.policy !== undefined ? { sandbox: { mode: call.policy.mode, denied: false } } : {}),
      }
    }
    if (view.status === 'running' || view.status === 'stopping') {
      const read = jobs.read(attached.jobId, owner)
      return {
        kind: 'promoted',
        jobId: attached.jobId,
        cwd: call.workdir,
        timeoutMs,
        output: renderJobRead(
          ringDelta(read.chunks),
          read.lossy,
          read.job?.output?.spillPaths ?? [],
          attached.process()?.sandbox(),
          escalationModes,
        ),
      }
    }
    jobs.remove(attached.jobId, owner)
    const process = attached.process()
    if (process === undefined) throw new Error(view.detail ?? `job ${attached.jobId} settled without a process`)
    const stopped = attached.stopped()
    const result = process.result({ timeoutMs, timedOut: false, aborted: false })
    return { ...result, ...(stopped !== undefined ? { stopped } : {}) }
  }

  /** 后台分支：交给 `ctx.jobs`，返回后由 `job_output` / `job_kill` 接管。 */
  const runBackground = async (call: ResolvedCall, exec: ToolRunContextLike): Promise<BackgroundValue> => {
    if (runtime.jobs === undefined) {
      throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
    }
    if (exec.signal.aborted) throw abortError()
    const attached = await startJob(call, exec)
    return { kind: 'background', jobId: attached.jobId, cwd: call.workdir }
  }

  /**
   * 前台「超时即杀」分支（本部署没有「超时转后台」能力时用：没有 `ctx.jobs`，或注册表缺
   * `wait`/`read`/`kill`/`remove`）。`ctx.shell` 完全不参与。
   */
  const runForeground = async (call: ResolvedCall, exec: ToolRunContextLike): Promise<ForegroundValue> => {
    const { timeoutMs } = call
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort()
    }, timeoutMs)
    timer.unref()
    const fused = AbortSignal.any([exec.signal, timeout.signal])
    const { argv, confined } = await confineArgv([runtime.bashPath, '-c', call.args.command], call.policy)
    let process: RunningProcess
    try {
      process = launch(argv, call, confined, fused)
    } catch (error) {
      clearTimeout(timer)
      if (exec.signal.aborted) throw abortError()
      throw error
    }
    await process.done
    clearTimeout(timer)
    if (exec.signal.aborted) {
      process.kill()
      throw abortError()
    }
    return process.result({ timeoutMs, timedOut: timeout.signal.aborted, aborted: false })
  }

  return {
    name: 'bash',
    description: bashDescription(escalationModes, runtime.workingDirectory !== undefined),
    parameters: bashParameters(escalationModes, promote),
    output: {
      schema: bashOutputSchema(),
      render: (_args: unknown, value: unknown): ContentBlockLike[] => {
        const typed = value as BashToolValue
        return [
          {
            type: 'text',
            text:
              typed.kind === 'background'
                ? `started background job ${typed.jobId}`
                : typed.kind === 'promoted'
                  ? renderPromoted(typed)
                  : renderResult(typed, escalationModes),
          },
        ]
      },
      /**
       * DSH 0.2.1 起官方工具把实际执行目录写进 `tool/result.meta`；终端卡片优先读
       * `meta.cwd`，只有旧结果没有它时才退回会话工作区。会话 `cd` 之后这一项决定卡片
       * 显示的目录是否真实。
       */
      presentationMeta: (_args: unknown, value: unknown): unknown => {
        const cwd = (value as { cwd?: unknown } | undefined)?.cwd
        return typeof cwd === 'string' ? { cwd } : undefined
      },
    },
    async execute(rawArgs: unknown, exec: ToolRunContextLike): Promise<BashToolValue> {
      const call = await prepare(rawArgs, exec)
      if (call.args.run_in_background === true) return runBackground(call, exec)
      if (promote) {
        let attached: AttachedJob | undefined
        try {
          attached = await startJob(call, exec)
        } catch (error) {
          // 官方口径：登记被拒（典型是「该 owner 的并发任务已达上限」）时**降级**为前台硬超时，
          // 而不是让这次工具调用失败。
          runtime.warn?.(
            `bash: job registration refused, running in the foreground with the timeout kill instead: ${String(error)}`,
          )
        }
        if (attached !== undefined) return waitOnJob(attached, call, exec)
      }
      return runForeground(call, exec)
    },
    presentCall(rawArgs: unknown): unknown {
      const record = typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {}
      const command = typeof record.command === 'string' ? record.command : ''
      const description = typeof record.description === 'string' ? record.description : ''
      if (record.run_in_background === true) {
        return {
          card: 'generic',
          title: command,
          kind: 'execute',
          rawInput: command,
          content: [{ type: 'text', text: description }],
        }
      }
      return {
        card: 'terminal',
        title: command,
        description,
        ...(typeof record.workdir === 'string' ? { cwd: record.workdir } : {}),
      }
    },
    presentResult(rawArgs: unknown, result: ToolResultLike): unknown {
      const record = typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {}
      const block = result.content.length === 1 ? result.content[0] : undefined
      const raw = block !== undefined && block.type === 'text' ? block.text : undefined
      if (raw === undefined) return undefined
      // 后台确认与「转后台」都不是终态输出 → 用通用 fenced 卡片，不给退出码 pill（与官方一致）。
      const promoted = (result.value as { kind?: unknown } | undefined)?.kind === 'promoted'
      if (record.run_in_background === true || promoted || result.isError) {
        return {
          card: 'generic',
          content: [{ type: 'text', text: '```console\n' + raw.replace(/\n+$/, '') + '\n```' }],
        }
      }
      const { body, ...exit } = parseExitStatus(raw)
      return { card: 'terminal', output: body, ...exit }
    },
  }
}
