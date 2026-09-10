/**
 * host ↔ client 私有通信协议（客户端 → 宿主，只走无损 JSON）。
 *
 * 两条传输（宿主半区**同时注册**，浏览器优先用第一条、失败自动回落到第二条）：
 * 1. `ctx.connection.rpc.handle(RPC_CHANNEL, handler)` —— 私有 RPC 前缀通道，
 *    挂在与 `/api` 同一套浏览器信任栅栏之后（Host/Origin 校验 + 登录 cookie）。
 * 2. `ctx.connection.fetch.register({ path: HTTP_ROUTE, … })` —— `/api` 下的精确
 *    Fetch 路由，用同源 `fetch` 调用。它不碰 `webServer`（见 AGENTS.md 2.4 的坑），
 *    因此是 1 不可用时的可靠兜底。
 *
 * 两者都返回 `{ ok: true, value }` / `{ ok: false, error }` 形状。
 */

/** 本插件的 RPC 通道（单段路径，符合 connection 的 CHANNEL_PATTERN）。 */
export const RPC_CHANNEL = '/turn-file-revert'

/** 本插件的精确 Fetch 路由（必须位于 `/api` 之下）。 */
export const HTTP_ROUTE = '/api/turn-file-revert'

/** 读某回合的统计与当前状态（按钮该显示「撤回」还是「重新应用」）。 */
export const RPC_STATE = 'state'

/** 撤回该回合的全部文件改动。 */
export const RPC_REVERT = 'revert'

/** 重新应用该回合的全部文件改动（撤回的反向操作）。 */
export const RPC_REAPPLY = 'reapply'

/**
 * 一个文件当前处于哪一侧。
 * - `applied`：磁盘上是「本回合改动后」的内容（可撤回）。
 * - `reverted`：磁盘上是「本回合改动前」的内容（可重新应用）。
 * - `blocked`：既撤不回也重放不了（内容过大 / 二进制 / 未保留快照）。
 */
export type FilePhase = 'applied' | 'reverted' | 'blocked'

/** 整行的按钮当前应该触发的动作。 */
export type TurnAction = 'revert' | 'reapply' | 'none'

/** 单个文件的降级原因。 */
export type FileChangeNote =
  /** 二进制或非 UTF-8 文本，读不出来。 */
  | 'unreadable'
  /** 文件过大，未保留改动前后的内容。 */
  | 'too-large'
  /** 宿主进程重启后丢失了该回合的追踪。 */
  | 'not-tracked'
  /** 目标在会话工作区之外，拒绝写入或删除。 */
  | 'outside-workspace'
  /** 后端不支持定位宿主路径（例如远端执行世界），无法删除新建文件。 */
  | 'no-process-path'

/** 一次文件改动的展示数据。 */
export interface FileChangeView {
  /** 模型在工具参数里给出的路径原文。 */
  readonly path: string
  /** 宿主侧解析出的绝对路径（拿不到时为 null）。 */
  readonly absolutePath: string | null
  /** 新增行数；无法统计时为 null。 */
  readonly added: number | null
  /** 删除行数；无法统计时为 null。 */
  readonly removed: number | null
  /** 行数是上界估计（差异过大时的降级值）。 */
  readonly approximate: boolean
  /** 本回合新建的文件（撤回 = 删除不，重新应用 = 重新写出来）。 */
  readonly created: boolean
  /** 该文件当前处在哪一侧。 */
  readonly phase: FilePhase
  /** 无法统计 / 撤回 / 重放的原因。 */
  readonly note: FileChangeNote | null
}

/** 一个回合的文件改动汇总。 */
export interface TurnChangesView {
  /** 该回合是否由当前宿主进程追踪到（重启后为 false）。 */
  readonly tracked: boolean
  /** 回合号。 */
  readonly turn: number
  /** 会话 id。 */
  readonly sessionId: string
  /** 会话工作目录（追踪时记录）。 */
  readonly cwd: string | null
  /** 本回合改动过的文件，按首次改动顺序。 */
  readonly files: readonly FileChangeView[]
  /** 合计新增行数。 */
  readonly totalAdded: number
  /** 合计删除行数。 */
  readonly totalRemoved: number
  /** 合计文件数。 */
  readonly totalFiles: number
  /** 按钮当前应触发的动作；`none` = 没有可撤可放的改动。 */
  readonly action: TurnAction
  /** 无法撤回 / 重放的文件数。 */
  readonly blocked: number
}

/** 单个文件的处理结果。 */
export interface FileActionResult {
  /** 该文件在工具参数里的路径原文。 */
  readonly path: string
  /** 是否成功（含幂等：本来就在目标状态）。 */
  readonly ok: boolean
  /** 失败原因码。 */
  readonly code: string | null
  /** 失败原因说明。 */
  readonly message: string | null
  /**
   * 操作前磁盘内容与插件记录的期望内容不一致（被手工编辑或后续回合改过），
   * 本次操作已把不覆盖；无从判断时为 null。
   */
  readonly dirty: boolean | null
}

/** `revert` / `reapply` 的返回体。 */
export interface ActionOutcome {
  /** 每个目标文件的处理结果（跳过的不计入）。 */
  readonly results: readonly FileActionResult[]
  /** 动作完成后的最新视图。 */
  readonly view: TurnChangesView
}

/** 客户端失败结果（`ConnectionRpcFailure` 的窄化投影）。 */
export interface RpcFailure {
  readonly code: string
  readonly message: string
}

/** 客户端 RPC 结果（`ConnectionRpcResult` 的窄化投影）。 */
export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcFailure }
