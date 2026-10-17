/**
 * DSH 客户端 Slot 体系的最小结构类型。
 *
 * 这些类型是对 DSH 真实契约（`@deepseek-ai/dsh-client-ui-conversation` 的 client
 * contract）的**结构性窄化投影**：只保留本插件实际读取的叶子字段，避免为此引入
 * 对官方包的编译期依赖。字段形状以 DSH **0.2.1** 完整安装的
 * `lib/types/client/contract/{slots,input}.d.ts` 为准（0.2.0 – 0.2.1 契约审计：
 * 本文件读取的全部叶子字段未变）。
 * 未受类型保护的运行时依赖（Slot 注入 props、`[data-composer-card]` 与
 * `[contenteditable]` DOM 判据、`insertText` 允许字面换行）见 README §DSH 兼容性。
 */

/** 快照选择器 hook：`useInput((snapshot) => value)`。 */
export type SnapshotSelectorHook<Snapshot> = <Result>(
  select: (snapshot: Snapshot) => Result,
  isEqual?: (a: Result, b: Result) => boolean,
) => Result

/** 发布的输入机状态（结构性窄化：只取相位）。 */
export interface InputStateLike {
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

/** 选区跨度（detect 投影坐标；官方 TokenSpan 还带 draftRev，插件只比较折叠与位置）。 */
export interface TokenSpanLike {
  readonly start: number
  readonly end: number
}

/** 会话作用域 Slot 组件可用的公开输入动作（结构性窄化）。 */
export interface InputActionsLike {
  /** 把当前编辑器选区快照成跨度。 */
  captureInsertion(): TokenSpanLike
  /** 在捕获的跨度处插入纯文本（一个字面 `\n` 就是一行）；返回是否成功。 */
  insertText(text: string, span: TokenSpanLike): boolean
}

/**
 * `conversation.input.overlay` 列表项组件收到的 props：
 * 会话标准 props（由 Slot 运行时注入）+ 无业务 owner props。
 */
export interface OverlaySlotProps {
  readonly useInput?: SnapshotSelectorHook<InputStateLike> | undefined
  readonly inputActions?: InputActionsLike | undefined
}

/** cordis 客户端上下文的最小面（本插件只用 `get`）。 */
export interface PluginClientContextLike {
  /** 读取可选服务；未挂载时为 undefined。 */
  get(name: string): unknown
}

/** `slots` 服务的最小面（本插件只注入 + 注册一个列表项）。 */
export interface SlotsServiceLike {
  inject(key: string, callback: () => unknown): unknown
  register(
    options: {
      name: string
      id?: string
      order?: number
      label?: string | (() => string)
    },
    component: (props: unknown) => unknown,
  ): unknown
}
