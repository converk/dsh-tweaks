/**
 * dsh-tweaks-turn-file-revert — 浏览器半区入口。
 *
 * 向 `conversation.input.overlay`（composer 卡片内的浮层列表，**session 作用域**）
 * 注册一个常驻隐藏锚点：它拿到当前会话的 `sessionId` 后，把「官方『本轮文件改动』
 * 行之后那一行」通过 DOM 增补插进转写区（见 `augment.ts` 里对席位选择的说明）。
 *
 * 依赖：
 * - `slots` 必须声明为硬依赖。client bundle 的入口插件没有 `inject` 时会立刻激活，
 *   此时 `slots` 可能还没被 ui-renderer 提供，插件会静默什么都不注册。
 * - `locale` 用来注册 zh/en 文案（缺失时退回 key）。
 * - `connection` **不声明为硬依赖**：它只是第一条传输，取不到时 `api.ts` 会自动回落到
 *   宿主注册的 `/api` 精确 Fetch 路由（`ctx.get` 本来就允许读未声明的可选服务）。
 */
import { createElement } from 'react'
import { TurnRevertAnchor } from './anchor.js'
import { createTurnRevertApi } from './api.js'
import { en, LOCALE_NS, zh } from './locales.js'
import { ensureStyles } from './styles.js'
import type { LocaleLike, PluginClientContextLike, SlotsServiceLike, Translate } from './types.js'

/** 本插件在 overlay 列表中的条目 id（新 id，不替换任何官方条目）。 */
export const OVERLAY_ENTRY_ID = 'turn-file-revert'

/** 硬依赖：席位与文案。 */
export const inject = ['slots', 'locale']

/** 把一个可能返回 disposer 的调用结果收成可调用 disposer。 */
function asDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => undefined
}

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: PluginClientContextLike): void {
  ensureStyles()

  const locale = ctx.get('locale') as LocaleLike | undefined
  if (locale !== undefined && locale !== null) {
    const register = (): (() => void) => {
      const disposers: (() => void)[] = []
      try {
        disposers.push(asDisposer(locale.register(LOCALE_NS, 'zh', zh)))
        disposers.push(asDisposer(locale.register(LOCALE_NS, 'en', en)))
      } catch {
        // 同一页面重复 apply（HMR）时命名空间已被占用：保留既有字典即可。
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }
    if (typeof ctx.effect === 'function') ctx.effect(register, 'turn-file-revert: dictionaries')
    else register()
  }

  const bound = locale?.bind(LOCALE_NS)
  const t: Translate = bound ?? ((key: string) => key)
  const api = createTurnRevertApi(ctx)

  const slots = ctx.get('slots') as SlotsServiceLike | undefined
  if (slots === undefined || slots === null) return
  slots.inject('conversation.input.overlay', () =>
    slots.register({ name: 'conversation.input.overlay', id: OVERLAY_ENTRY_ID, order: 90 }, (props) =>
      createElement(TurnRevertAnchor, {
        ...(props as { sessionId?: string | undefined }),
        api,
        t,
      }),
    ),
  )
}
