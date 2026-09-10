/**
 * 行级差异统计（纯函数，无 node / DOM 依赖）。
 *
 * 只算「新增多少行、删除多少行」，不产出 patch：先在首尾剥掉相同的行，
 * 再对中间段求最短编辑脚本长度 D（Myers 贪心算法，O((N+M)·D) 时间、
 * O(N+M) 空间，不保留回溯轨迹），最后由
 * `LCS = (N + M - D) / 2` 反推增删行数。
 *
 * 差异过大（D 超过 {@link MAX_EDIT_DISTANCE}）或行数超过
 * {@link MAX_DIFF_LINES} 时退化为「整段替换」的上界估计，保证任何输入都
 * 能在常数级时间内给出数字而不是卡住。
 */

/** 参与精确计算的单侧最大行数。 */
export const MAX_DIFF_LINES = 20000

/** 精确计算的编辑距离上限；超过即退化为上界估计。 */
export const MAX_EDIT_DISTANCE = 4096

/** 一行增删统计。 */
export interface LineChangeStats {
  /** 新增行数。 */
  readonly added: number
  /** 删除行数。 */
  readonly removed: number
  /** 是否退化为上界估计（差异过大时）。 */
  readonly approximate: boolean
}

/** 按 `\n` 切行；末尾换行不产生额外的空行。 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Myers 最短编辑脚本长度；超过上限返回 null。
 * @param a - 左侧行数组（已剥离公共前后缀）。
 * @param b - 右侧行数组（已剥离公共前后缀）。
 * @returns D，或差异过大时的 null。
 */
function editDistance(a: readonly string[], b: readonly string[]): number | null {
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  const cap = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = cap + 1
  const v = new Int32Array(2 * cap + 3)
  for (let d = 0; d <= cap; d++) {
    for (let k = -d; k <= d; k += 2) {
      const up = v[offset + k + 1] ?? 0
      const left = v[offset + k - 1] ?? 0
      let x: number
      if (k === -d || (k !== d && left < up)) x = up
      else x = left + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return d
    }
  }
  return null
}

/**
 * 统计两段文本之间的行增删。
 * @param before - 改动前文本。
 * @param after - 改动后文本。
 * @returns 增删行数（差异过大时为上界估计）。
 */
export function countLineChanges(before: string, after: string): LineChangeStats {
  if (before === after) return { added: 0, removed: 0, approximate: false }
  const a = splitLines(before)
  const b = splitLines(after)

  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length === 0 && midB.length === 0) return { added: 0, removed: 0, approximate: false }

  if (midA.length > MAX_DIFF_LINES || midB.length > MAX_DIFF_LINES) {
    return { added: midB.length, removed: midA.length, approximate: true }
  }

  const distance = editDistance(midA, midB)
  if (distance === null) return { added: midB.length, removed: midA.length, approximate: true }

  const common = (midA.length + midB.length - distance) / 2
  return {
    added: midB.length - common,
    removed: midA.length - common,
    approximate: false,
  }
}
