/**
 * dsh-tweaks-turn-file-revert — 宿主半区。
 *
 * 监听三件事，把「本回合模型改了哪些文件、改前改后各是什么」记成进程内状态：
 * - `session/event`：`tool/call` 给出 callId → (sessionId, turn)；
 * - `tools/pre-execute`：文件工具执行前读出旧内容；
 * - `tools/post-execute`：执行后读出新内容，算 +/− 行数。
 *
 * 再通过 `ctx.connection.rpc` 暴露 `state` / `revert` / `reapply` 三个端点给浏览器
 * 半区那一行。所有注册都是 effect 所有，插件停止/更新即撤销。
 *
 * 为什么必须有宿主半区：浏览器拿不到「改动前的内容」，既算不出准确的 +/−，
 * 也无法把文件写回去。撤回与重新应用都只能在宿主侧做。
 */
import { registerTurnFileRpc } from './host/rpc.js'
import { TurnFileTracker } from './host/tracker.js'
import type { HostContextLike, SessionEventLike, SessionLike, ToolExecutionLike, ToolResultLike } from './host/types.js'

/** 本插件没有硬依赖：`fs` / `connection` 都用 `ctx.get` 读，缺失时降级。 */
export const inject: string[] = []

/** 供 Node 侧自测直接驱动追踪器（不经过 cordis 运行时）。 */
export { TurnFileTracker } from './host/tracker.js'

/** 从 `agent/pre-step` 载荷里取出 agent 与回合号。 */
function readPreStep(payload: unknown): { agent: object; turn: unknown } | null {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const agent = record.agent
  if (typeof agent !== 'object' || agent === null) return null
  return { agent, turn: record.turn }
}

/** 从 `tools/*` 载荷里取出工具调用描述。 */
function readExecution(exec: unknown): ToolExecutionLike | null {
  if (typeof exec !== 'object' || exec === null) return null
  const record = exec as Record<string, unknown>
  if (typeof record.callId !== 'string' || typeof record.name !== 'string') return null
  const agent = record.agent
  return {
    callId: record.callId,
    name: record.name,
    arguments: record.arguments,
    agent: typeof agent === 'object' && agent !== null ? (agent as ToolExecutionLike['agent']) : undefined,
    signal: record.signal instanceof AbortSignal ? record.signal : undefined,
  }
}

/** 从工具结果里取失败标记。 */
function readResult(result: unknown): ToolResultLike {
  if (typeof result !== 'object' || result === null) return {}
  return { isError: (result as Record<string, unknown>).isError }
}

/**
 * 宿主插件体。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: HostContextLike): void {
  const tracker = new TurnFileTracker(ctx)

  ctx.on('session/event', (session: SessionLike, event: SessionEventLike) => {
    try {
      tracker.observeSessionEvent(session, event)
    } catch {
      // 观察失败不能影响会话日志提交。
    }
  })

  ctx.on('agent/pre-step', (payload: unknown, next: () => unknown) => {
    try {
      const parsed = readPreStep(payload)
      if (parsed !== null) tracker.observePreStep(parsed.agent, parsed.turn)
    } catch {
      // 同上：兜底映射失败不阻断 step。
    }
    return next()
  })

  ctx.on('tools/pre-execute', async (exec: unknown, next: () => unknown) => {
    try {
      const parsed = readExecution(exec)
      if (parsed !== null) await tracker.captureBefore(parsed)
    } catch {
      // 读旧内容失败只是少了统计/撤回能力，绝不阻断工具执行。
    }
    return next()
  })

  ctx.on('tools/post-execute', async (exec: unknown, result: unknown, next: () => unknown) => {
    try {
      const parsed = readExecution(exec)
      if (parsed !== null) await tracker.recordAfter(parsed, readResult(result))
    } catch {
      // 同上。
    }
    return next()
  })

  registerTurnFileRpc(ctx, tracker)
}
