/**
 * 官方「本轮文件改动」行的**增补**层（DOM 增补，不占任何官方 Slot 席位）。
 *
 * 为什么不用 Slot：
 * - 官方产物行渲染在 `conversation.chat.turnTail` 这个 **chain** 席位上，由
 *   `@deepseek-ai/dsh-client-ui-deliverables` 占据；chain 是「第一个接受 owner
 *   的选择器渲染」，本插件永远轮不到，硬抢还会顶掉官方那行。
 * - `conversation.chat.assistant-actions`（动作条）虽然是 list 席位，但它在
 *   官方动作条内部、老回合整条要 hover 才显形，做不出「紧跟文件行的一行」。
 * 因此这里走与本仓库 model-capabilities 相同的增量路线：注册一个隐藏锚点拿到
 * 会话身份，再观察转写区，把这一行**插到官方产物行之后、动作条之前**。
 *
 * 位置判据都取官方自己写在 DOM 上的稳定属性：
 * - `[data-turn-tail="<turn>"]`：官方 TurnTailNodeView 的根（它同时带回合号）；
 * - `[data-produced-files-row]`：官方产物行的行元素。
 * 两者都是官方用于自身布局/交互观测的标记，比哈希类名稳定得多。
 *
 * ⚠️ 官方产物行只认**模型根调用**：它的 definition 用 `session/event` 的
 * `tool/call` 建 callId → path 映射，而 Code Dispatch（`run_code` 里的子调用）
 * 只发 `tool/ptc-dispatch`。所以在 PTC 会话里官方那一行根本不出现——此时本插件
 * 退回「动作条之前」渲染，否则会一行都不显示（数据来自宿主侧的
 * `tools/pre-execute|post-execute`，本来就不依赖官方行）。
 *
 * 数据全部来自宿主：本层只负责「哪些回合有可挂载的位置」「这一行现在该显示什么」。
 */
import { displayPathsOf } from '../shared/path.js'
import type { TurnChangesView } from '../shared/protocol.js'
import type { Translate, TurnRevertApi } from './types.js'
import { ensureStyles } from './styles.js'

/** 本插件所有自有元素都带这个属性（观察器据此忽略自己的写入，避免自激）。 */
const ROOT_ATTR = 'data-dsh-tfr'

/** 官方回合尾部的根元素（值 = 回合号）。 */
const TAIL_SELECTOR = '[data-turn-tail]'

/** 官方「本轮文件改动」行。 */
const PRODUCED_SELECTOR = '[data-produced-files-row]'

/**
 * 官方写在回合尾部根上的「是不是本会话最后一次对话」标记：
 * `always` = 最后一场对话，`hover` = 更早的回合（老回合整条 hover 才显形）。
 */
const LATEST_ATTR = 'data-actions-reveal'

/** tooltip 里最多列几个文件。 */
const MAX_TIP_FILES = 20

/** 注入所需的事实。 */
export interface AugmentOptions {
  /** 当前会话 id（标准 props 注入）。 */
  readonly sessionId: string
  /** 宿主 RPC 门面。 */
  readonly api: TurnRevertApi
  /** 文案。 */
  readonly t: Translate
}

/** 卸载句柄。 */
export interface AugmentHandle {
  /** 移除本插件插入的全部 DOM 并停止观察。 */
  dispose(): void
}

/** 一行的界面状态。 */
interface TurnEntry {
  readonly turn: number
  readonly root: HTMLElement
  /** 最前面的说明句（「本轮改动情况：」）。 */
  readonly label: HTMLElement
  readonly added: HTMLElement
  readonly removed: HTMLElement
  readonly files: HTMLElement
  readonly button: HTMLButtonElement
  readonly status: HTMLElement
  /** 当前挂载在哪个官方节点下（React 重建节点后要重新插入）。 */
  tail: HTMLElement | null
  view: TurnChangesView | null
  loading: boolean
  /** 宿主已明确表示「该回合没有追踪记录」：不再重复请求。 */
  untracked: boolean
  busy: boolean
  /** 该回合是不是本会话的最后一次对话（只有它才允许撤回/恢复）。 */
  latest: boolean
  /** 状态行文本与语义。 */
  note: string
  noteKind: 'none' | 'ok' | 'error'
}

/** 建一个自有的 span。 */
function span(className: string, attr: string): HTMLSpanElement {
  const node = document.createElement('span')
  node.className = className
  node.setAttribute(ROOT_ATTR, attr)
  return node
}

/** 建这一行的 DOM 骨架（只建一次，之后只改文本/属性）。 */
function buildEntry(turn: number): TurnEntry {
  const root = document.createElement('div')
  root.className = 'dshTfr_root'
  root.setAttribute(ROOT_ATTR, 'root')
  root.hidden = true

  // 视觉上分三部分：① 增减行数（说明句与数字同属这一部分，用 stats 自己的小 gap）
  // ② 文件数 ③ 按钮。①②③ 都是 root 的直接子节点，由 root 的 gap 拉开；label 在 ① 内部。
  const stats = span('dshTfr_stats', 'stats')
  const label = span('dshTfr_label', 'label')
  const added = span('dshTfr_added', 'added')
  const removed = span('dshTfr_removed', 'removed')
  stats.append(label, added, removed)
  const files = span('dshTfr_files', 'files')

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dshTfr_button'
  button.setAttribute(ROOT_ATTR, 'button')

  const status = span('dshTfr_status', 'status')
  status.setAttribute(ROOT_ATTR, 'status')

  root.append(stats, files, button, status)
  return { turn, root, label, added, removed, files, button, status, tail: null, view: null, loading: false, untracked: false, busy: false, latest: false, note: '', noteKind: 'none' }
}

/** 节点是否在本插件自己的 DOM 里（观察器要忽略这些变化）。 */
function insideOwn(node: Node | null): boolean {
  let current: Node | null = node
  while (current !== null) {
    if (current instanceof Element && current.hasAttribute(ROOT_ATTR)) return true
    current = current.parentNode
  }
  return false
}

/**
 * 官方产物行在回合尾部里的最外层块（= 官方 chain 结果那一个元素）。
 * @param tail - 回合尾部根元素。
 * @returns 该插入其后的元素；官方这回合没有产物行时 null。
 */
function producedBlockOf(tail: HTMLElement): HTMLElement | null {
  const row = tail.querySelector<HTMLElement>(PRODUCED_SELECTOR)
  if (row === null) return null
  let block: HTMLElement = row
  while (block.parentElement !== null && block.parentElement !== tail) block = block.parentElement
  return block === tail ? null : block
}

/** 自有元素的插入点：官方产物行之后，或（没有官方产物行时）动作条之前。 */
interface InsertionPoint {
  /** `after` = 插到 `node` 之后；`before` = 插到 `node` 之前。 */
  readonly mode: 'after' | 'before'
  /** 参照元素。 */
  readonly node: HTMLElement
}

/**
 * 本插件这一行该插到哪里。
 *
 * 首选官方「本轮文件改动」行之后（与它同一段）。官方那一行只在**模型根调用**
 * 改了文件时出现；PTC（`run_code` 子调用）修改不会让它出现，此时退回
 * 「动作条之前」——动作条是回合尾部的最后一个元素子节点（官方 TurnTailNodeView
 * 固定渲染 `[tail, MessageIconActions]`），插在它前面就等于接在官方内容之后。
 * @param tail - 回合尾部根元素。
 * @returns 插入点；两者都识别不出来时 null（这一轮先不挂）。
 */
function insertionPointOf(tail: HTMLElement): InsertionPoint | null {
  const produced = producedBlockOf(tail)
  if (produced !== null) return { mode: 'after', node: produced }
  const last = tail.lastElementChild
  if (last instanceof HTMLElement && !last.hasAttribute(ROOT_ATTR)) return { mode: 'before', node: last }
  // 末位已经是自有元素（说明动作条没了）：这一轮无处可挂，交给下一次 sync 重建。
  return null
}

/** 组装 tooltip：本回合改了哪些文件、每个文件 +/- 多少。 */
function tooltipOf(view: TurnChangesView, t: Translate): string {
  const lines: string[] = [t('tipHeader', { count: String(view.totalFiles) })]
  const names = displayPathsOf(view.files, view.cwd)
  view.files.slice(0, MAX_TIP_FILES).forEach((file, index) => {
    const name = names[index] ?? file.path
    lines.push(
      t('tipLine', {
        path: file.created ? `${name} (${t('newFile')})` : name,
        added: file.added === null ? '?' : String(file.added),
        removed: file.removed === null ? '?' : String(file.removed),
      }),
    )
  })
  if (view.files.length > MAX_TIP_FILES) {
    lines.push(t('tipMore', { count: String(view.files.length - MAX_TIP_FILES) }))
  }
  if (view.blocked > 0) lines.push(t('tipBlocked', { count: String(view.blocked) }))
  return lines.join('\n')
}

/**
 * 安装增补层。
 * @param options - 会话身份、RPC 门面与文案。
 * @returns 卸载句柄。
 */
export function augment(options: AugmentOptions): AugmentHandle {
  const { api, t, sessionId } = options
  const entries = new Map<string, TurnEntry>()
  let disposed = false
  let queued = false

  ensureStyles()

  /** 拉一次某回合的状态（每个元素只拉一次，之后由动作结果更新）。 */
  async function ensureLoaded(entry: TurnEntry): Promise<void> {
    if (disposed || entry.loading || entry.untracked || entry.view !== null) return
    entry.loading = true
    const result = await api.state(sessionId, entry.turn)
    entry.loading = false
    if (disposed) return
    if (!result.ok) {
      console.warn('[turn-file-revert] state failed:', result.error.code, result.error.message)
      return
    }
    entry.view = result.value
    if (!result.value.tracked) entry.untracked = true
    render(entry)
  }

  /** 把状态画到这一行上。 */
  function render(entry: TurnEntry): void {
    const view = entry.view
    if (view === null || !view.tracked || view.files.length === 0) {
      entry.root.hidden = true
      return
    }
    entry.root.hidden = false
    entry.root.title = tooltipOf(view, t)
    entry.label.textContent = t('label')
    const approximate = view.files.some((file) => file.approximate) ? '~' : ''
    entry.added.textContent = `${approximate}${t('addedLines', { count: String(view.totalAdded) })}`
    entry.removed.textContent = `${approximate}${t('removedLines', { count: String(view.totalRemoved) })}`
    entry.files.textContent = t('files', { count: String(view.totalFiles) })
    entry.button.hidden = view.action === 'none'
    entry.button.disabled = entry.busy
    entry.button.dataset.action = view.action
    entry.button.textContent = view.action === 'reapply' ? t('reapplyAll') : t('revertAll')
    // 只有本会话最后一次对话可点。用 aria-disabled 而不是 disabled：浏览器不会给
    // 真正禁用的控件显示 title，改成 aria-disabled 才能 hover 出「不支持撤回/恢复」。
    if (entry.latest) {
      entry.button.removeAttribute('aria-disabled')
      entry.button.removeAttribute('title')
    } else {
      entry.button.setAttribute('aria-disabled', 'true')
      entry.button.title = t('notLatest')
    }
    entry.status.textContent = entry.note
    if (entry.noteKind === 'none') entry.status.removeAttribute('data-kind')
    else entry.status.dataset.kind = entry.noteKind
  }

  /** 点按钮：撤回或重新应用本回合的全部改动。 */
  async function act(entry: TurnEntry): Promise<void> {
    const view = entry.view
    if (disposed || entry.busy || view === null || view.action === 'none') return
    if (!entry.latest) {
      // 兜底：aria-disabled 只是视觉/语义，真正的拦截在这里。
      entry.note = t('notLatest')
      entry.noteKind = 'none'
      render(entry)
      return
    }
    const action = view.action
    entry.busy = true
    entry.note = action === 'reapply' ? t('reapplying') : t('reverting')
    entry.noteKind = 'none'
    render(entry)
    const result = action === 'reapply' ? await api.reapply(sessionId, entry.turn) : await api.revert(sessionId, entry.turn)
    entry.busy = false
    if (disposed) return
    if (!result.ok) {
      entry.note = t('failed', { message: result.error.message })
      entry.noteKind = 'error'
      render(entry)
      return
    }
    const outcome = result.value
    entry.view = outcome.view
    const failed = outcome.results.filter((item) => !item.ok)
    const overwrote = outcome.results.filter((item) => item.ok && item.dirty === true).length
    if (failed.length > 0) {
      entry.note = t('partial', { count: String(failed.length), message: failed[0]?.message ?? '' })
      entry.noteKind = 'error'
    } else {
      entry.note = action === 'reapply' ? t('reapplied') : t('reverted')
      entry.noteKind = 'ok'
    }
    if (overwrote > 0) entry.note = `${entry.note} · ${t('overwrote', { count: String(overwrote) })}`
    render(entry)
  }

  /** 一次同步：保证每个已收尾的回合都挂着一个位置正确的自有元素（无数据时自身隐藏）。 */
  function sync(): void {
    if (disposed) return
    const seen = new Set<string>()
    for (const tail of Array.from(document.querySelectorAll<HTMLElement>(TAIL_SELECTOR))) {
      const raw = tail.getAttribute('data-turn-tail')
      if (raw === null) continue
      const turn = Number(raw)
      if (!Number.isSafeInteger(turn) || turn < 0) continue
      const point = insertionPointOf(tail)
      if (point === null) continue
      const key = String(turn)
      seen.add(key)
      let entry = entries.get(key)
      if (entry === undefined || entry.tail !== tail || !entry.root.isConnected) {
        entry?.root.remove()
        entry = buildEntry(turn)
        entry.button.addEventListener('click', () => {
          void act(entry as TurnEntry)
        })
        entry.tail = tail
        entries.set(key, entry)
      }
      entry.latest = tail.getAttribute(LATEST_ATTR) === 'always'
      const placed = point.mode === 'after'
        ? entry.root.previousElementSibling === point.node
        : entry.root.nextElementSibling === point.node
      if (!placed) {
        if (point.mode === 'after') point.node.insertAdjacentElement('afterend', entry.root)
        else point.node.insertAdjacentElement('beforebegin', entry.root)
      }
      render(entry)
      void ensureLoaded(entry)
    }
    for (const [key, entry] of Array.from(entries)) {
      if (seen.has(key)) continue
      entry.root.remove()
      entries.delete(key)
    }
  }

  /** 合并多次 DOM 变更为一次同步。 */
  function scheduleSync(): void {
    if (queued || disposed) return
    queued = true
    const run = (): void => {
      queued = false
      sync()
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
    else window.setTimeout(run, 0)
  }

  /** 这个变更是否可能影响我们的行（转写区流式输出不触发）。 */
  function relevant(record: MutationRecord): boolean {
    const target = record.target instanceof Element ? record.target : record.target.parentElement
    if (target !== null && target.closest(TAIL_SELECTOR) !== null) return true
    for (const node of Array.from(record.addedNodes)) {
      if (!(node instanceof Element)) continue
      if (node.matches(TAIL_SELECTOR) || node.matches(PRODUCED_SELECTOR)) return true
      if (node.querySelector(`${TAIL_SELECTOR}, ${PRODUCED_SELECTOR}`) !== null) return true
    }
    return false
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (insideOwn(record.target)) continue
      if (relevant(record)) {
        scheduleSync()
        return
      }
    }
  })
  // 属性也要看：新一轮对话开始时，官方会把上一轮尾部的 LATEST_ATTR 从
  // `always` 改成 `hover`，按钮要跟着变成不可点。
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [LATEST_ATTR] })

  sync()

  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      observer.disconnect()
      for (const entry of entries.values()) entry.root.remove()
      entries.clear()
    },
  }
}
