/** 路径小工具（`/` 与 `\` 都算分隔符，Windows / POSIX 通用）。 */

/**
 * 统一成 `/` 分隔、去掉尾部斜杠。
 * @param path - 任意路径。
 * @returns 规范化路径。
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 取路径末尾 n 段。
 * @param path - 已规范化的路径。
 * @param n - 保留段数。
 * @returns 末尾 n 段；本身不足 n 段时返回原串。
 */
export function tailSegments(path: string, n: number): string {
  const parts = path.split('/')
  return parts.length <= n ? path : parts.slice(parts.length - n).join('/')
}

/**
 * 一组路径的最长公共**目录**前缀（含结尾 `/`）。
 *
 * 用于拿不到会话工作目录时的兜底：一个回合改的文件通常都在同一个项目下，
 * 用它们自己的公共前缀当基准，就能显示成 `plugins/x/src/a.ts` 这种相对路径。
 * @param paths - 已规范化的路径列表。
 * @returns 公共目录前缀；没有公共目录时返回空串。
 */
export function commonDirectoryPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  const dirs = paths.map((path) => {
    const at = path.lastIndexOf('/')
    return at === -1 ? '' : path.slice(0, at + 1)
  })
  let prefix = dirs[0] ?? ''
  for (const dir of dirs) {
    while (prefix.length > 0) {
      if (dir.toLowerCase().startsWith(prefix.toLowerCase())) break
      const at = prefix.lastIndexOf('/', prefix.length - 2)
      prefix = at === -1 ? '' : prefix.slice(0, at + 1)
    }
    if (prefix.length === 0) break
  }
  return prefix
}

/**
 * `target` 相对 `base` 的路径；不在 `base` 之下时 null（大小写不敏感，Windows 友好）。
 * @param target - 已规范化的目标路径。
 * @param base - 已规范化的基准目录。
 * @returns 相对路径，或 null。
 */
function relativeUnder(target: string, base: string): string | null {
  if (base.length === 0) return null
  const lowerTarget = target.toLowerCase()
  const lowerBase = base.toLowerCase()
  if (lowerTarget === lowerBase) return '.'
  const prefix = lowerBase.endsWith('/') ? lowerBase : `${lowerBase}/`
  if (!lowerTarget.startsWith(prefix)) return null
  return target.slice(prefix.length)
}

/**
 * 把一组文件的路径投影成「尽量短、又不会互相撞车」的展示名。
 *
 * 展示口径（与官方产物行一致地「绝不显示 `D:\...` 绝对路径」）：
 * 1. 有会话工作目录、且文件在它之下时相对它；
 * 2. 否则用这组文件自己的公共目录前缀；
 * 3. 连公共前缀都没有（跨盘符）时每个文件取末尾两段。
 * @param files - `{ path, absolutePath }` 列表。
 * @param cwd - 会话工作目录。
 * @returns 与入参同序的展示路径。
 */
export function displayPathsOf(
  files: readonly { readonly path: string; readonly absolutePath: string | null }[],
  cwd: string | null,
): string[] {
  const candidates = files.map((file) => normalizePath(file.absolutePath ?? file.path))
  const common = commonDirectoryPrefix(candidates)
  const base = cwd === null || cwd.length === 0 ? null : normalizePath(cwd)
  return candidates.map((target) => {
    if (base !== null) {
      const relative = relativeUnder(target, base)
      if (relative !== null) return relative
    }
    if (common.length > 0) {
      const relative = relativeUnder(target, common)
      if (relative !== null) return relative
    }
    return tailSegments(target, 2)
  })
}

