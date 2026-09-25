/**
 * 浏览器半区用到的 DSH 契约的**结构性窄化投影**。
 *
 * 与 host/types.ts 同样的纪律（AGENTS.md §2.8）：client bundle 只允许 `require`
 * 页面种子模块（`react` / `react/jsx-runtime`），所以这里不 import 任何
 * `@deepseek-ai/*` 类型包，只按真实契约的形状窄化。字段形状以本机 DSH
 * 0.1.5-rc.1 / 0.1.7-rc.2 部署的 `lib/types/client/**` 为准：
 *
 * - `slots.inject/register`：`dsh-client-ui-slots/lib/types/client/index.d.ts`
 * - `settings.general.item` 的 owner props 为空：`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`
 * - 设置通道 `bind`：0.1.5 由官方 `dsh-client-ui-settings` 的 `settingsScope` 提供；
 *   0.1.7 起官方客户端**不再提供**该服务，改由家族兼容层
 *   `@linxin666/dsh-client-ui-web-ui-settings` 的 `webUiSettings` 提供。0.1.7 起
 *   namespace 必须是 **profile entry id**（原生表单按 entry id 定位）。
 * - `locale.register/bind`：`dsh-client-locale/lib/types/client/*.d.ts`
 */

/** 绑定到命名空间后的翻译函数（`{name}` 占位符由 locale 运行时插值）。 */
export type Translate = (key: string, params?: Record<string, string>) => string

/** `locale` 服务的最小面。 */
export interface LocaleLike {
  register(namespace: string, language: string, dictionary: Record<string, string>): unknown
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
  bind(namespace: string): Translate
}

/** 槽位注册选项（只用到本插件需要的字段）。 */
export interface SlotRegisterOptionsLike {
  readonly name: string
  readonly id: string
  readonly order: number
  readonly locale?: string
}

/** `slots` 服务的最小面。 */
export interface SlotsServiceLike {
  inject(key: string, callback: () => unknown): unknown
  register(options: SlotRegisterOptionsLike, component: (props: unknown) => unknown): unknown
}

/**
 * `settingsScope.bind({ namespace })` 返回的 scope 的快照。
 *
 * ⚠️ 客户端 `SettingsScopeBinder` 是「在注册时刻绑定调用方 ctx」的 cordis 服务代理，
 * 因此 `bind` 必须在插件自己的 ctx 上调用（不要在回调里换 ctx）。
 */
export interface SettingsScopeSnapshotLike<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
  readonly base: unknown
  readonly user: unknown
  readonly revision: number | undefined
  readonly writable: boolean
  readonly mode: 'host' | 'memory'
}

/** 一个 namespace 的客户端 scope。 */
export interface SettingsScopeLike<T> {
  getSnapshot(): SettingsScopeSnapshotLike<T>
  subscribe(listener: () => void): () => void
  /**
   * 提交一批字段编辑。
   *
   * ⚠️ 返回值随宿主版本不同：0.1.7 的原生表单 resolve `false` 表示**宿主拒绝了**
   * 这次写入（revision 冲突 / 字段非 volatile），旧 `settingsScope` 只 resolve
   * `undefined`。所以类型是 `unknown`，调用方显式判 `false`（见 `store.ts`）。
   */
  mutate(
    ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[],
    expectedRevision?: number,
  ): Promise<unknown>
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

/**
 * 一个 namespace 的绑定规格（`SettingsScopeSpec` 的窄化）。
 *
 * `decode` 缺省时，客户端会用 entry Config 的 wire schema 校验 section；
 * 这里显式给一个 decoder：读值只依赖 host 真正存了什么，不受表单 schema 投影影响。
 */
export interface SettingsScopeSpecLike<T> {
  readonly namespace: string
  readonly decode?: (section: unknown) => T | undefined
}

/**
 * 官方 0.1.7 原生设置表单服务（`dsh-client-ui-settings` 的 `configForms`）。
 *
 * `get(entryId)` 返回的 `ConfigForm` 与本文件的 `SettingsScopeLike` 同形
 * （快照 / 订阅 / `mutate` / `set` / `unset`），所以两者可以互换使用：
 * 没有家族兼容层 `webUiSettings` 的普通 0.1.7 部署直接走这条路。
 */
export interface ConfigFormsLike {
  /** 取一个 profile entry 的表单；entry 尚未被服务时可能抛错（调用方判空/兜底）。 */
  get<T>(entryId: string): SettingsScopeLike<T>
}

/**
 * 设置通道 binder 的最小面。
 *
 * 服务名随宿主版本变化（见文件头）：0.1.7 起是 `webUiSettings`，0.1.5 是
 * `settingsScope`；两者都满足本接口。
 */
export interface SettingsScopeBinderLike {
  bind<T>(spec: SettingsScopeSpecLike<T>): SettingsScopeLike<T>
}

/** cordis 客户端上下文的最小面（本插件只用到 `get` / `effect` / `inject`）。 */
export interface PluginClientContextLike {
  get(name: string): unknown
  effect?(callback: () => (() => void) | void, label?: string): unknown
  /** 注册一个等服务就位后再跑的子插件（`ctx.plugin({ inject, apply })` 的简写）。 */
  inject?(services: readonly string[], callback: () => void): unknown
}
