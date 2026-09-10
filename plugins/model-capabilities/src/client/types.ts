/**
 * DSH 客户端契约的最小结构类型。
 *
 * 这些类型是对本机 DSH 0.1.2-rc.1 真实契约的**结构性窄化投影**，只保留本插件
 * 实际读取的叶子字段，避免为此 import 任何官方包（运行时零依赖）：
 * - `settings.models.provider-card` 的 owner props 与 `ProviderDirectoryEntry`
 *   来自 `@deepseek-ai/dsh-client-ui-settings-models/lib/types/client/{slot-contract,store}.d.ts`；
 * - `ctx.remote.settings` 来自
 *   `@deepseek-ai/dsh-api-settings-controller/lib/typert.remote-client.d.ts`
 *   （每次一元调用解析为 `RemoteResult<T>` = `{ok:true,value}` | `{ok:false,error}`）；
 * - `SettingsNamespaceView` 来自 `@deepseek-ai/dsh-settings/lib/types/types.d.ts`；
 * - `ctx.locale` 的三参非类型化 `register` / `bind` 来自
 *   `@deepseek-ai/dsh-client-locale/lib/types/client/index.d.ts`；
 * - `slots.inject` / `slots.register` 来自 `@deepseek-ai/dsh-client-ui-slots`
 *   （部署内无运行时目录，形状以官方 runner 的 Slot 目录与 settings-models 的
 *   调用点为准）。
 *
 * **inject 注意**：`ctx.remote` 的子命名空间是 cordis Guard 代理，读
 * `ctx.remote.settings` 会被翻译成查询 `remote.settings` 服务；插件必须在
 * `inject` 里显式声明 `remote.settings`，否则加载期直接抛
 * `cannot get property "remote.settings" without inject`。入口里两个服务都声明，
 * 并优先用 `ctx.get('remote.settings')` 取。
 */
import type { SettingsPathOp } from './capability.js'

/** `ProviderDirectoryEntry`：提供方卡片所属目录行。 */
export interface ProviderDirectoryEntryLike {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  /** 指向 `providers.<route>` 的路径；写入一律用它，不硬编码。 */
  readonly settingsPath: readonly string[]
  readonly active?: boolean
  /** true = 用户自己声明（目录不 ships）；false = 目录 ships；absent = 适配器不分。 */
  readonly declared?: boolean
}

/** `settings.models.provider-card` 的 owner props。 */
export interface ProviderCardOwnerPropsLike {
  readonly provider: ProviderDirectoryEntryLike
  /** 是否已有任意层配置该提供方；添加卡片草稿期为 false。 */
  readonly configured: boolean
  /** 该行引用的 api-key 凭证是否已配置。 */
  readonly keyConfigured: boolean
}

/** `SettingsNamespaceView` 的窄化投影。 */
export interface SettingsNamespaceViewLike {
  readonly ns: string
  readonly value: unknown
  /** 用户层原始分节；字段存在即表示用户覆盖。 */
  readonly user?: unknown
  readonly base?: unknown
  readonly applies?: 'live' | 'restart'
  readonly revision: number
}

/** `SettingsDescribeValue` 的窄化投影。 */
export interface SettingsDescribeValueLike {
  readonly writable: boolean
  readonly hasDocument?: boolean
  readonly namespaces: readonly SettingsNamespaceViewLike[]
}

/** `RemoteError` 的窄化投影。 */
export interface RemoteFailureLike {
  readonly code?: string
  readonly message?: string
}

/** 一元远程调用的结果（载体故障折入错误分支，不会 reject）。 */
export type RemoteResultLike<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error?: RemoteFailureLike }

/** 面板侧统一的结果投影。 */
export type RemoteOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** `ctx.remote.settings` 的窄化投影。 */
export interface SettingsRemoteLike {
  describe(): Promise<RemoteResultLike<SettingsDescribeValueLike>>
  mutate(
    ns: string,
    ops: readonly SettingsPathOp[],
    expectedRevision: number | undefined,
  ): Promise<RemoteResultLike<SettingsNamespaceViewLike>>
}

/** `ctx.remote` 的窄化投影（本插件只用 settings 与事件订阅）。 */
export interface RemoteLike {
  readonly settings?: SettingsRemoteLike
  /** 订阅 Host 转发的设置变更；返回取消订阅。 */
  $on?(event: string, listener: (...args: unknown[]) => void): () => void
}

/** `ctx.locale` 的窄化投影（三参非类型化形态 + bind）。 */
export interface LocaleLike {
  register(ns: string, locale: string, dict: Record<string, string>): unknown
  bind(ns: string): (key: string, params?: Record<string, string | number>) => string
}

/** `slots` 服务的窄化投影（本插件只注入 + 注册一个 keyed 条目）。 */
export interface SlotsServiceLike {
  inject(key: string, callback: () => unknown): unknown
  register(
    options: {
      name: string
      key?: string
      id?: string
      order?: number
      label?: string | (() => string)
    },
    component: (props: unknown) => unknown,
  ): unknown
}

/** cordis 客户端上下文的最小面（只取本插件实际使用的服务）。 */
export interface PluginClientContextLike {
  get(name: string): unknown
  effect?(callback: () => void | (() => void)): unknown
}

/** 插件绑定的 Host 操作与文案（由 client 入口按插件生命周期构造一次）。 */
export interface CapabilityApi {
  /** `ctx.remote.settings.describe()`。 */
  describe(): Promise<RemoteOutcome<SettingsDescribeValueLike>>
  /** `ctx.remote.settings.mutate()`。 */
  mutate(
    ns: string,
    ops: readonly SettingsPathOp[],
    expectedRevision: number | undefined,
  ): Promise<RemoteOutcome<SettingsNamespaceViewLike>>
  /** 订阅该 ns 的 `settings/document-updated`；回调带新 revision（不可得时 undefined）。 */
  onSettingsChanged(ns: string, listener: (revision: number | undefined) => void): () => void
  /** 绑定的翻译函数（读取调用时的活动语言）。 */
  t(key: string, params?: Record<string, string | number>): string
}

/** 席位组件的完整 props：owner props + 插件绑定的操作面。 */
export interface PanelProps extends ProviderCardOwnerPropsLike {
  readonly api: CapabilityApi
}
