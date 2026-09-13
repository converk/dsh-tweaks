/**
 * `terminal-tool` 设置命名空间（host 侧登记 + 校验）。
 *
 * 设计要点（`docs/plans/git-bash-terminal-tool-design.md` §5.2.6）：
 *
 * - namespace 名是 `terminal-tool`，**绝不复用官方的 `shell`** ——
 *   `pwsh-sandbox` 已经注册了那个 namespace，重复注册会报错，而且往里塞自定义
 *   字段在卸载后会留下与官方 schema 不兼容的残留。
 * - 值形如 `{ dialect: 'pwsh' | 'bash', bashPath: string, bashCandidates: string[] }`；
 *   首次不存在时 schema 默认 `pwsh` / 空串 / 空列表（默认工具是 pwsh，
 *   **插件自己永远不写 dialect** —— 只有用户在设置行里点选才改）。
 * - `validate`：`dialect === 'bash'` 且 `bashPath` **非空**时要求文件确实存在，
 *   否则拒绝写入。空路径是合法的（用户先选 Git Bash、再点「自动发现」挑路径的中间态），
 *   此时 `replace.ts` 会因为路径为空而跳过替换，会话照旧用 pwsh —— 不会半途改坏会话。
 * - **实现上不 import `@deepseek-ai/schemastery`**：`settings.register` 只用
 *   schema 的两件事 —— 把它当函数 resolve 值、调用 `toJSON()` 给配置界面看
 *   （`dsh-settings/lib/index.js` 的 `register`/`describe`）。所以这里给一个
 *   兼容这两点的**手写 schema**，从而保持本插件零 `@deepseek-ai/*` 运行时依赖。
 */
import { SETTINGS_NAMESPACE } from '../shared/protocol.js'
import { fileOrLinkExists, isBlockedBash, normalizePathKey, validateBashPath } from './discover.js'
import type { SettingsSchemaLike, SettingsScopeLike, TerminalToolSettings } from './types.js'
import type { Dialect } from '../shared/protocol.js'

/** 设置默认值（schema 的 `default`，也是新装的初始行为：pwsh）。 */
export const SETTINGS_DEFAULTS: TerminalToolSettings = { dialect: 'pwsh', bashPath: '', bashCandidates: [] }

/** 合法的方言取值。 */
const DIALECTS: readonly Dialect[] = ['pwsh', 'bash']

/** 持久化的候选路径数量上限（只服务下拉列表；手写 settings.yaml 也塞不爆）。 */
const MAX_SAVED_CANDIDATES = 20

/** 剥掉 YAML 里常见的空白与包裹引号。 */
function normalizeBashPath(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed.slice(1, -1)
  return trimmed
}

/** 校验候选值是否是可用的方言字符串。 */
function readDialect(value: unknown): Dialect | undefined {
  return typeof value === 'string' && (DIALECTS as readonly string[]).includes(value) ? (value as Dialect) : undefined
}

/**
 * 规范化持久化的候选路径：只留字符串、去空白、按 Windows 路径语义去重、限量。
 * @param value - 原始（可能是手写的）字段值。
 * @returns 规范化后的路径列表。
 */
function normalizeCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const path = normalizeBashPath(entry)
    if (path.length === 0) continue
    const key = normalizePathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path)
    if (out.length >= MAX_SAVED_CANDIDATES) break
  }
  return out
}

/**
 * 解析一个设置值：schema 默认 → 用户层覆盖，未知字段丢弃。
 * @param input - 合并后的原始对象（`mergeLayers(base, section)` 的结果）。
 * @returns 规范化后的设置值。
 */
export function resolveSettings(input: unknown): TerminalToolSettings {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const dialect = readDialect(record.dialect) ?? SETTINGS_DEFAULTS.dialect
  const rawPath = record.bashPath
  const bashPath = typeof rawPath === 'string' ? normalizeBashPath(rawPath) : SETTINGS_DEFAULTS.bashPath
  return { dialect, bashPath, bashCandidates: normalizeCandidates(record.bashCandidates) }
}

/**
 * 跨字段校验：`dialect === 'bash'` 且路径非空时，路径必须真实存在且不是 WSL。
 *
 * 抛出即**拒绝这次写入**（`dsh-settings` 的 `validate` 语义），所以外部直接
 * 编辑 settings.yaml 写出一个不存在的路径也会被拒绝/告警，而不是静默失效。
 *
 * 空路径**不算**错误：用户可以先选 Git Bash、再点「自动发现」挑路径；这期间
 * `replace.ts` 跳过替换，会话仍是 pwsh（fail safe，不会改坏会话）。
 * @param value - 已由 schema 解析过的设置值。
 * @throws 当 bash 方言给出的路径不可用时。
 */
export function validateSettings(value: TerminalToolSettings): void {
  if (value.dialect !== 'bash') return
  if (value.bashPath.length === 0) return
  if (isBlockedBash(value.bashPath, (name) => process.env[name])) {
    throw new Error('invalid bashPath: 不接受 WSL 的 bash.exe')
  }
  if (!fileOrLinkExists(value.bashPath)) throw new Error(`invalid bashPath: 找不到文件 "${value.bashPath}"`)
}

/**
 * 与 schemastery 的 wire 形状同形的 schema 描述（只用于配置界面展示与浏览器侧解码）。
 *
 * ⚠️ `uid` 必须指向**根节点**那个 ref（这里是 7 = object），这是 schemastery 的
 * `toJSON()` 约定：`new Schema(envelope)` 返回 `refs[uid]`。指向子节点（例如 dialect
 * 的 union）会让浏览器侧 `SettingsScopeController.decode()` 永远校验失败 ——
 * 快照卡在 `loading`、`writable` 恒为 false，表现就是「设置行两个选项全都点不动」。
 * 这份信封由真 schemastery（`z.object({...}).toJSON()`）生成后固化。
 */
const SETTINGS_WIRE_SCHEMA = {
  uid: 7,
  refs: {
    1: { type: 'const', meta: {}, value: 'pwsh' },
    2: { type: 'const', meta: {}, value: 'bash' },
    3: { type: 'union', meta: { default: 'pwsh' }, list: [1, 2] },
    4: { type: 'string', meta: { default: '' } },
    5: { type: 'string', meta: {} },
    6: { type: 'array', meta: { default: [] }, inner: 5 },
    7: {
      type: 'object',
      meta: { default: {} },
      dict: { dialect: 3, bashPath: 4, bashCandidates: 6 },
    },
  },
} as const

/**
 * 构造手写的 schemastery 兼容 schema。
 * @returns 可直接传给 `settings.register` 的 schema。
 */
export function createSettingsSchema(): SettingsSchemaLike<TerminalToolSettings> {
  const schema = (input: unknown): TerminalToolSettings => resolveSettings(input)
  return Object.assign(schema, { toJSON: () => SETTINGS_WIRE_SCHEMA })
}

/** 读取 `terminal-tool` 段的 hook 面（register 成功后的 owner scope）。 */
export interface TerminalToolSettingsHandle {
  /** 当前解析后的值。 */
  get(): TerminalToolSettings
  /** 观察变化。 */
  watch(callback: (next: TerminalToolSettings) => void): () => void
}

/**
 * 注册 namespace 并返回读取句柄。
 *
 * 注册失败（例如 settings 服务不可见、或磁盘上已存了一段不合法值）不抛给调用方，
 * 只写诊断日志并返回 `undefined` —— 设置行会显示「当前版本不支持」，
 * 而会话替换逻辑也据此不启用（绝不半途改坏会话）。
 * @param settings - `ctx.settings`（需已声明或不依赖 `settings`）。
 * @param onError - 注册失败时的回报（用于诊断与 UI 状态）。
 * @returns 成功时的读取句柄，否则 undefined。
 */
export function registerTerminalToolSettings(
  settings: { register: (ns: string, schema: SettingsSchemaLike<TerminalToolSettings>, options?: { applies?: 'live' | 'restart'; validate?: (value: TerminalToolSettings) => void }) => SettingsScopeLike<TerminalToolSettings> },
  onError: (message: string) => void,
): TerminalToolSettingsHandle | undefined {
  try {
    const scope = settings.register(SETTINGS_NAMESPACE, createSettingsSchema(), {
      applies: 'live',
      validate: validateSettings,
    })
    return {
      get: () => scope.get(),
      watch: (callback) =>
        scope.watch((next) => {
          callback(next)
        }),
    }
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error))
    return undefined
  }
}

/** 供路由直接调用的路径校验（复用发现模块的口径）。 */
export { validateBashPath }
