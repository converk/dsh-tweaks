/**
 * 浏览器半区用到的 DSH 契约的**结构性窄化投影**。
 *
 * 与 host/types.ts 同样的纪律（AGENTS.md §2.8）：client bundle 只允许 `require`
 * 页面种子模块（`react` / `react/jsx-runtime`），所以这里不 import 任何
 * `@deepseek-ai/*` 类型包，只按真实契约的形状窄化。字段形状以本机 DSH 0.1.5-rc.1
 * 部署的 `lib/types/client/**` 为准：
 *
 * - `slots.inject/register`：`dsh-client-ui-slots/lib/types/client/index.d.ts`
 * - `settings.general.item` 的 owner props 为空：`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`
 * - `settingsScope.bind`：`dsh-client-ui-settings/lib/types/client/settings-scope.d.ts`
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
  mutate(
    ops: readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[],
    expectedRevision?: number,
  ): Promise<void>
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/**
 * 一个 namespace 的绑定规格（`SettingsScopeSpec` 的窄化）。
 *
 * `decode` 缺省时，客户端会用 **namespace 自己的 wire schema** 校验 section；
 * 这里显式给一个 decoder：读值不再依赖那份手写 schema 的正确性（wire schema 只服务
 * 配置表单）。schema 一旦漂了，缺省路径会让快照永远卡在 `loading` ——
 * 表现就是「设置行两个选项全都点不动、却看不出任何报错」。
 */
export interface SettingsScopeSpecLike<T> {
  readonly namespace: string
  readonly decode?: (section: unknown) => T | undefined
}

/** `settingsScope` 服务的最小面。 */
export interface SettingsScopeBinderLike {
  bind<T>(spec: SettingsScopeSpecLike<T>): SettingsScopeLike<T>
}

/** cordis 客户端上下文的最小面（本插件只用到 `get` / `effect`）。 */
export interface PluginClientContextLike {
  get(name: string): unknown
  effect?(callback: () => (() => void) | void, label?: string): unknown
}
