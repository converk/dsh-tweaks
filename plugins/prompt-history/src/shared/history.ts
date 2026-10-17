/**
 * 提示词历史提取（纯逻辑，不依赖 React / DOM / DSH）。
 *
 * 从 Chat 快照的已定稿节点里取 `user` / `steering` 文本，按时间正序、去相邻重复、
 * 保留最近 {@link HISTORY_LIMIT} 条。抽成独立模块是为了能在 Node 侧直接自测
 * （见 `scripts/selftest.mjs`），避免把协议细节埋进客户端组件里无法回归。
 */

/** 保留的最多历史条数（超出丢弃最早的）。 */
export const HISTORY_LIMIT = 200

/** 历史提取只读取的节点形状（结构性窄化）。 */
interface PromptMessageLike {
  readonly kind?: unknown
  readonly content?: unknown
}

/**
 * 从会话节点里提取提示词历史（时间正序）。
 *
 * 多段文本块之间用换行连接：用户消息可能带多个 text 块（或编辑器把一段文字
 * 拆成多个块），直接首尾相接会把两个词粘成一个，召回后再编辑就会丢内容。
 * @param nodes - Chat 快照的 `legacy.nodes`。
 * @returns 去相邻重复、最多 200 条的历史。
 */
export function extractHistory(nodes: readonly unknown[]): string[] {
  const out: string[] = []
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const message = node as PromptMessageLike
    if (message.kind !== 'user' && message.kind !== 'steering') continue
    if (!Array.isArray(message.content)) continue
    const parts: string[] = []
    for (const block of message.content) {
      if (typeof block === 'object' && block !== null) {
        const candidate = block as { type?: unknown; text?: unknown }
        if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
      }
    }
    const text = parts.join('\n').trim()
    if (text === '') continue
    const previous = out.length > 0 ? out[out.length - 1] : undefined
    if (text === previous) continue
    out.push(text)
  }
  return out.length > HISTORY_LIMIT ? out.slice(-HISTORY_LIMIT) : out
}
