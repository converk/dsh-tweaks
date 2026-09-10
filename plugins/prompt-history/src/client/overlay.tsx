/**
 * 输入框历史提示词召回 — `conversation.input.overlay` 列表项组件。
 *
 * 行为（终端式历史）：
 * - ↑ 在草稿为空时进入浏览：从最近一条已发送的用户提示词开始回填草稿；
 * - 浏览中 ↑ 逐条向更早切换，↓ 向最近切换，越过最新一条时恢复进入
 *   浏览前的草稿；
 * - 浏览中直接编辑草稿或提交即退出浏览；
 * - 历史来源是当前会话的持久用户消息（`useChat` 快照的 `user` /
 *   `steering` 节点），因此页面刷新后历史仍在。
 *
 * 键盘拦截只作用于自己所在的 composer 卡片（`data-composer-card`）
 * 内的内容可编辑元素，且避开 IME 组合期与修饰键，不影响斜杠/引用
 * 菜单的 ↑/↓（那些只在草稿非空时出现）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { ChatSnapshotLike, OverlaySlotProps, PromptMessageLike } from './types.js'

/** 保留的最多历史条数（超出丢弃最早的）。 */
const HISTORY_LIMIT = 200

/** 浏览状态（ref 内的可变导航游标，避免箭头连按时闭包读到旧值）。 */
interface NavigationState {
  /** 当前浏览的历史下标；null 表示未在浏览。 */
  index: number | null
  /** 进入浏览前的草稿，越过最新一条时恢复。 */
  backup: string
  /** 一次性标记：下一次 draft 变化由 setDraft 自身造成。 */
  selfWrite: boolean
}

/** 从会话节点里提取去重后的用户提示词历史（时间正序）。 */
export function extractHistory(nodes: readonly unknown[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const kind = (node as { kind?: unknown }).kind
    if (kind !== 'user' && kind !== 'steering') continue
    const message = node as PromptMessageLike
    if (!Array.isArray(message.content)) continue
    let text = ''
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string') {
        text += block.text
      }
    }
    text = text.trim()
    if (text === '') continue
    const previous = out.length > 0 ? out[out.length - 1] : undefined
    if (text === previous) continue
    out.push(text)
  }
  return out.length > HISTORY_LIMIT ? out.slice(-HISTORY_LIMIT) : out
}

/** 浏览中的提示角标样式（浮在 composer 卡片右上角，不可交互）。 */
const pillStyle: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 12,
  zIndex: 6,
  pointerEvents: 'none',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  fontSize: 12,
  lineHeight: '16px',
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18))',
  color: 'var(--dsw-alias-label-secondary, inherit)',
}

/** overlay 列表项：常态渲染空锚点，浏览中渲染位置角标。 */
export function PromptHistoryOverlay(props: OverlaySlotProps): ReactElement | null {
  const { useChat, useInput, inputActions, sessionId } = props

  // 数据源：会话已定稿节点（选择器返回数组本身，引用稳定时不再重渲染）。
  const nodes = useChat?.((snapshot: ChatSnapshotLike) => snapshot.legacy.nodes)
  const phase = useInput?.((snapshot) => snapshot.phase)
  const draft = useInput?.((snapshot) => snapshot.draft)

  const history = useMemo(() => (nodes === undefined ? [] : extractHistory(nodes)), [nodes])

  const anchorRef = useRef<HTMLDivElement | null>(null)
  const nav = useRef<NavigationState>({ index: null, backup: '', selfWrite: false })
  const [, setTick] = useState(0)
  const bump = (): void => setTick((tick) => tick + 1)

  // 事件回调内读取的最新值。
  const latest = useRef({ history, phase, draft, inputActions })
  latest.current = { history, phase, draft, inputActions }

  const exitBrowse = (): void => {
    if (nav.current.index === null) return
    nav.current.index = null
    nav.current.backup = ''
    bump()
  }

  // 切换会话：浏览游标作废（历史本身随会话作用域的 useChat 自动切换）。
  useEffect(exitBrowse, [sessionId])

  // 草稿变化若不是自己的 setDraft 造成，说明用户开始编辑 → 退出浏览
  // （保留已编辑的草稿，即终端里“回忆后直接改”的体验）。
  useEffect(() => {
    if (nav.current.selfWrite) {
      nav.current.selfWrite = false
      return
    }
    exitBrowse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // 提交开始（任一非 plain 相位）即退出浏览。
  useEffect(() => {
    if (phase !== 'plain') exitBrowse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.isComposing || event.keyCode === 229) return

      // 作用域：事件必须来自本组件所驻 composer 卡片内的可编辑元素。
      const anchor = anchorRef.current
      if (anchor === null) return
      const card = anchor.closest('[data-composer-card]')
      if (card === null) return
      const target = event.target
      if (!(target instanceof HTMLElement) || !card.contains(target) || !target.isContentEditable) return

      const { history, phase, draft, inputActions } = latest.current
      if (inputActions === undefined || phase !== 'plain') return
      const currentDraft = draft ?? ''

      const state = nav.current
      // 历史可能在浏览中被截短，先做钳制。
      if (state.index !== null && state.index >= history.length) exitBrowse()

      const write = (text: string): void => {
        state.selfWrite = true
        inputActions.setDraft(text)
      }

      if (event.key === 'ArrowUp') {
        if (state.index === null) {
          // 只在草稿为空时接管，避免与斜杠/引用菜单及编辑冲突。
          if (currentDraft.trim() !== '' || history.length === 0) return
          state.index = history.length - 1
          state.backup = currentDraft
          const entry = history[state.index]
          if (entry !== undefined) write(entry)
        } else if (state.index > 0) {
          state.index -= 1
          const entry = history[state.index]
          if (entry !== undefined) write(entry)
        }
        event.preventDefault()
        event.stopPropagation()
        bump()
        return
      }

      // ArrowDown：仅在浏览中接管。
      if (state.index === null) return
      const lastIndex = history.length - 1
      if (state.index < lastIndex) {
        state.index += 1
        const entry = history[state.index]
        if (entry !== undefined) write(entry)
      } else {
        // 越过最新一条：恢复进入浏览前的草稿。
        write(state.backup)
        state.index = null
        state.backup = ''
      }
      event.preventDefault()
      event.stopPropagation()
      bump()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const index = nav.current.index
  if (index === null || history[index] === undefined) return <div ref={anchorRef} />
  return (
    <div ref={anchorRef}>
      <div style={pillStyle} title="历史提示词（↑ / ↓ 切换）">
        {'\u2191\u2193 '}
        {`历史 ${index + 1}/${history.length}`}
      </div>
    </div>
  )
}
