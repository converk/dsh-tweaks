/**
 * 列表自动续号 — 纯逻辑（无 DOM / React / Node 依赖，宿主与浏览器半区都可测）。
 *
 * 输入是「光标所在行、光标之前的文本」，输出换行后应补的列表标记：
 * - 有序：`1. ` → `2. `、`1) ` → `2) `、`1、` → `2、`；保留缩进与编号位数
 *   （`01. ` → `02. `，`  1. ` → `  2. `）。
 * - 无序：`- ` / `* ` / `+ ` / `• ` → 原样重复（含缩进）。
 * - 空条目（标记之后没有正文）→ null：让浏览器插入普通换行。这样在
 *   「`2. ` 后面还没写内容」时按 Shift+Enter 就自然停留在列表内的空行，
 *   而不是继续生成 `3. `。
 *
 * 只在「行首就是标记」时匹配（正则锚定 `^`），正文里出现的编号不触发。
 */

/** 西文分隔符（`.` / `)`）后必须有分隔空白，避免把 `1.5` 这类正文误判成列表。 */
const ORDERED_LINE_ASCII = /^([ \t\u3000]*)(\d{1,9})([.)])([ \t\u3000]+)(\S[\s\S]*)$/u

/**
 * 中文分隔符（`、` / `）`）后可以没有空格（`1、事项` 是常见写法）。
 * 编号限制 1–2 位：中文正文里「2026、…」这种年份开头的句子不该被当成列表条目。
 */
const ORDERED_LINE_CJK = /^([ \t\u3000]*)(\d{1,2})([、）])([ \t\u3000]*)(\S[\s\S]*)$/u

/** 无序列表：缩进、项目符号、分隔空白、正文。 */
const UNORDERED_LINE = /^([ \t\u3000]*)([-*+•])([ \t\u3000]+)(\S[\s\S]*)$/u

/**
 * 根据光标所在行的前缀，给出 Shift+Enter 换行后应插入的列表标记。
 * @param lineBeforeCaret - 从行首到光标的文本（不含换行符）。
 * @returns 要追加在换行之后的标记（缩进 + 编号/符号 + 原分隔空白）；不是
 *   非空列表条目时返回 null。
 */
export function nextListMarker(lineBeforeCaret: string): string | null {
  const ordered = ORDERED_LINE_ASCII.exec(lineBeforeCaret) ?? ORDERED_LINE_CJK.exec(lineBeforeCaret)
  if (ordered !== null) {
    const indent = ordered[1] ?? ''
    const digits = ordered[2] ?? ''
    const separator = ordered[3] ?? ''
    const gap = ordered[4] ?? ''
    return indent + nextNumber(digits) + separator + gap
  }
  const unordered = UNORDERED_LINE.exec(lineBeforeCaret)
  if (unordered !== null) {
    const indent = unordered[1] ?? ''
    const bullet = unordered[2] ?? ''
    const gap = unordered[3] ?? ''
    return indent + bullet + gap
  }
  return null
}

/**
 * 编号 +1，并保持用户写的前导零宽度（`01.` → `02.`，`1.` → `2.`）。
 * @param digits - 行首编号字符串（已由正则限制在 1–9 位数字）。
 * @returns 下一个编号字符串。
 */
function nextNumber(digits: string): string {
  const next = String(Number(digits) + 1)
  return digits.length > 1 && digits.startsWith('0') ? next.padStart(digits.length, '0') : next
}
