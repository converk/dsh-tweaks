/**
 * DSH 客户端 Slot 体系的最小结构类型。
 *
 * 这些类型是对 DSH 真实契约（`@deepseek-ai/dsh-client-ui-slots` /
 * `@deepseek-ai/dsh-client-ui-chat` / `@deepseek-ai/dsh-client-ui-conversation`
 * 的 client contract）的**结构性窄化投影**：只保留本插件实际读取的叶子字段，
 * 避免为此引入对官方包的编译期依赖。字段形状以本机 DSH 0.1.2-rc.1 的
 * `lib/types/client/contract/*.d.ts` 为准。
 */

/** 快照选择器 hook：`useChat((snapshot) => value)`。 */
export type SnapshotSelectorHook<Snapshot> = <Result>(
  select: (snapshot: Snapshot) => Result,
  isEqual?: (a: Result, b: Result) => boolean,
) => Result

/** 会话快照中已定稿的节点（只关心用户输入两类）。 */
export interface PromptMessageLike {
  /** `user` = 常规用户消息；`steering` = 运行中插入的用户消息。 */
  readonly kind: 'user' | 'steering'
  /** 内容块投影；文本块的 `text` 为字符串。 */
  readonly content: readonly { readonly type: unknown; readonly text?: unknown }[]
}

/** Chat 目标快照（结构性窄化：只取 legacy 节点数组）。 */
export interface ChatSnapshotLike {
  readonly legacy: {
    readonly nodes: readonly unknown[]
  }
}

/** 发布的输入机状态（结构性窄化）。 */
export interface InputStateLike {
  /** 编辑器文档的剪贴板投影。 */
  readonly draft: string
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

/** 会话作用域 Slot 组件可用的公开输入动作（结构性窄化）。 */
export interface InputActionsLike {
  /** 整体替换草稿。 */
  setDraft(text: string): void
}

/**
 * `conversation.input.overlay` 列表项组件收到的 props：
 * 会话标准 props（由 Slot 运行时注入）+ 无业务 owner props。
 */
export interface OverlaySlotProps {
  readonly sessionId?: string | undefined
  readonly useChat?: SnapshotSelectorHook<ChatSnapshotLike> | undefined
  readonly useInput?: SnapshotSelectorHook<InputStateLike> | undefined
  readonly inputActions?: InputActionsLike | undefined
  /** 文案，由插件 apply 注入（不经 Slot 运行时）。 */
  readonly t?: Translate | undefined
}

/** 绑定到命名空间后的翻译函数（`{name}` 占位符由 locale 运行时插值）。 */
export type Translate = (key: string, params?: Record<string, string>) => string

/** `locale` 服务的最小面：注册字典 + 绑定命名空间。 */
export interface LocaleLike {
  register(namespace: string, language: string, dictionary: Record<string, string>): unknown
  bind(namespace: string): Translate
}

/** cordis 客户端上下文的最小面（本插件只用 `get`，`effect` 可选）。 */
export interface PluginClientContextLike {
  /** 读取可选服务；未挂载时为 undefined。 */
  get(name: string): unknown
  /** 登记一次随插件卸载而撤销的副作用；极简运行时可能没有。 */
  effect?(callback: () => (() => void) | void, label?: string): unknown
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
