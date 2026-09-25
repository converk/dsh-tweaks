/**
 * 终端工具的 entry Config（宿主半区的可编辑设置）。
 *
 * 0.1.7 起 DSH 的设置模型换了（旧模型 `ctx.settings.register(ns, schema, { validate })`
 * 已不存在）：
 *
 * - **设置 = 插件自己那个 profile entry 的 Config**，namespace 就是 entry id
 *   （本插件是 `git-bash-terminal-tool`，见 `cordis.patch.yml`）。
 * - **可编辑字段必须用 `.volatile()` 声明**：`dsh-settings` 的 `volatileForm()`
 *   只把 volatile 字段投影成表单，`update/mutate/replace` 也只允许写 volatile 路径。
 * - `apply(ctx, config)` 拿到的 config 里，volatile 字段是**稳定引用**（`Volatile<T>`）：
 *   `config.dialect.get()` 永远是最新值，落盘后由 Loader 就地更新，不需要 watch / 重启。
 *
 * 因此这里用**真 schemastery**（`@deepseek-ai/schemastery`）而不是手写 schema：
 * `volatileForm()` 读 `.meta` / `.dict`，`plainSchema()` 还会 `new z(schema.toJSON())`，
 * 手写对象过不了这两步 —— 表现就是「设置行在，但读不到值、也写不进去」。
 *
 * 跨字段校验（bash 方言必须给出存在且非 WSL 的路径）schema 表达不了，移到**使用点**：
 * `replace.ts` 在每次替换前调 `validateSettings`，不合法就跳过替换（fail safe，会话照旧）。
 */
import z from '@deepseek-ai/schemastery'
import { fileOrLinkExists, isBlockedBash, normalizePathKey } from './discover.js'
import type { TerminalToolSettings, VolatileLike } from './types.js'
import type { Dialect } from '../shared/protocol.js'

/** 设置默认值（schema 的 `default`，也是新装的初始行为：pwsh）。 */
export const SETTINGS_DEFAULTS: TerminalToolSettings = { dialect: 'pwsh', bashPath: '', bashCandidates: [] }

/**
 * entry Config：三个字段都是 volatile，设置表单与运行时引用都由它派生。
 *
 * ⚠️ 改这里等于改持久化契约：字段名就是表单路径（`mutate` 的 `path`）与
 * 浏览器侧 `decodeSettings` 的键，三处必须同时改。
 */
export const Config = z.object({
  dialect: z.union(['pwsh', 'bash']).default('pwsh').volatile(),
  bashPath: z.string().default('').volatile(),
  bashCandidates: z.array(z.string()).default([]).volatile(),
})

/** 合法的方言取值。 */
const DIALECTS: readonly Dialect[] = ['pwsh', 'bash']

/** 持久化的候选路径数量上限（只服务下拉列表；手写 patch 也塞不爆）。 */
const MAX_SAVED_CANDIDATES = 20

/** 剥掉 YAML 里常见的空白与包裹引号。 */
function normalizeBashPath(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
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
 * 解析一个设置值：默认值 → 用户层覆盖，未知字段丢弃。
 * @param input - 合并后的原始对象（schema 解析结果，或纯逻辑自测里的普通对象）。
 * @returns 规范化后的设置值。
 */
export function resolveSettings(input: unknown): TerminalToolSettings {
  const record = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const dialect = readDialect(record.dialect) ?? SETTINGS_DEFAULTS.dialect
  const rawPath = record.bashPath
  const bashPath = typeof rawPath === 'string' ? normalizeBashPath(rawPath) : SETTINGS_DEFAULTS.bashPath
  return { dialect, bashPath, bashCandidates: normalizeCandidates(record.bashCandidates) }
}

/** 读一个 volatile 字段；普通值（无 Loader 的组合、纯逻辑自测）也接受。 */
function readField<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === 'object' && typeof (value as VolatileLike<T>).get === 'function') {
    const current = (value as VolatileLike<T>).get()
    return current === undefined || current === null ? fallback : current
  }
  return value === undefined || value === null ? fallback : (value as T)
}

/**
 * 从 `apply(ctx, config)` 的 config 读当前设置。
 *
 * volatile 引用是稳定的：每次调用都取最新快照，所以**每次会话启动读一次**就是
 * 「新会话生效」的语义（决策 B），不需要 watch。
 * @param config - Loader 解析后的 entry Config；缺失（无 Loader 的组合）时退回默认值。
 * @returns 规范化后的设置值。
 */
export function readSettings(config: unknown): TerminalToolSettings {
  if (typeof config !== 'object' || config === null) return { ...SETTINGS_DEFAULTS }
  const record = config as Record<string, unknown>
  return resolveSettings({
    dialect: readField(record.dialect, SETTINGS_DEFAULTS.dialect),
    bashPath: readField(record.bashPath, SETTINGS_DEFAULTS.bashPath),
    bashCandidates: readField(record.bashCandidates, SETTINGS_DEFAULTS.bashCandidates),
  })
}

/**
 * 跨字段校验：`dialect === 'bash'` 且路径非空时，路径必须真实存在且不是 WSL。
 *
 * ⚠️ 0.1.7 的 Config schema 表达不了这条约束，所以它不再拦写入，而是由
 * `replaceTerminalTool` 在使用点调用：不合法就跳过替换、只写诊断，会话照旧用 pwsh。
 *
 * 空路径**不算**错误：用户可以先选 Git Bash、再点「自动发现」挑路径；这期间
 * 替换被跳过，会话仍是 pwsh（fail safe，不会改坏会话）。
 * @param value - 已解析过的设置值。
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
