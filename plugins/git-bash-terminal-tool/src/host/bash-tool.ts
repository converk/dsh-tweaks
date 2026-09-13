/**
 * 自包含的 Git Bash 工具（工具名 `bash`，替换 preset 里的 `pwsh`）。
 *
 * 为什么不用官方 `dsh-tool-bash`：本插件零 `@deepseek-ai/*` 运行时依赖（设计文档 §2.8），
 * 而官方工具是「`ctx.shell` 的消费者」——`ctx.shell` 在 win32 上就是 pwsh，我们**不接管它**
 * （设计文档明确禁止）。所以这里按契约手写 `ToolDefinition`：
 *
 * - `parameters` 用**原始 JSON Schema**（`ToolSchema.parameters: Record<string, unknown>`，
 *   `register` 只对 `output.schema` 跑 `assertSupportedJsonSchema`，见 `dsh-tools/lib/index.js:2773`）；
 *   形状与官方 `defineTool` 编译出来的 JSON Schema 一致。
 * - `output.schema` 与官方**同形**（`oneOf`: background / foreground），所以 UI 的
 *   terminal 卡片与退出码 pill 表现一致；`render` 逐字复刻官方 `renderResult`。
 * - `execute` 自己实现子进程执行：`argv = [bashPath, '-c', command]`；受限模式走
 *   `ctx.sandbox.confine`（Windows 的 ACL 后端是 argv 前缀 runner，与 shell 无关），
 *   未受限（`danger-full-access`）完全不走 confine —— 与 `dsh-pwsh-sandbox` 的口径一致。
 * - 环境注入 `TERM=dumb` / `NO_COLOR=1` / `PAGER=cat` / `GIT_PAGER=cat`
 *   （与 `dsh-bash-local` 的 `ENV_OVERRIDES` 一致），并把 Git/Bash 自己的目录补进 `PATH`。
 */
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  validateEscalationArgs,
} from './escalation.js'
import type {
  CollectedOutputLike,
  ConfinedArgvLike,
  ContentBlockLike,
  JobOutcomeLike,
  RunnerFailureRuleLike,
  SandboxInfoLike,
  SandboxMode,
  SandboxPolicyLike,
  SubprocessCollectLike,
  SubprocessHandleLike,
  SubprocessOutputReaderLike,
  ToolDefinitionLike,
  ToolResultLike,
  ToolRunContextLike,
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
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly timeoutMs: number
  readonly stdout: CollectedOutputLike
  readonly stderr: CollectedOutputLike
  readonly sandbox?: SandboxInfoLike | undefined
}

/** 后台规范值（与官方 `output.schema` 的 background 分支同形）。 */
export interface BackgroundValue {
  readonly kind: 'background'
  readonly jobId: string
}

/** 工具的规范输出值。 */
export type BashToolValue = ForegroundValue | BackgroundValue

/** `ctx.subprocess` 的最小面（只用到 collect 模式）。 */
export interface BashSubprocessLike {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: {
      stdin: 'ignore'
      stdout: SubprocessCollectLike
      stderr: SubprocessCollectLike
    }
    graceMs: number
    signal?: AbortSignal | undefined
    env?: NodeJS.ProcessEnv | undefined
  }): SubprocessHandleLike
}

/** `ctx.jobs` 的最小面。 */
export interface BashJobsLike {
  start(spec: {
    kind: string
    label: string
    owner?: object
    run(): {
      cancel(reason?: string): void
      done: Promise<JobOutcomeLike>
      readOutput?(): string
    }
  }): string
}

/** 工具运行期依赖（由 `replace.ts` 在 agent 建立时装配）。 */
export interface BashToolRuntime {
  /** Git Bash 可执行文件的绝对路径。 */
  readonly bashPath: string
  /** `ctx.subprocess`（必需）。 */
  readonly subprocess: BashSubprocessLike
  /** `ctx.sandboxPolicy`（advertise 沙箱升级后必需）。 */
  readonly sandboxPolicy?: { resolve(request?: { session?: object; mode?: SandboxMode }): SandboxPolicyLike } | undefined
  /** `ctx.sandbox`（受限模式必需）。 */
  readonly sandbox?:
    | {
        confine(
          argv: readonly string[],
          policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string; sessionId?: unknown },
        ): ConfinedArgvLike
      }
    | undefined
  /** `ctx.jobs`（`run_in_background` 时必需）。 */
  readonly jobs?: BashJobsLike | undefined
  /** `ctx.shellEnv`（可选：拿得到就注入受管 `DSH_*`）。 */
  readonly shellEnv?: { collect(execution: { agent?: object }): Readonly<Record<string, string>> } | undefined
  /** `ctx.approval`（沙箱升级时必需）。 */
  readonly approval?:
    | {
        request(request: {
          agent: object
          toolName: string
          callId: string
          reason: string
          signal?: AbortSignal | undefined
        }): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
      }
    | undefined
  /** `ctx.shell.sandboxMode`：定义了才 advertise 升级字段（对齐官方判据）。 */
  readonly shellSandboxMode?: SandboxMode | undefined
  /** 是否允许后台任务（默认 true）。 */
  readonly backgroundEnabled?: boolean | undefined
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
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== 0) markers.push(`[exit code: ${String(result.exitCode ?? 0)}]`)
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/** 一次后台增量读取（内部形态）。 */
export interface ProcessReadLike {
  readonly delta: string
  readonly lossy: boolean
  readonly stdoutSpillPath?: string | undefined
  readonly stderrSpillPath?: string | undefined
}

/**
 * 把一次后台读取渲染成 `job_output` 增量（**逐字**复刻官方 `renderProcessRead`）。
 * @param read - 一次增量读取结果。
 * @param sandbox - 受限进程的沙箱事实。
 * @param escalationModes - 本部署 advertise 的升级目标。
 * @returns 模型可见的增量文本。
 */
export function renderProcessRead(
  read: ProcessReadLike,
  sandbox?: SandboxInfoLike | undefined,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const notices: string[] = []
  if (read.lossy) {
    const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path): path is string => path !== undefined)
    notices.push(
      `[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(', ') : '(unavailable)'}]`,
    )
  }
  if (sandbox?.runnerFailed === true) {
    notices.push(
      `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`,
    )
  } else if (sandbox?.denied === true) {
    notices.push(sandboxDenialMarker(sandbox.mode))
    if (escalationModes.length > 0) notices.push(escalationHintMarker('command'))
  }
  if (notices.length === 0) return read.delta
  const separator = read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : ''
  return `${read.delta}${separator}${notices.join('\n')}`
}

/** 把已结束的后台进程映射到通用任务终态（**逐字**复刻官方 `processOutcome`）。 */
export function processOutcome(proc: {
  status: 'running' | 'completed' | 'killed'
  exitCode: number | null
  signal: string | null
}): JobOutcomeLike {
  if (proc.status === 'killed') {
    return { status: 'killed', detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${String(proc.exitCode ?? 0)}` }
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

/** 从内容块数组里取唯一一段文本。 */
function firstText(content: readonly ContentBlockLike[]): string | undefined {
  const block = content.length === 1 ? content[0] : undefined
  return block !== undefined && block.type === 'text' ? block.text : undefined
}

/**
 * 解析并校验模型给的参数（口径对齐官方 `validateBashArgs`）。
 * @param args - 原始参数。
 * @param backgroundEnabled - 本部署是否暴露 `run_in_background`。
 * @param escalationAdvertised - 本部署是否 advertise 了升级字段。
 * @returns 窄化后的参数。
 * @throws 参数非法时的逐字对齐文案。
 */
export function parseBashArgs(args: unknown, backgroundEnabled: boolean, escalationAdvertised: boolean): BashToolArgs {
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
  if (runInBackground === true && !backgroundEnabled) {
    throw new Error('run_in_background is disabled for this deployment')
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
 * @param backgroundEnabled - 是否暴露 `run_in_background`。
 * @param escalationModes - advertise 的升级目标。
 * @returns 模型可见的工具描述。
 */
export function bashDescription(backgroundEnabled: boolean, escalationModes: readonly SandboxMode[]): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'
    : 'Background execution is not available; long-running commands must finish within the timeout.'
  const base =
    'Execute a command in Git Bash (`bash -c` on Windows) and return its stdout/stderr. ' +
    'The shell is POSIX: use forward slashes and `$VAR`; a Windows path such as C:/work is accepted as-is, and /c/work reaches the same place when a POSIX spelling is required. ' +
    'Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — pass `workdir` instead of using `cd`. ' +
    'Non-zero exits are reported as `[exit code: N]`. Current harness environment facts are exposed through managed `$DSH_*` variables; inspect them when needed. ' +
    'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. ' +
    'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. ' +
    background
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
 * @param backgroundEnabled - 是否暴露 `run_in_background`。
 * @param escalationModes - advertise 的升级目标（空表示不暴露升级字段）。
 * @returns 参数 JSON Schema。
 */
export function bashParameters(
  backgroundEnabled: boolean,
  escalationModes: readonly SandboxMode[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    command: { type: 'string', description: 'The bash command to execute.' },
    description: {
      type: 'string',
      description:
        'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "ls" -> "List files in current directory"; "git status" -> "Show working tree status"; "npm install" -> "Install package dependencies".',
    },
    timeoutMs: {
      type: 'number',
      description:
        'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
    },
    workdir: {
      type: 'string',
      description:
        'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.',
    },
  }
  if (backgroundEnabled) {
    properties.run_in_background = {
      type: 'boolean',
      description:
        'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.',
    }
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
 * 形状由部署里的 `defineTool` 实测得到，并由 `assertSupportedJsonSchema` 验证通过。
 * @returns `oneOf`（background / foreground）的 JSON Schema。
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
        },
        required: ['kind', 'jobId'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'foreground' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean' },
          aborted: { type: 'boolean' },
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
        required: ['kind', 'exitCode', 'signal', 'timedOut', 'aborted', 'timeoutMs', 'stdout', 'stderr'],
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
 * 解析本次命令的工作目录（对齐官方 `resolveWorkdir`）。
 *
 * 已解析策略的 `workspaceRoot` 优先，保证 workdir 与 confine 用的是同一个身份。
 * @param modelWorkdir - 模型给的 `workdir`。
 * @param sessionCwd - 会话头里的 cwd（内部 canonical 化）。
 * @param policyWorkspaceRoot - 已解析策略的 workspace root。
 * @returns 最终 cwd，或 undefined（交给执行器默认 `process.cwd()`）。
 */
export function resolveWorkdir(
  modelWorkdir: string | undefined,
  sessionCwd: string | undefined,
  policyWorkspaceRoot: string | undefined,
): string | undefined {
  const base = policyWorkspaceRoot ?? (sessionCwd === undefined ? undefined : canonicalPath(sessionCwd))
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
 * Git/Bash 自己所在的相关目录（用来补 `PATH`，确保 `bash` 与 `git` 可用）。
 * @param bashPath - bash 可执行文件绝对路径。
 * @returns 目录列表（顺序即优先级）。
 */
export function bashPathEntries(bashPath: string): string[] {
  const dir = dirname(bashPath)
  const root = resolve(dir, '..', '..')
  const entries = new Set<string>()
  for (const candidate of [
    dir,
    resolve(root, 'bin'),
    resolve(root, 'usr', 'bin'),
    resolve(root, 'cmd'),
    resolve(root, 'mingw64', 'bin'),
  ]) {
    entries.add(candidate)
  }
  return [...entries]
}

/**
 * 拼接子进程的 `PATH`（Git/Bash 目录在前，环境里原有的 PATH 在后，`;` 分隔）。
 * @param bashPath - bash 可执行文件绝对路径。
 * @param ambientPath - 环境里原有的 PATH。
 * @returns 新的 PATH 字符串。
 */
export function composePath(bashPath: string, ambientPath: string | undefined): string {
  const entries = bashPathEntries(bashPath)
  if (ambientPath !== undefined && ambientPath.length > 0) entries.push(ambientPath)
  return entries.join(';')
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
  try {
    const collected =
      runtime.shellEnv?.collect(exec.agent !== undefined ? { agent: exec.agent as object } : {}) ?? undefined
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
  const backgroundEnabled = runtime.backgroundEnabled ?? true
  const escalationModes: readonly SandboxMode[] = runtime.shellSandboxMode === undefined ? [] : ESCALATION_TARGETS

  /** 解析一次调用的生效策略（advertise 了升级就必须有 sandboxPolicy，fail loud）。 */
  const resolvePolicy = (exec: ToolRunContextLike): SandboxPolicyLike | undefined => {
    if (escalationModes.length === 0) return undefined
    const service = runtime.sandboxPolicy
    if (service === undefined) throw new Error('bash: the mounted executor confines but ctx.sandboxPolicy is missing')
    return service.resolve(exec.agent !== undefined ? { session: exec.agent.session as object } : {})
  }

  /** 受限模式：把 argv 交给 `ctx.sandbox.confine`；未受限则原样执行。 */
  const confineArgv = (
    argv: readonly string[],
    policy: SandboxPolicyLike | undefined,
  ): { argv: readonly string[]; confined?: ConfinedArgvLike | undefined } => {
    if (policy === undefined || policy.mode === 'danger-full-access') return { argv }
    const provider = runtime.sandbox
    if (provider === undefined) throw new Error('bash: this call is confined but ctx.sandbox is missing')
    const confined = provider.confine(argv, {
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
    const args = parseBashArgs(rawArgs, backgroundEnabled, escalationModes.length > 0)
    const standing = resolvePolicy(exec)
    const approvedMode = await approveIfAsked(args, exec, standing)
    const policy: SandboxPolicyLike | undefined =
      standing === undefined
        ? undefined
        : approvedMode === undefined
          ? standing
          : { ...standing, mode: approvedMode }
    const sessionCwd = exec.agent?.session?.header?.cwd
    const workdir = resolveWorkdir(args.workdir, sessionCwd, policy?.workspaceRoot) ?? process.cwd()
    const timeoutMs = Math.min(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    return { args, policy, workdir, timeoutMs, env: composeEnv(runtime, exec) }
  }

  /** 后台分支：交给 `ctx.jobs`，返回后由 `job_output` / `job_kill` 接管。 */
  const runBackground = (call: ResolvedCall, exec: ToolRunContextLike): BackgroundValue => {
    const jobs = runtime.jobs
    if (jobs === undefined) {
      throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
    }
    if (exec.signal.aborted) throw abortError()
    const { args, policy, workdir, env } = call
    const jobId = jobs.start({
      kind: 'bash',
      label: args.command,
      ...(exec.agent !== undefined ? { owner: exec.agent as object } : {}),
      run: () => {
        const { argv, confined } = confineArgv([runtime.bashPath, '-c', args.command], policy)
        const handle = runtime.subprocess.spawn({
          argv,
          cwd: workdir,
          stdio: { stdin: 'ignore', stdout: collect(MAX_OUTPUT_BYTES), stderr: collect(MAX_OUTPUT_BYTES) },
          graceMs: GRACE_MS,
          env,
        })
        const stdoutReader = handle.collected.stdout
        const stderrReader = handle.collected.stderr
        if (stdoutReader === undefined || stderrReader === undefined) {
          throw new Error('bash: subprocess implementation dropped a requested collect stream')
        }
        const proc = {
          status: 'running' as 'running' | 'completed' | 'killed',
          exitCode: null as number | null,
          signal: null as string | null,
        }
        /** 只在前台分支之外的失败路径上补一段说明（对齐官方 provider 失败提示）。 */
        let providerFailureNote: string | undefined
        let runnerFailure = false
        const settlement = handle.done.then(
          (outcome) => {
            proc.status = outcome.signal !== null ? 'killed' : 'completed'
            proc.exitCode = outcome.exitCode
            proc.signal = outcome.signal
            if (confined !== undefined && outcome.signal === null) {
              runnerFailure =
                classifyRunnerFailure(outcome.exitCode, stderrReader.readFrom(0).text, confined.runnerFailureRules) !==
                undefined
            }
          },
          (error: unknown) => {
            proc.status = 'killed'
            providerFailureNote = `subprocess failed before reporting an outcome: ${String(error)}`
          },
        )
        /** 受限进程的沙箱事实（按需计算一次）。 */
        let sandboxInfo: SandboxInfoLike | undefined
        const sandboxFacts = (): SandboxInfoLike | undefined => {
          if (confined === undefined) return undefined
          if (sandboxInfo === undefined) {
            sandboxInfo = {
              mode: policy?.mode ?? 'read-only',
              denied: matchesDenial(proc.exitCode, stderrReader.readFrom(0).text, confined.denialSignatures),
              enforcement: confined.enforcement,
              ...(runnerFailure || providerFailureNote !== undefined ? { runnerFailed: true } : {}),
            }
          }
          return sandboxInfo
        }
        let stdoutOffset = 0
        let stderrOffset = 0
        return {
          cancel: () => {
            if (proc.status !== 'running') return
            proc.status = 'killed'
            handle.terminate()
          },
          done: settlement.then(
            () => processOutcome(proc),
            () => processOutcome({ status: 'killed', exitCode: null, signal: null }),
          ),
          readOutput: () => {
            const out = stdoutReader.readFrom(stdoutOffset)
            const err = stderrReader.readFrom(stderrOffset)
            stdoutOffset = out.nextOffset
            stderrOffset = err.nextOffset
            const failureSeparator = err.text.length > 0 && !err.text.endsWith('\n') ? '\n' : ''
            const errText = err.text + (providerFailureNote !== undefined ? `${failureSeparator}${providerFailureNote}` : '')
            const separator = out.text.length > 0 && !out.text.endsWith('\n') ? '\n' : ''
            return renderProcessRead(
              {
                delta: out.text + (errText.length > 0 ? `${separator}[stderr]\n${errText}` : ''),
                lossy: out.lossy || err.lossy,
                ...(out.spillPath !== undefined ? { stdoutSpillPath: out.spillPath } : {}),
                ...(err.spillPath !== undefined ? { stderrSpillPath: err.spillPath } : {}),
              },
              sandboxFacts(),
              escalationModes,
            )
          },
        }
      },
    })
    return { kind: 'background', jobId }
  }

  /** 前台分支：自己管 deadline 与取消（`ctx.shell` 完全不参与）。 */
  const runForeground = async (call: ResolvedCall, exec: ToolRunContextLike): Promise<ForegroundValue> => {
    const { args, policy, workdir, timeoutMs, env } = call
    const timeout = new AbortController()
    const timer = setTimeout(() => {
      timeout.abort()
    }, timeoutMs)
    timer.unref()
    const fused = AbortSignal.any([exec.signal, timeout.signal])
    const { argv, confined } = confineArgv([runtime.bashPath, '-c', args.command], policy)
    let handle: SubprocessHandleLike
    try {
      handle = runtime.subprocess.spawn({
        argv,
        cwd: workdir,
        stdio: { stdin: 'ignore', stdout: collect(MAX_OUTPUT_BYTES), stderr: collect(MAX_OUTPUT_BYTES) },
        graceMs: GRACE_MS,
        signal: fused,
        env,
      })
    } catch (error) {
      clearTimeout(timer)
      if (exec.signal.aborted) throw abortError()
      throw error
    }
    let outcome: { exitCode: number | null; signal: NodeJS.Signals | null }
    try {
      outcome = await handle.done
    } catch (error) {
      if (exec.signal.aborted) throw abortError()
      throw error
    } finally {
      clearTimeout(timer)
    }
    if (exec.signal.aborted) {
      try {
        handle.terminate()
      } catch {
        // 已经结束，忽略。
      }
      throw abortError()
    }
    const stdoutReader = handle.collected.stdout
    const stderrReader = handle.collected.stderr
    if (stdoutReader === undefined || stderrReader === undefined) {
      throw new Error('bash: subprocess implementation dropped a requested collect stream')
    }
    const stdout = finalOutput(stdoutReader)
    const stderr = finalOutput(stderrReader)
    let sandbox: SandboxInfoLike | undefined
    if (policy !== undefined) {
      if (confined === undefined) {
        sandbox = UNCONFINED_INFO
      } else {
        const runnerFailed =
          outcome.signal === null &&
          classifyRunnerFailure(outcome.exitCode, stderr.text, confined.runnerFailureRules) !== undefined
        sandbox = {
          mode: policy.mode,
          denied: matchesDenial(outcome.exitCode, stderr.text, confined.denialSignatures),
          enforcement: confined.enforcement,
          ...(runnerFailed ? { runnerFailed: true } : {}),
        }
      }
    }
    return {
      kind: 'foreground',
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: timeout.signal.aborted,
      aborted: false,
      timeoutMs,
      stdout,
      stderr,
      ...(sandbox !== undefined ? { sandbox } : {}),
    }
  }

  return {
    name: 'bash',
    description: bashDescription(backgroundEnabled, escalationModes),
    parameters: bashParameters(backgroundEnabled, escalationModes),
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
                : renderResult(typed, escalationModes),
          },
        ]
      },
    },
    async execute(rawArgs: unknown, exec: ToolRunContextLike): Promise<BashToolValue> {
      const call = await prepare(rawArgs, exec)
      if (call.args.run_in_background === true) return runBackground(call, exec)
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
      const raw = firstText(result.content)
      if (raw === undefined) return undefined
      if (record.run_in_background === true || result.isError) {
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
