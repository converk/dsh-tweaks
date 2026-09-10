/**
 * 回合内文件改动追踪器（宿主半区核心）。
 *
 * 数据来源只有一条链：模型的文件工具调用。
 * 1. `session/event` 的 `tool/call` 给出 callId → (sessionId, turn) 的权威映射；
 *    `agent/pre-step` 作为兜底（PTC 子调用没有 `tool/call` 事件）。
 * 2. `tools/pre-execute` 在工具**执行前**读出目标文件的旧内容；
 * 3. `tools/post-execute` 在**执行后**读出新内容，算出 +/− 行数。
 *
 * 同一回合同一文件被多次改动时：
 * - `before` 保留**本回合第一次改动前**的内容（撤回目标）；
 * - `after` 保留**最后一次改动后**的内容（重新应用目标），统计口径 = 本回合净变化。
 *
 * 因此一次「撤回 → 重新应用」是纯函数式的往返：撤回把磁盘写成 `before`（新建
 * 文件则删除），重新应用把磁盘写成 `after`（删除掉的新建文件重新写回来）。
 *
 * 只保留进程内状态：DSH 重启后旧回合没有行数、也不能撤回/重放
 * （视图返回 `tracked: false`，浏览器半区据此不显示这一行）。
 */
import { rm } from 'node:fs/promises'
import { countLineChanges, splitLines } from '../shared/diff.js'
import { mutationCallOf, type MutationCall } from '../shared/mutation.js'
import type {
  ActionOutcome,
  FileActionResult,
  FileChangeNote,
  FileChangeView,
  FilePhase,
  TurnAction,
  TurnChangesView,
} from '../shared/protocol.js'
import type {
  FsServiceLike,
  FsTargetLike,
  HostContextLike,
  SandboxPolicyLike,
  SandboxPolicyServiceLike,
  SessionEventLike,
  SessionLike,
  ToolExecutionLike,
  ToolResultLike,
} from './types.js'

/** 单个文件保留的旧/新内容上限；超过只记统计，不提供撤回/重放。 */
export const MAX_TRACKED_TEXT = 4 * 1024 * 1024

/** 单回合最多记录的文件数（防御性上限）。 */
export const MAX_FILES_PER_TURN = 500

/** 每个会话保留的最近回合数。 */
export const MAX_TURNS_PER_SESSION = 64

/** 最多保留的会话数（按最近使用）。 */
export const MAX_SESSIONS = 128

/** 待配对调用表的上限。 */
export const MAX_PENDING_CALLS = 4096

/** 一次调用的归属。 */
interface TurnRef {
  readonly sessionId: string
  readonly turn: number
}

/** `pre-execute` 时抓取到的改动前状态，等 `post-execute` 配对。 */
interface PendingCapture {
  readonly ref: TurnRef
  readonly call: MutationCall
  readonly cwd: string | undefined
  /** 发起调用的 live Session：解析沙箱策略时要用它把 workspace 边界定到会话 cwd。 */
  readonly session: object | undefined
  readonly key: string
  readonly displayPath: string
  /** 文件在改动前是否存在；`null` 表示 stat 失败、无从判断。 */
  readonly existed: boolean | null
  readonly before: string | null
  readonly note: FileChangeNote | null
}

/** 单个文件的回合记录。 */
interface FileRecord {
  readonly key: string
  readonly rawPath: string
  displayPath: string
  absolutePath: string | null
  /** 本回合第一次改动前的内容；null = 无法保留（新建 / 不可读 / 过大）。 */
  before: string | null
  /** 本回合最后一次改动后的内容（readonly 语义：撤回不覆盖它）。 */
  after: string | null
  added: number | null
  removed: number | null
  approximate: boolean
  created: boolean
  /** 当前磁盘上是「改动前」（true）还是「改动后」（false）。 */
  reverted: boolean
  note: FileChangeNote | null
}

/** 单个回合的记录。 */
interface TurnRecord {
  readonly sessionId: string
  readonly turn: number
  cwd: string | undefined
  /** 该回合所属的 live Session（首次看到时记住，供沙箱策略解析用）。 */
  session?: object
  readonly files: Map<string, FileRecord>
  readonly order: string[]
}

/** 单个会话的回合表（带最近使用顺序）。 */
interface SessionRecord {
  readonly turns: Map<number, TurnRecord>
  readonly order: number[]
}

/** stat 结果的结构性窄化。 */
interface StatLike {
  readonly type?: unknown
  readonly size?: unknown
}

/** 取会话工作目录。 */
function sessionCwdOf(exec: ToolExecutionLike): string | undefined {
  const cwd = exec.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** 取 agent 的 sessionId。 */
function sessionIdOf(exec: ToolExecutionLike): string | undefined {
  const id = exec.agent?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** 取发起调用的 live Session 对象（沙箱策略要按会话取 workspace 边界）。 */
function sessionObjectOf(exec: ToolExecutionLike): object | undefined {
  const session = exec.agent?.session
  return typeof session === 'object' && session !== null ? session : undefined
}

/** 取对象的字符串字段。 */
function stringField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

/** 取对象的整数数字段。 */
function integerField(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : null
}

/** 回合内文件改动追踪器。 */
export class TurnFileTracker {
  private readonly callTurns = new Map<string, TurnRef>()
  private readonly agentTurns = new WeakMap<object, number>()
  private readonly pending = new Map<string, PendingCapture>()
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly cwdTargets = new Map<string, FsTargetLike>()

  /**
   * @param ctx - 宿主上下文，用于按需读取 `ctx.fs`（服务可能后挂载）。
   */
  constructor(private readonly ctx: HostContextLike) {}

  /** 当前 `ctx.fs`（未挂载时 undefined）。 */
  private fs(): FsServiceLike | undefined {
    const fs = this.ctx.get('fs')
    return fs === undefined || fs === null ? undefined : (fs as FsServiceLike)
  }

  /**
   * 记录 `session/event`：`tool/call` 给出 callId → 回合的权威映射。
   * @param session - 事件所属会话。
   * @param event - 会话事件。
   */
  observeSessionEvent(session: SessionLike, event: SessionEventLike): void {
    if (event.type !== 'tool/call') return
    const callId = stringField(event.data, 'callId')
    const turn = integerField(event.data, 'turn')
    if (callId === null || turn === null) return
    this.callTurns.set(callId, { sessionId: session.id, turn })
    while (this.callTurns.size > MAX_PENDING_CALLS) {
      const oldest = this.callTurns.keys().next()
      if (oldest.done === true) break
      this.callTurns.delete(oldest.value)
    }
  }

  /**
   * 记录 `agent/pre-step` 的当前回合（兜底：PTC 子调用没有 `tool/call` 事件）。
   * @param agent - 发起模型请求的 agent。
   * @param turn - 该 step 所属回合。
   */
  observePreStep(agent: object, turn: unknown): void {
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0) return
    this.agentTurns.set(agent, turn)
  }

  /**
   * 工具执行前抓取目标文件的旧内容。
   * @param exec - 待执行的工具调用。
   */
  async captureBefore(exec: ToolExecutionLike): Promise<void> {
    const call = mutationCallOf(exec.name, exec.arguments)
    if (call === null) return
    const ref = this.turnOf(exec)
    if (ref === null) return
    const fs = this.fs()
    if (fs === undefined) return

    const cwd = sessionCwdOf(exec)
    let target: FsTargetLike
    try {
      target = await fs.resolve(call.path, cwd === undefined ? {} : { cwd })
    } catch {
      return
    }

    let existed: boolean | null = null
    let before: string | null = null
    let note: FileChangeNote | null = null
    try {
      const info = (await fs.stat(target)) as StatLike | undefined
      existed = info !== undefined
      if (existed) {
        const size = info === undefined ? undefined : info.size
        if (typeof size === 'number' && size > MAX_TRACKED_TEXT) {
          note = 'too-large'
        } else {
          const text = await fs.readText(target)
          if (text.length > MAX_TRACKED_TEXT) note = 'too-large'
          else before = text
        }
      }
    } catch {
      note = 'unreadable'
    }

    this.pending.set(exec.callId, {
      ref,
      call,
      cwd,
      session: sessionObjectOf(exec),
      key: keyOf(target, call.path),
      displayPath: target.displayPath,
      existed,
      before,
      note,
    })
  }

  /**
   * 工具执行后读取新内容、算出行数并写入回合记录。
   * @param exec - 已执行的工具调用。
   * @param result - 归一化结果；失败调用不记录（工具失败不改文件）。
   */
  async recordAfter(exec: ToolExecutionLike, result: ToolResultLike): Promise<void> {
    const capture = this.pending.get(exec.callId)
    if (capture === undefined) return
    this.pending.delete(exec.callId)
    if (result.isError === true) return
    const fs = this.fs()
    if (fs === undefined) return

    let after: string | null = null
    let absolutePath: string | null = null
    let note = capture.note
    try {
      const target = await fs.resolve(capture.call.path, capture.cwd === undefined ? {} : { cwd: capture.cwd })
      absolutePath = processPathOf(fs, target)
      const info = (await fs.stat(target)) as StatLike | undefined
      if (info !== undefined) {
        const size = info.size
        if (typeof size === 'number' && size > MAX_TRACKED_TEXT) {
          note = note ?? 'too-large'
        } else {
          const text = await fs.readText(target)
          if (text.length > MAX_TRACKED_TEXT) note = note ?? 'too-large'
          else after = text
        }
      }
    } catch {
      note = note ?? 'unreadable'
    }

    const created = capture.existed === false && after !== null
    const record = this.ensureTurn(capture.ref, capture.cwd, capture.session)
    const existing = record.files.get(capture.key)
    if (existing !== undefined) {
      // 同回合再次改动同一文件：`before` 与「是否新建」保持第一次的值，
      // `after` 与统计口径更新为最后一次。
      existing.after = after
      const stats = netStats(existing)
      existing.added = stats.added
      existing.removed = stats.removed
      existing.approximate = stats.approximate
      existing.absolutePath = absolutePath ?? existing.absolutePath
      existing.displayPath = capture.displayPath
      existing.reverted = false
      if (existing.before !== null) existing.note = null
      else existing.note = note ?? existing.note
      return
    }

    if (record.files.size >= MAX_FILES_PER_TURN) return
    const stats = netStats({ before: capture.before, after, created })
    record.files.set(capture.key, {
      key: capture.key,
      rawPath: capture.call.path,
      displayPath: capture.displayPath,
      absolutePath,
      before: capture.before,
      after,
      added: stats.added,
      removed: stats.removed,
      approximate: stats.approximate,
      created,
      reverted: false,
      note,
    })
    record.order.push(capture.key)
  }

  /**
   * 读一个回合的改动视图。
   * @param sessionId - 会话 id。
   * @param turn - 回合号。
   * @returns 视图；未被追踪时 `tracked: false`。
   */
  view(sessionId: string, turn: number): TurnChangesView {
    const record = this.sessions.get(sessionId)?.turns.get(turn)
    if (record === undefined) {
      return {
        tracked: false,
        turn,
        sessionId,
        cwd: null,
        files: [],
        totalAdded: 0,
        totalRemoved: 0,
        totalFiles: 0,
        action: 'none',
        blocked: 0,
      }
    }
    const files: FileChangeView[] = []
    let totalAdded = 0
    let totalRemoved = 0
    let blocked = 0
    for (const key of record.order) {
      const file = record.files.get(key)
      if (file === undefined) continue
      const view = toView(file)
      files.push(view)
      if (file.added !== null) totalAdded += file.added
      if (file.removed !== null) totalRemoved += file.removed
      if (view.phase === 'blocked') blocked += 1
    }
    return {
      tracked: true,
      turn,
      sessionId,
      cwd: record.cwd ?? null,
      files,
      totalAdded,
      totalRemoved,
      totalFiles: files.length,
      action: actionOf(files),
      blocked,
    }
  }

  /**
   * 撤回一个回合的全部文件改动（幂等：已在撤回态的跳过）。
   * @param sessionId - 会话 id。
   * @param turn - 回合号。
   * @returns 每个文件的处理结果与撤回后的视图。
   * @throws 该回合未被追踪或 `ctx.fs` 缺失时抛出（由 RPC 层转成失败结果）。
   */
  async revert(sessionId: string, turn: number): Promise<ActionOutcome> {
    const record = this.requireTurn(sessionId, turn)
    const fs = this.requireFs()
    const policy = this.sandboxPolicyFor(record)
    const results: FileActionResult[] = []
    for (const file of filesOf(record)) {
      if (file.reverted) continue
      if (policy?.mode === 'read-only') {
        // 只读模式下连「删除本回合新建的文件」也不该做（rm 不经过沙箱，这里自己把关）。
        results.push(failure(file.rawPath, 'sandbox-read-only', READ_ONLY_MESSAGE))
        continue
      }
      if (!revertable(file)) {
        results.push(failure(file.rawPath, 'not-revertable', noteMessage(file.note)))
        continue
      }
      results.push(await this.revertOne(fs, record, file, policy))
    }
    return { results, view: this.view(sessionId, turn) }
  }

  /**
   * 重新应用一个回合的文件改动（撤回的反向操作；幂等：已是应用态的跳过）。
   * @param sessionId - 会话 id。
   * @param turn - 回合号。
   * @returns 每个文件的处理结果与重放后的视图。
   * @throws 该回合未被追踪或 `ctx.fs` 缺失时抛出。
   */
  async reapply(sessionId: string, turn: number): Promise<ActionOutcome> {
    const record = this.requireTurn(sessionId, turn)
    const fs = this.requireFs()
    const policy = this.sandboxPolicyFor(record)
    const results: FileActionResult[] = []
    for (const file of filesOf(record)) {
      if (!file.reverted) continue
      if (policy?.mode === 'read-only') {
        results.push(failure(file.rawPath, 'sandbox-read-only', READ_ONLY_MESSAGE))
        continue
      }
      if (file.after === null) {
        results.push(failure(file.rawPath, 'not-reapplyable', noteMessage(file.note)))
        continue
      }
      results.push(await this.reapplyOne(fs, record, file, policy))
    }
    return { results, view: this.view(sessionId, turn) }
  }

  /** 撤回单个文件。 */
  private async revertOne(
    fs: FsServiceLike,
    record: TurnRecord,
    file: FileRecord,
    policy: SandboxPolicyLike | undefined,
  ): Promise<FileActionResult> {
    const cwd = record.cwd
    let target: FsTargetLike
    try {
      target = await fs.resolve(file.rawPath, cwd === undefined ? {} : { cwd })
    } catch (error) {
      return failure(file.rawPath, 'resolve-failed', messageOf(error))
    }

    const current = await readCurrentState(fs, target)
    const dirty = dirtyAgainst(current, file.after)

    if (file.created) {
      if (current.kind === 'missing') {
        // 文件已经不在了：视作已撤回。
        file.reverted = true
        return { path: file.rawPath, ok: true, code: null, message: null, dirty }
      }
      const cwdTarget = await this.primeCwdTarget(cwd)
      if (cwdTarget !== undefined && !fs.contains(cwdTarget, target)) {
        return failure(file.rawPath, 'outside-workspace', '新建的文件在会话工作区之外，拒绝删除')
      }
      const absolutePath = file.absolutePath ?? processPathOf(fs, target)
      if (absolutePath === null) {
        return failure(file.rawPath, 'no-process-path', '当前文件系统后端无法定位宿主路径，不能删除新建文件')
      }
      try {
        await rm(absolutePath, { force: true })
      } catch (error) {
        return failure(file.rawPath, 'delete-failed', messageOf(error))
      }
      file.reverted = true
      return { path: file.rawPath, ok: true, code: null, message: null, dirty }
    }

    if (file.before === null) return failure(file.rawPath, 'not-revertable', noteMessage(file.note))
    try {
      // 第 5 个参数是沙箱策略：不传的话 fs-sandbox 会用「无会话」的部署兜底 root，
      // 把会话工作区内的写回也判成越界（本机踩过：`file access denied under workspace-write mode`）。
      await fs.writeText(target, file.before, undefined, undefined, policy)
    } catch (error) {
      return failure(file.rawPath, writeFailureCode(error), messageOf(error))
    }
    file.reverted = true
    return { path: file.rawPath, ok: true, code: null, message: null, dirty }
  }

  /** 重新应用单个文件。 */
  private async reapplyOne(
    fs: FsServiceLike,
    record: TurnRecord,
    file: FileRecord,
    policy: SandboxPolicyLike | undefined,
  ): Promise<FileActionResult> {
    const content = file.after
    if (content === null) return failure(file.rawPath, 'not-reapplyable', noteMessage(file.note))
    const cwd = record.cwd
    let target: FsTargetLike
    try {
      target = await fs.resolve(file.rawPath, cwd === undefined ? {} : { cwd })
    } catch (error) {
      return failure(file.rawPath, 'resolve-failed', messageOf(error))
    }
    const current = await readCurrentState(fs, target)
    // 重放后期望的磁盘状态：新建文件 = 重新存在（没有「改动前内容」可比），
    // 其他文件 = 回到本回合改动前的内容。
    const dirty = dirtyAgainst(current, file.created ? null : file.before)
    try {
      await fs.writeText(target, content, undefined, undefined, policy)
    } catch (error) {
      return failure(file.rawPath, writeFailureCode(error), messageOf(error))
    }
    file.reverted = false
    return { path: file.rawPath, ok: true, code: null, message: null, dirty }
  }

  /** 找到（或创建）回合记录，并顺手做容量裁剪。 */
  private ensureTurn(ref: TurnRef, cwd: string | undefined, session: object | undefined): TurnRecord {
    let table = this.sessions.get(ref.sessionId)
    if (table === undefined) {
      table = { turns: new Map(), order: [] }
      this.sessions.set(ref.sessionId, table)
      this.trimSessions()
    }
    let record = table.turns.get(ref.turn)
    if (record === undefined) {
      record = { sessionId: ref.sessionId, turn: ref.turn, cwd, session, files: new Map(), order: [] }
      table.turns.set(ref.turn, record)
      table.order.push(ref.turn)
      while (table.order.length > MAX_TURNS_PER_SESSION) {
        const oldest = table.order.shift()
        if (oldest === undefined) break
        table.turns.delete(oldest)
      }
    }
    if (record.cwd === undefined && cwd !== undefined) record.cwd = cwd
    if (record.session === undefined && session !== undefined) record.session = session
    return record
  }

  /**
   * 解析该回合应使用的沙箱策略。
   *
   * `fs-sandbox` 在调用方**没给策略**时会用 `ctx.sandboxPolicy.resolve()`（无会话）的
   * 部署兜底 root——会话工作区里的文件也会被判成越界。这里按**会话**解析，让 workspace 边界
   * 落在会话 cwd（与官方 `deliverables` 的 `session.cwd ?? ctx.sandboxPolicy.workspaceRoot` 同口径）。
   * @param record - 目标回合。
   * @returns 策略；没有沙箱服务（非沙箱部署）时为 undefined。
   */
  private sandboxPolicyFor(record: TurnRecord): SandboxPolicyLike | undefined {
    const service = this.ctx.get('sandboxPolicy') as SandboxPolicyServiceLike | undefined
    if (service === undefined || service === null || typeof service.resolve !== 'function') return undefined
    try {
      const resolved = service.resolve(record.session === undefined ? undefined : { session: record.session })
      if (resolved === undefined || resolved === null || typeof resolved.mode !== 'string') return undefined
      const root = record.cwd
      if (typeof root === 'string' && root.length > 0 && resolved.workspaceRoot !== root) {
        return {
          mode: resolved.mode,
          workspaceRoot: root,
          ...(resolved.sessionId === undefined ? {} : { sessionId: resolved.sessionId }),
        }
      }
      return resolved
    } catch {
      return undefined
    }
  }

  /** 取回合记录，缺失即抛（RPC 层折成结构化失败）。 */
  private requireTurn(sessionId: string, turn: number): TurnRecord {
    const record = this.sessions.get(sessionId)?.turns.get(turn)
    if (record === undefined) throw new Error(`turn ${String(turn)} of session ${sessionId} is not tracked`)
    return record
  }

  /** 取 `ctx.fs`，缺失即抛。 */
  private requireFs(): FsServiceLike {
    const fs = this.fs()
    if (fs === undefined) throw new Error('ctx.fs is not mounted')
    return fs
  }

  /** 解析并缓存会话工作目录目标（删除新建文件前的包含性检查）。 */
  private async primeCwdTarget(cwd: string | undefined): Promise<FsTargetLike | undefined> {
    if (cwd === undefined) return undefined
    const cached = this.cwdTargets.get(cwd)
    if (cached !== undefined) return cached
    const fs = this.fs()
    if (fs === undefined) return undefined
    try {
      const target = await fs.resolve(cwd, {})
      this.cwdTargets.set(cwd, target)
      return target
    } catch {
      return undefined
    }
  }

  /** 会话数超限时按最近使用淘汰。 */
  private trimSessions(): void {
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next()
      if (oldest.done === true) break
      this.sessions.delete(oldest.value)
    }
  }

  /** 归属判定：优先 `tool/call` 事件，其次 agent 的当前 step 回合。 */
  private turnOf(exec: ToolExecutionLike): TurnRef | null {
    const byCall = this.callTurns.get(exec.callId)
    if (byCall !== undefined) return byCall
    const sessionId = sessionIdOf(exec)
    if (sessionId === undefined) return null
    const agent = exec.agent
    if (agent === undefined) return null
    const turn = this.agentTurns.get(agent)
    if (turn === undefined) return null
    return { sessionId, turn }
  }
}

/** 目标身份键：优先后端稳定 key，拿不到时退回路径原文。 */
function keyOf(target: FsTargetLike, rawPath: string): string {
  const key = target.targetKey
  if (typeof key === 'string' && key.length > 0) return key
  return `path:${rawPath}`
}

/** 目标在宿主进程里的路径；后端不支持时 null。 */
function processPathOf(fs: FsServiceLike, target: FsTargetLike): string | null {
  try {
    const path = fs.processPath(target)
    return typeof path === 'string' && path.length > 0 ? path : null
  } catch {
    return null
  }
}

/** 目标文件的当前内容：读到文本、确认不存在、或无从判断（过大 / 读失败）。 */
type CurrentState = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'missing' } | { readonly kind: 'unknown' }

/** 按需读文件当前内容，并区分「不存在」与「读不出来」。 */
async function readCurrentState(fs: FsServiceLike, target: FsTargetLike): Promise<CurrentState> {
  try {
    const info = (await fs.stat(target)) as StatLike | undefined
    if (info === undefined) return { kind: 'missing' }
    const size = info.size
    if (typeof size === 'number' && size > MAX_TRACKED_TEXT) return { kind: 'unknown' }
    const text = await fs.readText(target)
    return text.length > MAX_TRACKED_TEXT ? { kind: 'unknown' } : { kind: 'text', text }
  } catch {
    return { kind: 'unknown' }
  }
}

/**
 * 当前磁盘内容是否偏离期望状态（= 本次操作会覆盖别人的改动）。
 * @param current - 读到的当前状态。
 * @param expected - 期望内容；null 表示「期望这个文件不存在」。
 * @returns 是否偏离；无从判断时为 null。
 */
function dirtyAgainst(current: CurrentState, expected: string | null): boolean | null {
  if (current.kind === 'unknown') return null
  if (current.kind === 'missing') return expected !== null
  if (expected === null) return true
  return current.text !== expected
}

/** 回合内全部文件记录（按首次改动顺序）。 */
function filesOf(record: TurnRecord): FileRecord[] {
  const files: FileRecord[] = []
  for (const key of record.order) {
    const file = record.files.get(key)
    if (file !== undefined) files.push(file)
  }
  return files
}

/** 文件能否撤回。 */
function revertable(file: FileRecord): boolean {
  return file.created || file.before !== null
}

/** 文件能否重新应用。 */
function reapplyable(file: FileRecord): boolean {
  return file.after !== null
}

/** 计算本回合净增删（新建文件按「从不存在到存在」计）。 */
function netStats(file: {
  readonly before: string | null
  readonly after: string | null
  readonly created: boolean
}): { added: number | null; removed: number | null; approximate: boolean } {
  if (file.before !== null && file.after !== null) {
    const stats = countLineChanges(file.before, file.after)
    return { added: stats.added, removed: stats.removed, approximate: stats.approximate }
  }
  if (file.created && file.after !== null) {
    return { added: splitLines(file.after).length, removed: 0, approximate: false }
  }
  return { added: null, removed: null, approximate: false }
}

/** 文件记录 → 展示视图。 */
function toView(file: FileRecord): FileChangeView {
  const canRevert = revertable(file)
  const canReapply = reapplyable(file)
  const phase: FilePhase = file.reverted
    ? canReapply
      ? 'reverted'
      : 'blocked'
    : canRevert
      ? 'applied'
      : 'blocked'
  return {
    path: file.rawPath,
    absolutePath: file.absolutePath,
    added: file.added,
    removed: file.removed,
    approximate: file.approximate,
    created: file.created,
    phase,
    note: file.note,
  }
}

/** 整行按钮的动作：只要还有「应用态且可撤回」的文件就显示撤回，否则看重放。 */
function actionOf(files: readonly FileChangeView[]): TurnAction {
  if (files.some((file) => file.phase === 'applied')) return 'revert'
  if (files.some((file) => file.phase === 'reverted')) return 'reapply'
  return 'none'
}

/** 组装失败结果。 */
function failure(path: string, code: string, message: string): FileActionResult {
  return { path, ok: false, code, message, dirty: null }
}

/** 降级原因的用户可读说明。 */
function noteMessage(note: FileChangeNote | null): string {
  switch (note) {
    case 'too-large':
      return '文件过大，未保留改动前后的内容'
    case 'unreadable':
      return '无法读取文件内容（二进制或非 UTF-8）'
    case 'not-tracked':
      return '宿主进程重启后丢失了该回合的追踪'
    case 'outside-workspace':
      return '目标在会话工作区之外'
    case 'no-process-path':
      return '文件系统后端无法定位宿主路径'
    default:
      return '没有可用的文件内容快照'
  }
}

/** 取错误信息。 */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

/** 只读沙箱模式下统一的失败说明（连删除都不做）。 */
const READ_ONLY_MESSAGE = '当前会话处于只读文件沙箱（read-only），撤回/重放都不会写盘'

/**
 * 写盘失败的原因码：优先用底层结构化错误码（如 `FS_SANDBOX_DENIED`），否则 `write-failed`。
 * @param error - `ctx.fs.writeText` 抛出的错误。
 * @returns 结果里携带的 code。
 */
function writeFailureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) {
      if (code === 'FS_SANDBOX_DENIED') return 'sandbox-denied'
      return code
    }
  }
  return 'write-failed'
}
