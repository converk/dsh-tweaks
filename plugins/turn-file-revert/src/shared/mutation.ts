/**
 * 文件改动工具的词表与参数解析。
 *
 * 只认官方三个会写文件的模型工具（wire name 与 `dsh-tool-fs` /
 * `dsh-tool-str-replace-editor` 一致）：`write` / `edit` / `str_replace_editor`。
 * 读类工具、失败调用、参数不完整的调用一律不产生条目——判定逻辑与官方
 * `dsh-client-ui-deliverables` 的 `mutationPath` 保持一致，这样本插件的统计
 * 与官方「本轮文件改动」行列出的词表对得上（官方那一行出现时，本插件这一行
 * 才有数据）。
 */

/** 会改动文件内容的模型工具名。 */
export const MUTATION_TOOL_NAMES = ['write', 'edit', 'str_replace_editor'] as const

/** 文件改动工具名。 */
export type MutationToolName = (typeof MUTATION_TOOL_NAMES)[number]

/** 一次被识别的文件改动调用。 */
export interface MutationCall {
  /** 工具 wire name。 */
  readonly tool: MutationToolName
  /** 模型在参数里给出的路径原文（未做 cwd 解析）。 */
  readonly path: string
}

/** 是否为文件改动工具。 */
export function isMutationTool(name: unknown): name is MutationToolName {
  return typeof name === 'string' && (MUTATION_TOOL_NAMES as readonly string[]).includes(name)
}

/** 非空字符串路径才保留模型给出的原始拼写。 */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** 窄化为普通对象（排除数组与 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析工具参数：会话日志里 `tool/call.arguments` 是 JSON 字符串，host 侧
 * `exec.arguments` 已是对象，两种形态都要接受。
 * @param raw - 原始参数。
 * @returns 参数对象，或无法解析时的 null。
 */
export function parseToolArguments(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** `edit` 的必填字段完整且确实会改内容。 */
function validEditArgs(args: Record<string, unknown>): boolean {
  return (
    typeof args.old_string === 'string' &&
    args.old_string.length > 0 &&
    typeof args.new_string === 'string' &&
    args.old_string !== args.new_string &&
    (args.replace_all === undefined || typeof args.replace_all === 'boolean')
  )
}

/** `str_replace_editor` 只有三种命令会写文件（`view` 是读）。 */
function editorMutationPath(args: Record<string, unknown>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string' &&
        args.old_str.length > 0 &&
        (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number' &&
        Number.isInteger(args.insert_line) &&
        args.insert_line >= 0 &&
        typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/**
 * 从一次工具调用里取出被改动的文件路径。
 * @param name - 工具 wire name。
 * @param args - 原始参数（JSON 字符串或已解析对象）。
 * @returns 路径原文；不是文件改动调用时返回 null。
 */
export function mutationCallOf(name: unknown, args: unknown): MutationCall | null {
  if (!isMutationTool(name)) return null
  const parsed = parseToolArguments(args)
  if (parsed === null) return null
  switch (name) {
    case 'write': {
      if (typeof parsed.content !== 'string') return null
      const path = pathValue(parsed.file_path)
      return path === null ? null : { tool: name, path }
    }
    case 'edit': {
      if (!validEditArgs(parsed)) return null
      const path = pathValue(parsed.file_path)
      return path === null ? null : { tool: name, path }
    }
    case 'str_replace_editor': {
      const path = editorMutationPath(parsed)
      return path === null ? null : { tool: name, path }
    }
    default:
      return null
  }
}
