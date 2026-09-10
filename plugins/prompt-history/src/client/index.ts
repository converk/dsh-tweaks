/**
 * dsh-tweaks-prompt-history — 浏览器半区入口。
 *
 * 向 `conversation.input.overlay`（composer 卡片内的浮层列表）注册一个
 * 常驻条目：常态为空，负责 ↑/↓ 键的历史提示词召回（详见 overlay.tsx）。
 * `slots.inject` 会等待 composer bar 挂载并声明该 Slot 后再注册，注册
 * 返回的 disposer 由注入回调原样交还，插件停止/更新时随之移除。
 */
import { createElement } from 'react'
import { PromptHistoryOverlay } from './overlay.js'
import type { OverlaySlotProps, PluginClientContextLike, SlotsServiceLike } from './types.js'

/** 本插件在 overlay 列表中的条目 id（不用官方已占用的 id，避免替换官方条目）。 */
export const OVERLAY_ENTRY_ID = 'prompt-history'

/**
 * 硬依赖：席位。
 *
 * ⚠️ client bundle 的入口插件**必须**声明 `inject`：没有它插件会立刻激活，此时
 * `slots` 可能还没被 ui-renderer 提供，`ctx.get('slots')` 拿到 undefined 就直接返回，
 * 结果是**静默什么都不注册**（AGENTS.md §2.2）。
 */
export const inject = ['slots']

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: PluginClientContextLike): void {
  const slots = ctx.get('slots') as SlotsServiceLike | undefined
  if (slots === undefined) return
  slots.inject('conversation.input.overlay', () =>
    slots.register({ name: 'conversation.input.overlay', id: OVERLAY_ENTRY_ID, order: 80 }, (props) =>
      createElement(PromptHistoryOverlay, props as OverlaySlotProps),
    ),
  )
}
