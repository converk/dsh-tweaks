/**
 * dsh-tweaks-model-capabilities — 纯逻辑层。
 *
 * 只做两件事，保持最小：
 * 1. **草稿 ↔ 字段**：官方模型行里注入的「思考强度 / 多模态」控件 ↔
 *    `llm-pi-ai` profile 的模型字段（`reasoningEfforts` / `input`）；
 * 2. **path ops 合成**：把待存改动合并成一组 `settings.mutate` 的
 *    `{op:'set'|'unset', path, value}`，并保留插件看不见的字段
 *    （`compat`、`name`、`contextWindow`、`maxTokens`、其它模型条目）。
 *
 * 交互约定（用户拍板）：
 * - 思考强度按**协议预置**给出词表：`openai` = off/minimal/low/medium/high/xhigh/max，
 *   `anthropic` = off/low/medium/high/xhigh/max；套用预置时默认勾选
 *   off/low/high/max。一个档都不勾 = 该模型不支持思考，写 `reasoningEfforts: false`；
 *   勾了档位就写 dict，未勾选的档位不写键，本体把它们钉成「不支持」；
 * - **没有「跟随目录」**：一个档都不勾 = 该模型不支持思考，写 `reasoningEfforts:
 *   false`；勾了档位就写 dict；
 * - 多模态是二选一：`text` / `text + image`，始终写显式值；
 * - 上下文窗口 / 最大输出由官方输入框负责，插件只提供 1M / 128K 快捷填入。
 *
 * 存储形态只有两种，来自官方模型编辑器实际显示的内容：
 * - 用户层已有 `models[]` → 直接改数组里的条目；
 * - 用户层没有 `models[]`（官方编辑器显示的是内置目录的继承行）→ 用官方
 *   编辑器当前列出的**全部模型 id** 物化 `models[]`（未编辑的条目只写 `id`，
 *   其余字段按 id 继续继承内置目录），并删掉可能存在的 `modelOverrides`。
 *   这与官方编辑器你改任一官方字段时的行为一致，不会把目录压成一行。
 *
 * 字段语义以本机 DSH 0.1.2-rc.1 的 `dsh-llm-pi-ai` 为准：
 * - `reasoningEfforts`：键集含 `off|minimal|low|medium|high|xhigh|max`，值是
 *   该档过线拼写；`off` 可留空（写 `null` = 不发参数）；非 `off` 档必须非空
 *   字符串；一旦给 dict，至少要有一个非 `off` 档；
 * - `input`：词表只有 `text` | `image`。
 */

/**
 * 插件认识的全部思考档位（两家协议词表的并集，按升级顺序）。
 * 具体显示哪些由当前协议预置决定（见 {@link REASONING_PRESETS}）。
 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 一个思考档位的字面量。 */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** 本体 `ModelModalityMap` 的词表。 */
export type Modality = 'text' | 'image'

/**
 * 多模态在模型条目里的字段名：
 * - `llm-pi-ai` 用 `input`；
 * - `llm-deepseek` 用 `inputModalities`。
 */
export type InputField = 'input' | 'inputModalities'

/** settings.mutate 接受的最小 JSON 值域。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** JSON 对象投影。 */
export type JsonObject = { [key: string]: JsonValue }

/** 一条 settings.mutate path op（与 `SettingsPathOpView` 结构一致）。 */
export type SettingsPathOp =
  | { op: 'set'; path: string[]; value: JsonValue }
  | { op: 'unset'; path: string[] }

/** 多模态控件的二选一。 */
export type InputDraft = 'text' | 'text+image'

/** 一个模型的两个能力字段草稿。 */
export interface ModelCapabilityDraft {
  /** 勾选的档位 → 过线拼写；键不存在 = 该档不支持。空对象 = 不支持思考。 */
  reasoning: Partial<Record<ThinkingLevel, string>>
  input: InputDraft
}

/** 一条待保存的模型编辑。 */
export interface SaveEdit {
  id: string
  draft: ModelCapabilityDraft
}

/** 保存规划的问题码。 */
export type SaveIssueCode =
  | 'model-id-empty'
  | 'model-not-saved'
  | 'models-not-configured'
  | 'storage-conflict'
  | 'reasoning-only-off'
  | 'reasoning-wire-required'

/** 一条可展示的保存问题。 */
export interface SaveIssue {
  /** 出问题的模型 id；非模型级问题不带。 */
  id?: string
  code: SaveIssueCode
  /** 英文诊断（UI 按 code 本地化后展示，自测直接断言 code）。 */
  message: string
  /** 思考拼写缺失时指向的档位。 */
  level?: ThinkingLevel
}

/** 保存规划输入。 */
export interface SaveInput {
  /** `SettingsNamespaceView.user`（用户层原始分节）。 */
  userSection: unknown
  /** owner props 的 `provider.settingsPath`（指向 `providers.<route>`）。 */
  settingsPath: readonly string[]
  /** 只包含「与基线不同」的模型。 */
  edits: readonly SaveEdit[]
  /**
   * 官方模型编辑器当前列出的全部模型 id（DOM 顺序，已去空）。用户层没有
   * `models[]` 时用它完整物化目录；有 `models[]` 时仅作兜底校验。
   */
  visibleModelIds?: readonly string[] | undefined
  /** 多模态字段名：`llm-pi-ai` = `input`（默认），`llm-deepseek` = `inputModalities`。 */
  inputField?: InputField | undefined
  /** 是否管理每模型思考强度（`llm-deepseek` 没有该字段，传 false）。 */
  manageReasoning?: boolean | undefined
}

/** 保存规划结果。 */
export interface SavePlan {
  /** 一次 mutate 的完整 path ops；有 issues 时为空数组。 */
  ops: SettingsPathOp[]
  issues: SaveIssue[]
  mode: 'models' | 'none'
}

/** 用户层已存的模型（`models[]` 条目优先，其次 `modelOverrides` 的值）。 */
export interface StoredModel {
  id: string
  entry: JsonObject
}

/** 协议预置的 id（只填档位表，绝不写 compat）。 */
export const REASONING_PRESET_IDS = ['openai', 'anthropic'] as const

/** 协议预置的 id 字面量。 */
export type ReasoningPresetId = (typeof REASONING_PRESET_IDS)[number]

/** 未配置思考强度的模型默认套用的预置。 */
export const DEFAULT_REASONING_PRESET: ReasoningPresetId = 'openai'

/** 套用任一预置时默认勾选的档位（两家一致）。 */
const PRESET_DEFAULT_TICKED: readonly ThinkingLevel[] = ['off', 'low', 'high', 'max']

/** 一个协议预置：该协议的档位词表 + 套用时的默认勾选。 */
export interface ReasoningPresetSpec {
  /** 该协议官方支持的档位；UI 只显示这些行。 */
  readonly levels: readonly ThinkingLevel[]
  /** 套用该预置时默认勾选的档位。 */
  readonly defaultTicked: readonly ThinkingLevel[]
}

/**
 * 两家协议的档位词表（取自 DSH 自带 pi-ai 目录里两家模型的 `thinkingLevelMap` 并集）：
 * - `openai`（Responses）：off / minimal / low / medium / high，再补上 xhigh、max；
 * - `anthropic`（Messages）：off / low / medium / high / max，再补上 xhigh。
 *   Anthropic 没有 `minimal`（pi-ai 的 `mapThinkingLevelToEffort` 把 minimal 降级成 low）。
 *
 * 预置只决定「有哪些档位可选」和「套用时默认勾什么」；协议本身由提供方/模型的
 * `compat` 决定，本插件绝不写 `compat`。
 */
export const REASONING_PRESETS: Record<ReasoningPresetId, ReasoningPresetSpec> = {
  openai: {
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultTicked: PRESET_DEFAULT_TICKED,
  },
  anthropic: {
    levels: ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultTicked: PRESET_DEFAULT_TICKED,
  },
}

/**
 * 一个预置要显示的档位，按插件统一的升级顺序排列。
 * @param id - 预置 id。
 * @returns 档位列表。
 */
export function presetLevels(id: ReasoningPresetId): ThinkingLevel[] {
  const allowed = new Set<ThinkingLevel>(REASONING_PRESETS[id].levels)
  return THINKING_LEVELS.filter((level) => allowed.has(level))
}

/** 容量快捷填入：官方输入框接受这些字符串。 */
export const CAPACITY_PRESETS: readonly { label: string; contextWindow: string; maxTokens: string }[] = [
  { label: '1M / 128K', contextWindow: '1000000', maxTokens: '131072' },
]

/** 是否 JSON 对象（数组 / null / 非对象一律 false）。 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 是否 JSON 数组。 */
export function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value)
}

/** 深拷贝 JSON 值（输入必须已是 JSON 数据）。 */
function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 两个 JSON 值是否深相等（按规范序列化比较）。 */
function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** 按路径读取（路径穿过非对象即 undefined）。 */
export function getPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root
  for (const part of path) {
    if (!isJsonObject(current)) return undefined
    current = current[part]
  }
  return current
}

/** 对象是否自有某键。 */
function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

/** 读取用户层的提供方 profile 对象。 */
function readProfile(userSection: unknown, settingsPath: readonly string[]): JsonObject | undefined {
  const profile = getPath(userSection, settingsPath)
  return isJsonObject(profile) ? profile : undefined
}

/** 空草稿：一个档都不勾（= 不支持思考）+ 仅文本。 */
export function emptyDraft(): ModelCapabilityDraft {
  return { reasoning: {}, input: 'text' }
}

/** 深拷贝草稿。 */
export function copyDraft(draft: ModelCapabilityDraft): ModelCapabilityDraft {
  return { reasoning: { ...draft.reasoning }, input: draft.input }
}

/**
 * 从用户层条目（`models` 条目或 `modelOverrides` 值）还原草稿。
 *
 * 读全部档位（两家协议词表的并集）。没有
 * `reasoningEfforts` 或它是 `false` 时，草稿是「一个档都不勾」。
 * @param entry - 用户层条目；undefined 表示没有配置。
 * @returns 草稿。
 */
export function draftFromEntry(entry: unknown, inputField: InputField = 'input'): ModelCapabilityDraft {
  const draft = emptyDraft()
  if (!isJsonObject(entry)) return draft
  const efforts = entry.reasoningEfforts
  if (isJsonObject(efforts)) {
    for (const level of THINKING_LEVELS) {
      if (!hasOwn(efforts, level)) continue
      const wire = efforts[level]
      draft.reasoning[level] = wire === null ? '' : typeof wire === 'string' ? wire : ''
    }
  }
  const input = entry[inputField]
  if (isJsonArray(input) && input.includes('image')) draft.input = 'text+image'
  return draft
}

/** 两个草稿是否相等（用于脏检查）。 */
export function draftsEqual(left: ModelCapabilityDraft, right: ModelCapabilityDraft): boolean {
  if (left.input !== right.input) return false
  for (const level of THINKING_LEVELS) {
    if (left.reasoning[level] !== right.reasoning[level]) return false
  }
  return true
}

/** 校验一个模型草稿。 */
export function validateDraft(id: string, draft: ModelCapabilityDraft): SaveIssue[] {
  const issues: SaveIssue[] = []
  if (id.trim().length === 0) {
    issues.push({ id, code: 'model-id-empty', message: 'model id must not be empty' })
  }
  const checked = THINKING_LEVELS.filter((level) => draft.reasoning[level] !== undefined)
  if (checked.length > 0 && checked.every((level) => level === 'off')) {
    issues.push({
      id,
      code: 'reasoning-only-off',
      message: 'reasoningEfforts needs at least one level beyond "off"; uncheck off for a non-reasoning model',
    })
  }
  for (const level of checked) {
    if (level === 'off') continue
    const wire = draft.reasoning[level]
    if (wire === undefined || wire.trim().length === 0) {
      issues.push({
        id,
        code: 'reasoning-wire-required',
        level,
        message: `reasoningEfforts.${level} needs the wire value dispatch should send`,
      })
    }
  }
  return issues
}

/** 草稿落成的字段值；`reasoningEfforts` 为 undefined = 该命名空间没有每模型思考字段，不要动它。 */
export interface DraftValues {
  reasoningEfforts?: false | JsonObject
  input: Modality[]
}

/**
 * 草稿 → 模型字段值。
 *
 * 一个档都不勾 → `reasoningEfforts: false`（不支持思考）；勾了就写 dict，只写
 * 勾选的档位，未勾选的档位不写键（本体钉成不支持）。`off` 勾选且留空写 `null`
 * （支持，但不发参数）。多模态始终写 `['text']` 或 `['text','image']`。
 *
 * `manageReasoning: false`（`llm-deepseek` 没有每模型思考字段）时不产生
 * `reasoningEfforts`，也不会因为草稿里的档位报错。
 * @param id - 模型 id（用于诊断）。
 * @param draft - 草稿。
 * @param options - `manageReasoning` 默认 true。
 * @returns 字段值与校验问题。
 */
export function fieldValuesFromDraft(
  id: string,
  draft: ModelCapabilityDraft,
  options?: { manageReasoning?: boolean },
): { values: DraftValues; issues: SaveIssue[] } {
  const manageReasoning = options?.manageReasoning !== false
  const allIssues = validateDraft(id, draft)
  const issues = manageReasoning ? allIssues : allIssues.filter((issue) => issue.code === 'model-id-empty')
  const input: Modality[] = draft.input === 'text+image' ? ['text', 'image'] : ['text']
  if (!manageReasoning) return { values: { input }, issues }
  const checked = THINKING_LEVELS.filter((level) => draft.reasoning[level] !== undefined)
  let reasoningEfforts: false | JsonObject = false
  if (checked.length > 0) {
    const efforts: JsonObject = {}
    for (const level of checked) {
      const wire = (draft.reasoning[level] ?? '').trim()
      efforts[level] = level === 'off' && wire.length === 0 ? null : wire
    }
    reasoningEfforts = efforts
  }
  return { values: { reasoningEfforts, input }, issues }
}

/** 把字段值应用到一个模型条目（保留插件看不见的键）。 */
function applyValues(entry: JsonObject, values: DraftValues, inputField: InputField): JsonObject {
  const next: JsonObject = { ...entry, [inputField]: [...values.input] }
  if (values.reasoningEfforts !== undefined) next.reasoningEfforts = values.reasoningEfforts
  return next
}

/** 用户层已存的模型清单（`models[]` 条目优先，其次 `modelOverrides` 的键）。 */
export function listStoredModels(userSection: unknown, settingsPath: readonly string[]): StoredModel[] {
  const profile = readProfile(userSection, settingsPath)
  const out: StoredModel[] = []
  const seen = new Set<string>()
  const models = profile?.models
  if (isJsonArray(models)) {
    for (const entry of models) {
      if (!isJsonObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) continue
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      out.push({ id: entry.id, entry })
    }
  }
  const overrides = profile?.modelOverrides
  if (isJsonObject(overrides)) {
    for (const id of Object.keys(overrides)) {
      if (seen.has(id)) continue
      const entry = overrides[id]
      if (!isJsonObject(entry)) continue
      seen.add(id)
      out.push({ id, entry })
    }
  }
  return out
}

/**
 * 把模型草稿列表合并成一组 path ops。
 *
 * 用户层已有 `models[]` 时直接改数组；没有时用 `visibleModelIds`（官方编辑器
 * 当前列出的全部 id）物化数组，并删掉 `modelOverrides`。`models[]` 是数组，
 * settings 服务的 path op 不穿数组下标，所以整组改动合成一次 `set models`。
 * @param input - 用户层事实 + 待存编辑 + 官方编辑器可见 id。
 * @returns 保存计划。
 */
export function buildModelOps(input: SaveInput): SavePlan {
  const profile = readProfile(input.userSection, input.settingsPath)
  const userModels = profile?.models
  const overridesRaw = profile?.modelOverrides
  const overrides = isJsonObject(overridesRaw) ? overridesRaw : undefined
  const issues: SaveIssue[] = []

  if (isJsonArray(userModels) && overrides !== undefined) {
    issues.push({
      code: 'storage-conflict',
      message: `route "${input.settingsPath.join('.')}" sets both models and modelOverrides, which the adapter refuses`,
    })
    return { ops: [], issues, mode: 'none' }
  }

  const materialize = !isJsonArray(userModels)
  let base: JsonValue[]
  if (!materialize) {
    base = cloneJson(userModels)
  } else if (input.visibleModelIds !== undefined && input.visibleModelIds.length > 0) {
    const seen = new Set<string>()
    base = []
    for (const id of input.visibleModelIds) {
      if (id.length === 0 || seen.has(id)) continue
      seen.add(id)
      const override = overrides?.[id]
      base.push(isJsonObject(override) ? { ...override, id } : { id })
    }
    if (base.length === 0) {
      issues.push({ code: 'models-not-configured', message: 'the editor listed no model to write' })
      return { ops: [], issues, mode: 'none' }
    }
  } else {
    issues.push({
      code: 'models-not-configured',
      message: `route "${input.settingsPath.join('.')}" has no models list and the editor listed no model id`,
    })
    return { ops: [], issues, mode: 'none' }
  }

  let touched = false
  for (const edit of input.edits) {
    const { values, issues: editIssues } = fieldValuesFromDraft(edit.id, edit.draft, {
      manageReasoning: input.manageReasoning,
    })
    if (editIssues.length > 0) {
      issues.push(...editIssues)
      continue
    }
    const index = base.findIndex((entry) => isJsonObject(entry) && entry.id === edit.id)
    if (index < 0) {
      issues.push({
        id: edit.id,
        code: 'model-not-saved',
        message: `model "${edit.id}" is not in the saved model list yet; save the provider first`,
      })
      continue
    }
    const entry = base[index]
    if (!isJsonObject(entry)) {
      issues.push({
        id: edit.id,
        code: 'model-not-saved',
        message: `model "${edit.id}" is not a plain object in the saved model list`,
      })
      continue
    }
    const next = applyValues(entry, values, input.inputField ?? 'input')
    if (!jsonEqual(next, entry)) {
      base[index] = next
      touched = true
    }
  }

  if (issues.length > 0) return { ops: [], issues, mode: 'none' }
  if (!touched) return { ops: [], issues, mode: 'models' }

  const ops: SettingsPathOp[] = [{ op: 'set', path: [...input.settingsPath, 'models'], value: base }]
  if (materialize && overrides !== undefined) {
    ops.push({ op: 'unset', path: [...input.settingsPath, 'modelOverrides'] })
  }
  return { ops, issues, mode: 'models' }
}

/**
 * 套用一个协议预置：返回默认勾选的档位 → 过线拼写。
 *
 * 两家的默认勾选相同（off / low / high / max）；预置的差别在**可选档位词表**
 * （{@link presetLevels}），不在默认勾选。拼写就是档位名本身，`off` 留空
 * （= 不发参数）。本函数绝不涉及 `compat`。
 * @param id - 预置 id。
 * @returns 档位表。
 */
export function reasoningPreset(id: ReasoningPresetId): Partial<Record<ThinkingLevel, string>> {
  const out: Partial<Record<ThinkingLevel, string>> = {}
  for (const level of REASONING_PRESETS[id].defaultTicked) out[level] = level === 'off' ? '' : level
  return out
}

