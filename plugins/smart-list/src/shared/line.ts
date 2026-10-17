/**
 * 光标所在行的文本提取（只依赖 DOM 结构投影，不直接引用浏览器 API，可在
 * Node 里用假 DOM 测试）。
 *
 * DSH composer 的可编辑根是 Lexical 渲染的 contenteditable：块元素（`<p>`）各是
 * 一行，软换行是 `<br>`；`setDraft` / 粘贴产生的多行文本里还可能直接含 `\n`。
 * 行首编号识别只关心「从行首到光标」的文本，所以这里对整棵子树做一次先序遍历：
 * - 块级容器（且不是可编辑根本身）→ 重置当前行
 * - `<br>` → 重置当前行
 * - 文本节点 → 追加（文本里出现 `\n` 时只保留最后一个换行之后的部分）
 * - 遍历到光标所在节点 → 只取光标之前的文本并停止
 *
 * 这里读取的叶子字段（`nodeType` / `tagName` / `data` / `childNodes`）在真实
 * DOM 与测试假 DOM 上都成立；改用别的字段会让纯逻辑自测失真。
 */

/** DOM 节点的结构投影（真实 Node 结构兼容；测试里用假 DOM 实现）。 */
export interface DomNodeLike {
  readonly nodeType: number
  readonly tagName?: string | undefined
  readonly data?: string | undefined
  readonly childNodes: ArrayLike<DomNodeLike>
}

const NODE_TYPE_ELEMENT = 1
const NODE_TYPE_TEXT = 3

/** 会被当作「新的一行」的块级标签（composer 文档目前实际只有 p / br）。 */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'section',
  'article',
  'header',
  'footer',
])

/**
 * 返回可编辑根里「光标所在行、光标之前的文本」。
 * @param editable - contenteditable 根元素。
 * @param anchor - 选区锚点节点（`Selection.anchorNode`）。
 * @param offset - 选区锚点偏移（`Selection.anchorOffset`）。
 * @returns 行首到光标的文本；锚点不在可编辑根内时返回 null。
 */
export function lineTextBeforeCaret(
  editable: DomNodeLike,
  anchor: DomNodeLike,
  offset: number,
): string | null {
  if (!containsNode(editable, anchor)) return null
  let line = ''

  /** 追加一段文本；只保留这段文本里最后一个 `\n` 之后的部分。 */
  const append = (data: string, end?: number): void => {
    const slice = end === undefined ? data : data.slice(0, Math.max(0, Math.min(end, data.length)))
    const newline = slice.lastIndexOf('\n')
    line = newline === -1 ? line + slice : slice.slice(newline + 1)
  }

  /** 先序遍历；返回 true 表示已经到达光标节点、需要停止。 */
  const visit = (node: DomNodeLike): boolean => {
    if (node === anchor) {
      if (node.nodeType === NODE_TYPE_TEXT) {
        append(node.data ?? '', offset)
      } else if (node.nodeType === NODE_TYPE_ELEMENT) {
        if (node !== editable && isBlock(node)) line = ''
        const children = node.childNodes
        const limit = Math.max(0, Math.min(offset, children.length))
        for (let index = 0; index < limit; index += 1) {
          const child = children[index]
          if (child !== undefined) visit(child)
        }
      }
      return true
    }
    if (node.nodeType === NODE_TYPE_TEXT) {
      append(node.data ?? '')
      return false
    }
    if (node.nodeType !== NODE_TYPE_ELEMENT) return false
    if (isLineBreak(node)) {
      line = ''
      return false
    }
    if (node !== editable && isBlock(node)) line = ''
    const children = node.childNodes
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (child !== undefined && visit(child)) return true
    }
    return false
  }

  visit(editable)
  return line
}

/** 是否为块级元素（进入即开始新的一行）。 */
function isBlock(node: DomNodeLike): boolean {
  return BLOCK_TAGS.has((node.tagName ?? '').toLowerCase())
}

/** 是否为换行元素。 */
function isLineBreak(node: DomNodeLike): boolean {
  return (node.tagName ?? '').toLowerCase() === 'br'
}

/** 目标节点是否在根子树内（含根本身）。 */
function containsNode(root: DomNodeLike, target: DomNodeLike): boolean {
  if (root === target) return true
  const children = root.childNodes
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child !== undefined && containsNode(child, target)) return true
  }
  return false
}
