/**
 * 沙箱升级（`sandbox_permissions` + 审批）的**契约逐字复刻**（决策 E：一期实现）。
 *
 * 为什么复刻而不是 import：本插件坚持零 `@deepseek-ai/*` 运行时依赖（设计文档 §2.8），
 * 而升级链路在官方是 `@deepseek-ai/dsh-sandbox/lib/types/escalation.ts` 的纯函数 +
 * `@deepseek-ai/dsh-tool-bash` 里的一小段胶水。这里把那两处**逐字**搬成纯逻辑，
 * 文案、顺序、fail-closed 语义全部对齐（模型可见的标记也是）。
 *
 * 官方原文（0.1.5-rc.1，`dsh-sandbox/lib/index.js`）：
 * ```js
 * const WIDER_MODES = { 'read-only': ['workspace-write','danger-full-access'],
 *                       'workspace-write': ['danger-full-access'] }
 * const ESCALATION_TARGETS = ['workspace-write','danger-full-access']
 * ```
 * 以及 `approveEscalation` 的有序 fail-closed 序列：严格更宽 → 有审批服务 →
 * 有 agent → 发问 → 映射结果。**任何一步失败都在真正执行之前抛出**。
 */
import type { SandboxMode } from './types.js'

/** 严格更宽表：key 的当前模式可以升级到哪些目标模式（执行期判定，不写进 schema）。 */
export const WIDER_MODES: Readonly<Record<string, readonly SandboxMode[]>> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}

/** 升级目标全集（`read-only` 是地板，没有任何东西能升到它）。 */
export const ESCALATION_TARGETS: readonly SandboxMode[] = ['workspace-write', 'danger-full-access']

/** 审批结论（与官方 `EscalationOutcome` 同形）。 */
export type EscalationOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 审批请求的最小结构形状（官方 `EscalationApprover`）。 */
export interface EscalationApprover<A = object, C = string> {
  request(request: {
    agent: A
    toolName: string
    callId: C
    reason: string
    signal?: AbortSignal | undefined
  }): Promise<EscalationOutcome>
}

/** 一次升级问询（官方 `EscalationRequest`）。 */
export interface EscalationRequest {
  /** 请求的目标模式。 */
  readonly requestedMode: string
  /** 模型给出的一句话理由（原样进入审批文案）。 */
  readonly justification: string
  /** 本次调用的生效模式（请求必须比它**严格更宽**）。 */
  readonly effectiveMode: SandboxMode
  /** 面向用户的动作名词（bash 工具族用 `command`）。 */
  readonly subject: string
}

/** 审批要素（官方 `EscalationApproval`）。 */
export interface EscalationApproval<A = object, C = string> {
  readonly approver: EscalationApprover<A, C> | undefined
  readonly agent: A | undefined
  readonly callId: C
  readonly toolName: string
  readonly signal?: AbortSignal | undefined
}

/**
 * 校验升级参数配对（官方 `validateEscalationArgs`，文案逐字对齐）。
 * @param sandboxPermissions - 原始 `sandbox_permissions` 参数。
 * @param justification - 原始 `justification` 参数。
 * @throws 三步各自的原始文案。
 */
export function validateEscalationArgs(sandboxPermissions: string | undefined, justification: string | undefined): void {
  if (sandboxPermissions !== undefined && justification === undefined) {
    throw new Error('invalid escalation: sandbox_permissions requires a justification')
  }
  if (justification !== undefined && sandboxPermissions === undefined) {
    throw new Error('invalid escalation: justification is only valid together with sandbox_permissions')
  }
  if (justification !== undefined && justification.trim().length === 0) {
    throw new Error('invalid justification: expected a non-empty sentence')
  }
}

/**
 * 模型可见的沙箱拒绝标记（官方 `sandboxDenialMarker`，逐字对齐）。
 * @param mode - 被拒时生效的模式。
 * @returns 该标记行。
 */
export function sandboxDenialMarker(mode: SandboxMode): string {
  return `[sandbox: file access denied under ${mode} mode]`
}

/**
 * 模型可见的同回合升级提示（官方 `escalationHintMarker`，逐字对齐）。
 * @param subject - 动作名词（bash 族为 `command`）。
 * @returns 该提示行。
 */
export function escalationHintMarker(subject: string): string {
  return `[sandbox: escalation available — retry this exact ${subject} once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]`
}

/**
 * 在真正执行之前解析一次升级请求（官方 `approveEscalation` 的有序 fail-closed 序列）。
 * @param request - 待判定的升级请求。
 * @param approval - 工具层持有的审批要素。
 * @returns 本次调用获准使用的模式。
 * @throws 每一个非获准分支都有各自逐字对齐的错误文本。
 */
export async function approveEscalation<A, C>(request: EscalationRequest, approval: EscalationApproval<A, C>): Promise<SandboxMode> {
  const { requestedMode: mode, effectiveMode, justification, subject } = request
  if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode as SandboxMode)) {
    throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`)
  }
  if (approval.approver === undefined) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval service is composed`)
  }
  if (approval.agent === undefined) {
    throw new Error(`sandbox escalation to "${mode}" requires approval, but the call has no agent to route it through`)
  }
  const outcome = await approval.approver.request({
    agent: approval.agent,
    toolName: approval.toolName,
    callId: approval.callId,
    reason: `escalate sandbox to ${mode}: ${justification}`,
    ...(approval.signal !== undefined ? { signal: approval.signal } : {}),
  })
  switch (outcome) {
    case 'allowed-once':
      return mode as SandboxMode
    case 'rejected':
      throw new Error(`the user rejected escalating this ${subject} to "${mode}"`)
    case 'cancelled':
      throw new Error(`approval for escalating to "${mode}" was cancelled`)
    case 'unavailable':
      throw new Error(`sandbox escalation to "${mode}" requires approval, but no approval channel is available`)
    default:
      throw new Error(`sandbox escalation to "${mode}" produced an unrecognized approval outcome`)
  }
}

/**
 * 判断某模式是否落在该次调用的严格更宽集合内（用于自测与诊断）。
 * @param effectiveMode - 本次调用的生效模式。
 * @param mode - 目标模式。
 * @returns 是否严格更宽。
 */
export function isStrictlyWider(effectiveMode: SandboxMode, mode: string): boolean {
  return (WIDER_MODES[effectiveMode] ?? []).includes(mode as SandboxMode)
}
