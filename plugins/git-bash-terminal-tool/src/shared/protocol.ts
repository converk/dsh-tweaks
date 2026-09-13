/**
 * host / client 共用的协议定义（纯数据，无 node / DOM / React 依赖）。
 *
 * 只走 `/api` 下的精确 Fetch 路由（AGENTS.md §2.4）：
 * - `POST /api/dsh-tweaks-terminal/state`   读当前状态（平台、能力探测结果；**不扫描**）
 * - `POST /api/dsh-tweaks-terminal/discover` 重新扫描（纯查询、无副作用）
 *
 * 持久化不走这里 —— 浏览器半区用 `ctx.settingsScope.bind({ namespace })`
 * 直接读写 `terminal-tool` 段，host 的 `validate` 负责最终把关。
 */

/**
 * 本插件的设置命名空间（**不复用官方 `shell`**）。
 *
 * ⚠️ 包名已改名为 `dsh-tweaks-git-bash-terminal-tool`，这个 namespace 却**刻意**保持
 * `terminal-tool`：它是已经落盘的用户数据（`dialect` / `bashPath` / `bashCandidates`），
 * 改名等于把用户的选择与已发现的路径全部清空。locale 命名空间与设置行的 slot id 同理保持原名
 * （纯实现标识，改了只增加回归面）。
 */
export const SETTINGS_NAMESPACE = 'terminal-tool'

/** 状态端点路径。 */
export const ROUTE_STATE = '/api/dsh-tweaks-terminal/state'

/** 发现端点路径。 */
export const ROUTE_DISCOVER = '/api/dsh-tweaks-terminal/discover'

/** 终端工具方言。 */
export type Dialect = 'pwsh' | 'bash'

/** 一个候选（与 `host/discover.ts` 的 `BashCandidate` 同形，客户端只读子集）。 */
export interface CandidateView {
  readonly path: string
  readonly source: 'saved' | 'git-for-windows' | 'msys2' | 'cygwin' | 'git-path'
  readonly valid: boolean
  readonly version?: string
}

/** 宿主半区对一次会话替换尝试的结果（用于设置行的「当前版本不支持」提示）。 */
export interface ReplaceReport {
  /** 最近一次尝试的时间戳（epoch ms）。 */
  readonly at: number
  /** 是否成功完成了替换。 */
  readonly applied: boolean
  /** 失败/跳过的原因（成功时为 undefined）。 */
  readonly reason?: string
}

/**
 * `/state` 的返回值。
 *
 * ⚠️ 这里**故意不含候选**：扫描 Git Bash 要起 `where.exe` / `reg.exe` / `bash --version`
 * 子进程（秒级），而设置行每次挂载都会读一次 `/state`。候选只在用户点「自动发现」时
 * 由 `/discover` 现扫（`discover` 也是用户自己的选择，不是插件的自动行为）。
 */
export interface StateView {
  /** `process.platform` —— 需求 2 只在 win32 渲染该行。 */
  readonly platform: string
  /** `terminal-tool` namespace 是否已注册（设置行据此判断宿主半区是否挂上）。 */
  readonly namespaceRegistered: boolean
  /** host 读到的当前设置值（客户端以 settingsScope 为准，这里用于首次渲染的兜底）。 */
  readonly dialect: Dialect
  readonly bashPath: string
  /** host 侧能力探测：`agent/session-start` 的替换链路是否具备必要条件。 */
  readonly capability: CapabilityView
  /** 最近的替换尝试报告（有会话跑过才有）。 */
  readonly lastReplace?: ReplaceReport
}

/** host 侧能力探测结果（决定设置行是否显示「当前版本不支持」）。 */
export interface CapabilityView {
  /** 本部署是否具备替换的全部必要条件（win32 + settings + tools.restrict/register + systemPrompt）。 */
  readonly supported: boolean
  /** 不支持时的原因（面向用户的一句话）。 */
  readonly reason?: string
  /** `ctx.shell.sandboxMode`（advertise 沙箱升级字段的信号；undefined = 不 advertise）。 */
  readonly shellSandboxMode?: string
}

/** `/discover` 的返回值。 */
export interface DiscoverView {
  readonly candidates: readonly CandidateView[]
}
