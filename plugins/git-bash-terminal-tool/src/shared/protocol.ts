/**
 * host / client 共用的协议定义（纯数据，无 node / DOM / React 依赖）。
 *
 * 只走 `/api` 下的精确 Fetch 路由（AGENTS.md §2.4）：
 * - `POST /api/dsh-tweaks-terminal/state`   读当前状态（平台、能力探测结果；**不扫描**）
 * - `POST /api/dsh-tweaks-terminal/discover` 重新扫描（纯查询、无副作用）
 *
 * 持久化不走这里 —— 浏览器半区把本插件 entry Config 的表单绑定到 `webUiSettings`，
 * 由 host 的 `settings.update/mutate` 落盘（见 `SETTINGS_NAMESPACE`）。
 */

/**
 * 设置表单的 namespace —— **就是本插件的 profile entry id**。
 *
 * 0.1.7 起 DSH 的设置模型是「插件 entry 自己的 Config」，表单按 entry id 定位；
 * 浏览器半区的 `webUiSettings.bind({ namespace })` 也只有在 namespace 命中一个
 * 已服务 entry id 时才会提升到原生共享表单。所以这个值必须与
 * `cordis.patch.yml` 里 insert 的 `id` 逐字一致。
 *
 * locale 命名空间与设置行的 slot id 仍叫 `terminal-tool`（纯实现标识，不参与设置寻址）。
 */
export const SETTINGS_NAMESPACE = 'git-bash-terminal-tool'

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
  /** 宿主设置服务是否可见（设置行据此判断表单是否可写）。 */
  readonly settingsAvailable: boolean
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
