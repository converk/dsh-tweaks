/**
 * 列表自动续号 — `conversation.input.overlay` 列表项组件。
 *
 * 行为：在列表行（`1. 事项`、`1) 事项`、`1、事项`、`- 事项` 等）上按
 * **Shift+Enter** 时，接管这次换行，在光标处插入「换行 + 下一个标记」，
 * 例如 `1. 事项|` → `1. 事项\n2. |`，于是新的一行直接接着写第二条。
 *
 * - 只处理 Shift+Enter（DSH 里普通 Enter 是发送）；带 Ctrl/Meta/Alt 的组合放行。
 * - IME 组合期（`isComposing` / keyCode 229）不接管。
 * - 只在自己所在的 composer 卡片（`[data-composer-card]`）内、且光标在
 *   contenteditable 里时生效；有选区（非折叠）时不接管。
 * - 非列表行、空条目（`2. ` 后面还没写正文）都放行给编辑器，插入普通换行。
 * - 插入走官方公开的 `inputActions.captureInsertion()` / `insertText()`，
 *   不动草稿里的 `@` / `/` 引用 chip，也不整段重写草稿。
 *
 * DOM 判据 `[data-composer-card]` / `contenteditable="true"` 是运行时产物里的
 * 真实结构（见 README §DSH 兼容性），不在任何 d.ts 里，升级 DSH 后要复核。
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { lineTextBeforeCaret } from '../shared/line.js'
import { nextListMarker } from '../shared/list.js'
import type { DomNodeLike } from '../shared/line.js'
import type { OverlaySlotProps } from './types.js'

/** composer 卡片判据（官方运行时写在 composer bar 的卡片节点上）。 */
const COMPOSER_CARD_SELECTOR = '[data-composer-card]'

/** 可编辑根判据（Lexical 给 contenteditable 根元素写的属性值）。 */
const EDITABLE_SELECTOR = '[contenteditable="true"]'

/** 本插件自有 DOM 的标记属性（自有元素统一带一个 data-* 标记，便于排查/清理）。 */
export const OVERLAY_MARKER_ATTRIBUTE = 'data-dsh-smart-list'

/** 渲染层传入的会话标准 props 里，事件回调要读的最新值。 */
interface LatestState {
  readonly phase: string | undefined
  readonly inputActions: OverlaySlotProps['inputActions']
}

/**
 * 把真实 DOM 节点投影成 `lineTextBeforeCaret` 需要的结构形状。
 * @param node - 真实 DOM 节点。
 * @returns 同一个节点的结构投影。
 */
function asDomNode(node: Node): DomNodeLike {
  return node as unknown as DomNodeLike
}

/** overlay 列表项：常态渲染一个隐藏锚点，负责键盘接管。 */
export function SmartListOverlay(props: OverlaySlotProps): ReactElement {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const phase = props.useInput?.((snapshot) => snapshot.phase)
  const latest = useRef<LatestState>({ phase, inputActions: props.inputActions })
  latest.current = { phase, inputActions: props.inputActions }

  useEffect(() => {
    /**
     * Shift+Enter 接管：只在这个组件所在 composer 卡片内的列表行生效。
     * @param event - 捕获相的键盘事件。
     */
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter' || event.shiftKey !== true) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.isComposing || event.keyCode === 229) return

      const anchor = anchorRef.current
      if (anchor === null) return
      const card = anchor.closest(COMPOSER_CARD_SELECTOR)
      if (card === null) return

      const selection = document.getSelection()
      if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return
      const anchorNode = selection.anchorNode
      if (anchorNode === null) return
      const element = anchorNode.nodeType === 1 ? (anchorNode as Element) : anchorNode.parentElement
      if (element === null) return
      const editable = element.closest(EDITABLE_SELECTOR)
      if (editable === null || !card.contains(editable)) return

      const { phase: currentPhase, inputActions } = latest.current
      if (inputActions === undefined) return
      // 相位未知（极早期快照）也放行给 insertText 自己的相位守卫。
      if (currentPhase !== undefined && currentPhase !== 'plain') return

      const line = lineTextBeforeCaret(asDomNode(editable), asDomNode(anchorNode), selection.anchorOffset)
      if (line === null) return
      const marker = nextListMarker(line)
      if (marker === null) return

      const span = inputActions.captureInsertion()
      if (span.start !== span.end) return
      if (!inputActions.insertText('\n' + marker, span)) return
      // 关键：Lexical 的 KEY_ENTER_COMMAND 处理器（优先级 0）会把 Shift+Enter
      // 继续处理成「插入软换行」，而且它监听在 composer 的根元素上。这里已经
      // 自己插入了「换行 + 下一个标记」，必须阻止事件继续传播，否则会再插一个
      // 软换行（表现为新标记后面多出一行、光标错位）。
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return <div ref={anchorRef} {...{ [OVERLAY_MARKER_ATTRIBUTE]: '' }} style={{ display: 'none' }} />
}
