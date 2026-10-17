/**
 * dsh-tweaks-smart-list — 浏览器半区入口。
 *
 * 向 `conversation.input.overlay`（composer 卡片内的浮层列表）注册一个常驻条目：
 * 常态渲染隐藏锚点，负责接管列表行上的 Shift+Enter（详见 overlay.tsx）。
 * `slots.inject` 会等待 composer bar 挂载并声明该 Slot 后再注册，注册返回的
 * disposer 由注入回调原样交还，插件停止/更新时随之移除。
 */
import { createElement } from 'react'
import { SmartListOverlay } from './overlay.js'
import type { OverlaySlotProps, PluginClientContextLike, SlotsServiceLike } from './types.js'

/** 本插件在 overlay 列表中的条目 id（不用官方已占用的 id，避免替换官方条目）。 */
export const OVERLAY_ENTRY_ID = 'smart-list'

/**
 * 硬依赖：席位。
 *
 * ⚠️ client bundle 的入口插件**必须**声明 `inject`：没有它插件会立刻激活，此时
 * `slots` 可能还没被 ui-renderer 提供，`ctx.get('slots')` 拿到 undefined 就直接返回，
 * 结果是**静默什么都不注册**（AGENTS.md §3.3）。
 * `inputActions` / `useInput` 是 Slot 注入的标准 props，不是客户端服务，不能写进 inject。
 */
export const inject = ['slots']

/** 把一个可能返回 disposer 的调用结果收成可调用 disposer。 */
function asDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => undefined
}

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: PluginClientContextLike): void {
  const slots = ctx.get('slots') as SlotsServiceLike | undefined
  if (slots === undefined || slots === null) return
  const install = (): (() => void) =>
    asDisposer(
      slots.inject('conversation.input.overlay', () =>
        slots.register({ name: 'conversation.input.overlay', id: OVERLAY_ENTRY_ID, order: 60 }, (props) =>
          createElement(SmartListOverlay, { ...(props as OverlaySlotProps) }),
        ),
      ),
    )
  if (typeof ctx.effect === 'function') ctx.effect(install, 'smart-list: composer overlay')
  else install()
}
