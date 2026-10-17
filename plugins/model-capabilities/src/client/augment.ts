/**
 * 官方模型行的行内能力控件。
 *
 * 官方 `settings.models.provider-card` 席位只到**提供方卡片**一级，模型行内部
 * 没有扩展点；所以这里在席位挂载后观察卡片子树，把「思考强度」和
 * 「容量摘要 / 1M·128K」注入到每个模型行展开后的 `_modelAdvanced`。
 *
 * 多模态属于官方模型行（`ModelInputTypes`，0.2.0 基线即有），本文件**不再**注入：
 * 重复注入会和官方草稿打架，也会覆盖继承的图片能力。
 *
 * 思考强度的归属按行**运行期探测**（不按版本号猜、也不按 `declared` 静态一刀切）：
 * DSH 0.2.1 起官方给 hand-declared pi-ai 路由渲染原生推理控件（DOM 局部名
 * `_modelReasoning*`）；行展开后探测到它，就**不再提供**插件自己的思考强度 UI
 * （只保留摘要 / 容量快捷 + 一句「由官方控件管理」提示），也不把
 * `reasoningEfforts` 写回官方管理的条目；0.2.0 没有该组件 → 按原逻辑注入插件控件。
 *
 * 交互（用户拍板）：
 * - 思考强度用「协议预置」选词表：OpenAI = off/minimal/low/medium/high/xhigh/max，
 *   Anthropic = off/low/medium/high/xhigh/max；两个预置默认都勾 off/low/high/max；
 *   没配置过 `reasoningEfforts` 的模型展开即套用 OpenAI 预置；
 *   一个档都不勾 = 不支持思考（写 `reasoningEfforts: false`）；
 * - 展开模型行时在控件顶部显示该模型**当前**的思考强度（或 DeepSeek 提供方级值）
 *   与上下文 / 输出；多模态只由官方控件显示。
 *
 * 同步时机（与官方卡片自己的草稿共存）：
 * - 官方卡片把模型列表存在自己的 React 草稿里，点「保存」才一次性写 settings；
 *   插件在它写入**之后**再写自己的 `reasoningEfforts`，避免被官方草稿用旧值覆盖。
 * - 因此控件改动先挂起（行内提示「点官方『保存』后写入」）；捕获官方主按钮的
 *   点击，等 `settings/document-updated`（或卡片关闭且官方没有产生写入）后，
 *   用最新 revision 合成一次 `settings.mutate`。
 * - 用户点「取消」即丢弃挂起改动。
 */

import {
  CAPACITY_PRESETS,
  DEFAULT_REASONING_PRESET,
  REASONING_PRESET_IDS,
  THINKING_LEVELS,
  buildModelOps,
  draftFromEntry,
  draftsEqual,
  emptyDraft,
  getPath,
  isJsonArray,
  listStoredModels,
  officialManagesRowReasoning,
  pluginManagesRowReasoning,
  presetLevels,
  reasoningPreset,
} from './capability.js'
import type {
  JsonObject,
  ModelCapabilityDraft,
  ReasoningPresetId,
  SaveEdit,
  SaveIssue,
  ThinkingLevel,
} from './capability.js'
import { ensureStyles } from './styles.js'
import type { CapabilityApi } from './types.js'

/** 注入所需的事实。 */
export interface AugmentOptions {
  /** 席位渲染出的隐藏锚点（用于定位所在提供方卡片）。 */
  anchor: HTMLElement
  /** 适配器 settingsNs（`llm-pi-ai`）。 */
  settingsNs: string
  /** owner props 的 `provider.settingsPath`。 */
  settingsPath: readonly string[]
  /** 插件绑定的 Host 操作与文案。 */
  api: CapabilityApi
}

/** 注入句柄。 */
export interface AugmentHandle {
  dispose(): void
}

/** 一行模型行的注入状态。 */
interface RowState {
  row: HTMLElement
  idInput?: HTMLInputElement
  modelId: string
  container?: HTMLElement
  summary?: HTMLElement
  presetSelect?: HTMLSelectElement
  levelChecks: Partial<Record<ThinkingLevel, HTMLInputElement>>
  levelInputs: Partial<Record<ThinkingLevel, HTMLInputElement>>
  capacityButton?: HTMLButtonElement
  status?: HTMLElement
  /** 与已存值不同的草稿；undefined = 无挂起改动。 */
  pending?: ModelCapabilityDraft
  /** 当前用户层里该模型的值（无则空草稿）。 */
  stored?: ModelCapabilityDraft
  error?: string
  notice?: string
  /** 首次看到该行时模型 ID 为空（= 官方「添加模型」刚加的行）。 */
  wasNew?: boolean
  /** 已处理过该行的容量自动填入（避免反复覆盖）。 */
  capacitySeen?: boolean
  /** 当前选中的协议预置（决定档位词表）；随行保留，重注入不重置。 */
  preset: ReasoningPresetId
  /** 用户层条目里是否写过 `reasoningEfforts`；没写过 = 展开时套用预置默认。 */
  reasoningConfigured: boolean
  /**
   * 本行展开区是否渲染了官方推理控件（运行期探测结果）。
   * undefined = 还没展开过；false = 官方没渲染该控件（0.2.0 / 0.2.1 的非 declared
   * 路由 / DeepSeek），pi-ai 行此时由插件补，DeepSeek 走提供方级字段。
   */
  officialControl?: boolean
}

/** 建元素。 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className.length > 0) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 建 select。 */
function selectEl(className: string): HTMLSelectElement {
  const select = document.createElement('select')
  if (className.length > 0) select.className = className
  return select
}

/** 建 input。 */
function inputEl(type: string, className: string): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  if (className.length > 0) input.className = className
  return input
}

/** 建 button。 */
function buttonEl(className: string, text: string): HTMLButtonElement {
  const button = document.createElement('button')
  if (className.length > 0) button.className = className
  button.textContent = text
  return button
}

/** 建 option。 */
function optionEl(value: string, label: string): HTMLOptionElement {
  const option = document.createElement('option')
  option.value = value
  option.textContent = label
  return option
}

/** Element → HTMLElement 守卫。 */
function isHtmlElement(value: Element): value is HTMLElement {
  return value instanceof HTMLElement
}

/** 节点是否在插件自己注入的控件里（observer 要忽略这些变化，否则会自激）。 */
function insideOwnControls(node: Node | null): boolean {
  let current: Node | null = node
  while (current !== null) {
    if (current instanceof HTMLElement && current.dataset.dshMc !== undefined) return true
    current = current.parentNode
  }
  return false
}

/**
 * 官方 hand-declared pi-ai 路由推理控件的 CSS 局部名片段。
 *
 * 0.2.1 起官方给 `declared === true` 的 pi-ai 模型行渲染 `ModelReasoningEfforts`
 * （DOM class 形如 `<hash>_modelReasoningHead` / `<hash>_modelReasoningRow`）；
 * 0.2.0 的官方产物里没有任何 `modelReasoning` 局部名。归谁管必须按**运行期 DOM
 * 探测**决定：写死版本号会随官方产物布局漂移而静默失效，静态 `declared` 一刀切
 * 又会让 0.2.0 的整块思考编辑功能消失。
 */
const OFFICIAL_REASONING_FRAGMENT = '_modelReasoning'

/** 行内是否真的渲染了官方推理控件（按行探测；官方行展开后的同一帧子树里）。 */
function detectOfficialReasoning(row: HTMLElement): boolean {
  return row.querySelector(`[class*="${OFFICIAL_REASONING_FRAGMENT}"]`) !== null
}

/** 用户层条目里有没有写过 `reasoningEfforts`（没写过 = 未配置，展开时套用预置默认）。 */
function hasConfiguredReasoning(entry: JsonObject | undefined): boolean {
  return entry !== undefined && Object.prototype.hasOwnProperty.call(entry, 'reasoningEfforts')
}

/** 值是不是合法的协议预置 id。 */
function isPresetId(value: string): value is ReasoningPresetId {
  return (REASONING_PRESET_IDS as readonly string[]).includes(value)
}

/** 把 unknown 收成普通对象（读取 DeepSeek 提供方级字段用）。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 协议预置的显示文案。 */
function presetLabel(id: ReasoningPresetId, t: CapabilityApi['t']): string {
  switch (id) {
    case 'openai':
      return t('presetOpenAI')
    case 'anthropic':
      return t('presetAnthropic')
  }
}

/** 保存问题本地化。 */
function issueText(issue: SaveIssue, t: CapabilityApi['t']): string {
  switch (issue.code) {
    case 'model-id-empty':
      return t('issueModelIdEmpty')
    case 'model-not-saved':
      return t('issueModelNotSaved', { id: issue.id ?? '' })
    case 'models-not-configured':
      return t('issueModelsNotConfigured')
    case 'storage-conflict':
      return t('issueStorageConflict')
    case 'reasoning-only-off':
      return t('issueReasoningOnlyOff')
    case 'reasoning-wire-required':
      return t('issueReasoningWireRequired', { level: issue.level ?? '' })
  }
}

/** 定位席位所在的提供方卡片。 */
function cardRootOf(anchor: HTMLElement): HTMLElement | undefined {
  let node: HTMLElement | null = anchor
  while (node !== null) {
    if (node.matches('[class*="_rowCard"], [class*="_setupCard"]')) return node
    node = node.parentElement
  }
  return anchor.closest<HTMLElement>('li') ?? undefined
}

/**
 * 在提供方卡片里安装行内控件。
 * @param options - 锚点、settings 地址与 Host 操作面。
 * @returns 卸载句柄。
 */
export function augment(options: AugmentOptions): AugmentHandle {
  const cardRoot = cardRootOf(options.anchor)
  if (cardRoot === undefined) return { dispose: () => undefined }
  const card: HTMLElement = cardRoot
  ensureStyles()

  const { api } = options
  const t = api.t
  const settingsNs = options.settingsNs
  const settingsPath = [...options.settingsPath]
  // llm-deepseek 没有每模型思考强度（DeepSeek 的档位是提供方级的）；只有 pi-ai 有。
  const isDeepSeek = settingsNs === 'llm-deepseek'

  /** 本行是否由官方推理控件管理（判定规则在纯逻辑层，便于自测）。 */
  function officialManaged(state: RowState): boolean {
    return officialManagesRowReasoning(isDeepSeek, state.officialControl === true)
  }

  /** 本行是否由插件注入思考强度控件（0.2.0 的 pi-ai 行 / 0.2.1 官方没渲染控件的行）。 */
  function pluginManaged(state: RowState): boolean {
    return pluginManagesRowReasoning(isDeepSeek, state.officialControl === true)
  }

  const rows = new Map<HTMLElement, RowState>()
  let storedModels = new Map<string, JsonObject>()
  let userSection: unknown = undefined
  let resolvedSection: unknown = undefined
  let writable = true
  let applyArmed = false
  let writing = false
  let applying = false
  let disposed = false
  let hadEditor = false
  let syncQueued = false
  let visibleSnapshot: string[] | undefined
  let boundSubmit: HTMLButtonElement | undefined
  let boundCancel: HTMLButtonElement | undefined

  /** 官方模型行（`_modelEntry`）。 */
  function modelRowsOf(root: HTMLElement): HTMLElement[] {
    const entries = root.querySelectorAll<HTMLElement>('[class*="_modelEntry"]')
    if (entries.length > 0) return Array.from(entries)
    const list = root.querySelector<HTMLElement>('[class*="_modelList"]')
    if (list === null) return []
    return Array.from(list.children).filter(isHtmlElement)
  }

  /** 行的「容量」展开容器（`_modelAdvanced`）。 */
  function advancedOf(row: HTMLElement): HTMLElement | undefined {
    const direct = row.querySelector<HTMLElement>('[class*="_modelAdvanced"]')
    if (direct !== null) return direct
    for (const child of Array.from(row.children)) {
      if (!isHtmlElement(child)) continue
      if (child.className.includes('_modelRow')) continue
      if (child.querySelector('input') !== null) return child
    }
    return undefined
  }

  /** 行里的模型 ID 输入框（`_modelRow` 的第一个 input）。 */
  function modelIdInputOf(row: HTMLElement): HTMLInputElement | undefined {
    const line = row.querySelector<HTMLElement>('[class*="_modelRow"]') ?? row
    const input = line.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')
    return input ?? undefined
  }

  /** 行的当前模型 ID。 */
  function readModelId(row: HTMLElement): string {
    const input = modelIdInputOf(row)
    return input === undefined ? '' : input.value.trim()
  }

  /** 展开区里的两个官方容量输入框（排除插件自己的控件）。 */
  function officialCapacityInputs(advanced: HTMLElement): {
    context?: HTMLInputElement
    max?: HTMLInputElement
  } {
    const inputs = Array.from(advanced.querySelectorAll<HTMLInputElement>('input')).filter(
      (input) => input.closest('[data-dsh-mc]') === null,
    )
    return { context: inputs[0], max: inputs[1] }
  }

  /**
   * 用 React 认识的方式写受控输入框：绕过 value tracker 后派发 input 事件，
   * 官方 `onChange` 才会把值收进它自己的草稿。
   */
  function setReactInputValue(input: HTMLInputElement, value: string): void {
    if (input.value === value) return
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (descriptor?.set !== undefined) descriptor.set.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** 按 writable 统一切换控件可用性。 */
  function setControlsDisabled(state: RowState, disabled: boolean): void {
    const controls: (HTMLSelectElement | HTMLInputElement | HTMLButtonElement)[] = []
    if (state.presetSelect !== undefined) controls.push(state.presetSelect)
    if (state.capacityButton !== undefined) controls.push(state.capacityButton)
    for (const level of THINKING_LEVELS) {
      const check = state.levelChecks[level]
      if (check !== undefined) controls.push(check)
      const wire = state.levelInputs[level]
      if (wire !== undefined) controls.push(wire)
    }
    for (const control of controls) control.disabled = disabled
    if (!disabled) {
      for (const level of THINKING_LEVELS) {
        const check = state.levelChecks[level]
        const wire = state.levelInputs[level]
        if (check !== undefined && wire !== undefined) wire.disabled = !check.checked
      }
    }
  }

  /** 更新行内状态提示。 */
  function setStatus(state: RowState): void {
    const status = state.status
    if (status === undefined) return
    let text = ''
    let modifier = ''
    if (state.error !== undefined) {
      text = state.error
      modifier = ' dshMc_statusError'
    } else if (state.pending !== undefined) {
      text = t('pending')
    } else if (state.notice !== undefined) {
      text = t('notice')
      modifier = ' dshMc_statusSuccess'
    } else if (!writable) {
      text = t('readOnly')
    }
    const nextText = text
    const nextClass = `dshMc_status${modifier}`
    if (status.textContent !== nextText) status.textContent = nextText
    if (status.className !== nextClass) status.className = nextClass
  }

  /** 2.5 秒后清掉「已写入」。 */
  function scheduleNoticeClear(state: RowState): void {
    window.setTimeout(() => {
      if (disposed) return
      if (state.notice !== undefined) {
        state.notice = undefined
        setStatus(state)
      }
    }, 2500)
  }

  /** 思考强度的可读文本。 */
  function reasoningText(draft: ModelCapabilityDraft): string {
    const parts: string[] = []
    for (const level of THINKING_LEVELS) {
      const wire = draft.reasoning[level]
      if (wire === undefined) continue
      const trimmed = wire.trim()
      if (trimmed.length === 0 || trimmed === level) parts.push(level)
      else parts.push(`${level}→${trimmed}`)
    }
    return parts.length === 0 ? t('reasoningNone') : parts.join(' + ')
  }

  /** DeepSeek 的思考强度是提供方级的（reasoningEffort / thinking），只读展示。 */
  function providerReasoningText(): string {
    const profile = asRecord(getPath(resolvedSection, settingsPath))
    if (profile === undefined) return t('reasoningProviderDefault')
    if (profile.thinking === 'disabled') return t('reasoningNone')
    const effort = profile.reasoningEffort
    return typeof effort === 'string' && effort.length > 0 ? effort : t('reasoningProviderDefault')
  }

  /** 更新顶部「当前配置」摘要。 */
  function updateSummary(state: RowState): void {
    const summary = state.summary
    if (summary === undefined) return
    const draft = state.pending ?? state.stored ?? emptyDraft()
    const advanced = advancedOf(state.row)
    let context = '—'
    let max = '—'
    if (advanced !== undefined) {
      const inputs = officialCapacityInputs(advanced)
      if (inputs.context !== undefined) {
        context = inputs.context.value.trim() || inputs.context.placeholder || '—'
      }
      if (inputs.max !== undefined) {
        max = inputs.max.value.trim() || inputs.max.placeholder || '—'
      }
    }
    const text = t('summary', {
      reasoning: pluginManaged(state)
        ? reasoningText(draft)
        : officialManaged(state) ? t('reasoningOfficial') : providerReasoningText(),
      context,
      max,
    })
    // 值没变就不写：textContent 赋值会触发 MutationObserver，写回自己会自激循环。
    if (summary.textContent !== text) summary.textContent = text
  }

  /** 草稿 → 控件。 */
  function applyDraftToControls(state: RowState, draft: ModelCapabilityDraft): void {
    for (const level of THINKING_LEVELS) {
      const check = state.levelChecks[level]
      const wire = state.levelInputs[level]
      if (check === undefined || wire === undefined) continue
      const value = draft.reasoning[level]
      const checked = value !== undefined
      check.checked = checked
      wire.disabled = !checked
      wire.value = value ?? ''
    }
    if (state.presetSelect !== undefined) state.presetSelect.value = state.preset
    setControlsDisabled(state, !writable)
    updateSummary(state)
    setStatus(state)
  }

  /** 控件 → 草稿。 */
  function readDraftFromControls(state: RowState): ModelCapabilityDraft {
    const reasoning: Partial<Record<ThinkingLevel, string>> = {}
    for (const level of THINKING_LEVELS) {
      const check = state.levelChecks[level]
      const wire = state.levelInputs[level]
      if (check?.checked === true) reasoning[level] = wire?.value ?? ''
    }
    return { reasoning }
  }

  /** 任一控件变化：更新挂起草稿与提示。 */
  function onControlChanged(state: RowState): void {
    const draft = readDraftFromControls(state)
    state.error = undefined
    state.notice = undefined
    state.pending = draftsEqual(draft, state.stored ?? emptyDraft()) ? undefined : draft
    updateSummary(state)
    setStatus(state)
  }

  /** 展开时控件该显示的草稿：挂起值优先，其次已存值，未配置思考时套用预置默认。 */
  function initialDraftFor(state: RowState): ModelCapabilityDraft {
    const stored = state.stored ?? emptyDraft()
    // 官方管理的行没有插件档位可勾：一律显示已存值（= 不产生挂起草稿）。
    if (!pluginManaged(state) || state.reasoningConfigured) return stored
    return { reasoning: reasoningPreset(state.preset) }
  }

  /** 应用初始草稿；未配置思考的模型由此产生挂起改动（= 展开即套用预置）。 */
  function applyInitialDraft(state: RowState): void {
    const initial = state.pending ?? initialDraftFor(state)
    if (state.pending === undefined && !draftsEqual(initial, state.stored ?? emptyDraft())) {
      state.pending = initial
    }
    applyDraftToControls(state, initial)
  }

  /** 构建行内控件并写进 state。 */
  function buildControls(state: RowState): void {
    const container = el('div', 'dshMc_inline')
    container.dataset.dshMc = 'inline'

    const summary = el('p', 'dshMc_summary')
    summary.dataset.dshMc = 'summary'

    // 只有插件管理的 pi-ai 行才有每模型思考强度；DeepSeek 是提供方级，
    // 官方已渲染推理控件的行交给官方。
    let reasoningField: HTMLElement | undefined
    let presetSelect: HTMLSelectElement | undefined
    let levelChecks: Partial<Record<ThinkingLevel, HTMLInputElement>> = {}
    let levelInputs: Partial<Record<ThinkingLevel, HTMLInputElement>> = {}
    if (pluginManaged(state)) {
      const field = el('div', 'dshMc_field')
      field.append(el('span', 'dshMc_label', t('reasoning')))
      const preset = selectEl('dshMc_select')
      preset.dataset.dshMcField = 'preset'
      for (const id of REASONING_PRESET_IDS) preset.append(optionEl(id, presetLabel(id, t)))
      preset.value = state.preset
      field.append(preset)

      const levelsBox = el('div', 'dshMc_levels')
      const checks: Partial<Record<ThinkingLevel, HTMLInputElement>> = {}
      const inputs: Partial<Record<ThinkingLevel, HTMLInputElement>> = {}

      /** 按当前预置的词表重建档位行（切协议时整块换掉）。 */
      const buildLevels = (): void => {
        levelsBox.replaceChildren()
        for (const key of Object.keys(checks)) delete checks[key as ThinkingLevel]
        for (const key of Object.keys(inputs)) delete inputs[key as ThinkingLevel]
        for (const level of presetLevels(state.preset)) {
          const label = el('label', 'dshMc_level')
          const check = inputEl('checkbox', 'dshMc_check')
          check.dataset.dshMcField = `level-${level}`
          check.addEventListener('change', () => {
            const wire = inputs[level]
            if (wire !== undefined) {
              wire.disabled = !check.checked
              if (check.checked && wire.value === '') wire.value = level === 'off' ? '' : level
            }
            onControlChanged(state)
          })
          label.append(check, el('code', '', level))
          const wire = inputEl('text', 'dshMc_wire')
          wire.dataset.dshMcField = `wire-${level}`
          wire.disabled = true
          wire.placeholder = level === 'off' ? t('wireOffHint') : level
          wire.addEventListener('input', () => onControlChanged(state))
          checks[level] = check
          inputs[level] = wire
          levelsBox.append(label, wire)
        }
      }
      buildLevels()

      preset.addEventListener('change', () => {
        const next = preset.value
        if (!isPresetId(next)) return
        state.preset = next
        buildLevels()
        // 切协议：档位行换成该协议的词表，并按预置默认重新勾选（两家都是 off/low/high/max）。
        applyDraftToControls(state, { reasoning: reasoningPreset(next) })
        onControlChanged(state)
      })

      field.append(levelsBox, el('p', 'dshMc_hint', t('levelsHint')))
      reasoningField = field
      presetSelect = preset
      levelChecks = checks
      levelInputs = inputs
    }

    const actions = el('div', 'dshMc_actions')
    const capacityButton = buttonEl('dshMc_button', t('capacityPreset'))
    capacityButton.type = 'button'
    capacityButton.dataset.dshMcField = 'capacity'
    capacityButton.title = t('capacityHint')
    capacityButton.addEventListener('click', () => {
      const advanced = advancedOf(state.row)
      if (advanced === undefined) return
      const { context, max } = officialCapacityInputs(advanced)
      const preset = CAPACITY_PRESETS[0]
      if (preset === undefined) return
      if (context === undefined || max === undefined) return
      if (context.disabled || max.disabled) return
      setReactInputValue(context, preset.contextWindow)
      setReactInputValue(max, preset.maxTokens)
      updateSummary(state)
    })
    const status = el('span', 'dshMc_status')
    status.dataset.dshMc = 'status'
    actions.append(el('span', 'dshMc_label', t('capacityLabel')), capacityButton, status)

    container.append(summary)
    if (reasoningField !== undefined) container.append(reasoningField)
    else {
      container.append(
        el('p', 'dshMc_hint', t(officialManaged(state) ? 'reasoningOfficialHint' : 'reasoningProviderHint')),
      )
    }
    container.append(actions)

    state.container = container
    state.summary = summary
    state.presetSelect = presetSelect
    state.levelChecks = levelChecks
    state.levelInputs = levelInputs
    state.capacityButton = capacityButton
    state.status = status
  }

  /** 把控件注入一行的展开区，并尽量保留焦点。 */
  function injectRow(state: RowState, advanced: HTMLElement): void {
    const active = document.activeElement
    const activeField =
      active instanceof HTMLElement && state.container?.contains(active) === true ? active.dataset.dshMcField : undefined
    const selectionStart = active instanceof HTMLInputElement ? active.selectionStart : null
    state.container?.remove()
    buildControls(state)
    const container = state.container
    if (container === undefined) return
    advanced.append(container)
    applyInitialDraft(state)
    if (activeField !== undefined) {
      const next = container.querySelector<HTMLElement>(`[data-dsh-mc-field="${activeField}"]`)
      if (next !== null) {
        next.focus()
        if (next instanceof HTMLInputElement && selectionStart !== null) {
          try {
            next.setSelectionRange(selectionStart, selectionStart)
          } catch {
            // 非文本输入框没有 selection。
          }
        }
      }
    }
  }

  /** 用户层是否显式拥有 models[]。 */
  function userOwnsModels(): boolean {
    return isJsonArray(getPath(userSection, [...settingsPath, 'models']))
  }

  /** 该行是不是「新增模型」（用于 1M/128K 自动填入）。 */
  function isNewRow(modelId: string): boolean {
    if (modelId === '') return true
    if (!userOwnsModels()) return false
    return !storedModels.has(modelId)
  }

  /** 新行且官方容量为空时，自动填 1M / 128K。 */
  function autoFillCapacity(state: RowState, advanced: HTMLElement): void {
    if (state.capacitySeen === true) return
    const { context, max } = officialCapacityInputs(advanced)
    if (context === undefined || max === undefined) return
    if (context.disabled || max.disabled) return
    if (context.value.trim() !== '' || max.value.trim() !== '') {
      state.capacitySeen = true
      return
    }
    if (!isNewRow(state.modelId) && state.wasNew !== true) {
      state.capacitySeen = true
      return
    }
    const preset = CAPACITY_PRESETS[0]
    if (preset === undefined) return
    state.capacitySeen = true
    setReactInputValue(context, preset.contextWindow)
    setReactInputValue(max, preset.maxTokens)
    updateSummary(state)
  }

  /** 官方编辑器当前列出的全部模型 id。 */
  function visibleModelIds(): string[] {
    return modelRowsOf(card)
      .map((row) => readModelId(row))
      .filter((id) => id.length > 0)
  }

  /** 给官方容量输入框挂一个只更新摘要的监听（React 重渲染后重新挂）。 */
  function hookCapacitySummary(state: RowState, advanced: HTMLElement): void {
    const { context, max } = officialCapacityInputs(advanced)
    for (const input of [context, max]) {
      if (input === undefined) continue
      if (input.dataset.dshMcSummaryHook === 'true') continue
      input.dataset.dshMcSummaryHook = 'true'
      input.addEventListener('input', () => updateSummary(state))
    }
  }

  /** 读最新用户层并回填所有行。 */
  async function loadSettings(): Promise<void> {
    const outcome = await api.describe()
    if (disposed) return
    if (!outcome.ok) {
      const message = t('loadFailed', { message: `${outcome.code}: ${outcome.message}` })
      for (const state of rows.values()) {
        state.error = message
        setStatus(state)
      }
      return
    }
    const view = outcome.value.namespaces.find((candidate) => candidate.ns === settingsNs)
    if (view === undefined) {
      const message = t('loadFailed', { message: `namespace ${settingsNs} is not registered` })
      for (const state of rows.values()) {
        state.error = message
        setStatus(state)
      }
      return
    }
    writable = outcome.value.writable
    userSection = view.user
    resolvedSection = view.value
    storedModels = new Map(listStoredModels(userSection, settingsPath).map((model) => [model.id, model.entry]))
    for (const state of rows.values()) {
      const id = readModelId(state.row)
      state.modelId = id
      state.stored = draftFromEntry(storedModels.get(id))
      state.error = undefined
      if (state.pending === undefined) applyDraftToControls(state, state.stored)
      else {
        setControlsDisabled(state, !writable)
        updateSummary(state)
        setStatus(state)
      }
    }
  }

  /** 是否有挂起改动。 */
  function hasPending(): boolean {
    for (const state of rows.values()) if (state.pending !== undefined) return true
    return false
  }

  /** 丢弃挂起改动。 */
  function clearPending(): void {
    applyArmed = false
    for (const state of rows.values()) {
      state.pending = undefined
      state.error = undefined
      state.notice = undefined
      applyDraftToControls(state, state.stored ?? emptyDraft())
    }
  }

  /** 串行化：官方写入事件与卡片关闭可能同时触发同一次落盘。 */
  async function applyPending(): Promise<void> {
    if (writing || applying || disposed) return
    applying = true
    try {
      await applyPendingOnce()
    } finally {
      applying = false
    }
  }

  /** 官方保存后（或卡片关闭且官方没写）把挂起改动写进 settings。 */
  async function applyPendingOnce(): Promise<void> {
    if (writing || disposed) return
    const edits: SaveEdit[] = []
    const states: RowState[] = []
    for (const state of rows.values()) {
      if (state.pending === undefined) continue
      // 探测到官方推理控件的行绝不进入本次写入：不能把插件草稿里的
      // `reasoningEfforts` 写回官方管理的模型条目（会和官方草稿打架）。
      if (officialManaged(state)) {
        state.pending = undefined
        continue
      }
      const id = readModelId(state.row) || state.modelId
      if (id.trim().length === 0) continue
      state.modelId = id
      edits.push({ id, draft: state.pending })
      states.push(state)
    }
    if (edits.length === 0) {
      applyArmed = false
      return
    }
    const outcome = await api.describe()
    if (disposed) return
    if (!outcome.ok) {
      const message = t('loadFailed', { message: `${outcome.code}: ${outcome.message}` })
      for (const state of states) {
        state.error = message
        setStatus(state)
      }
      applyArmed = false
      return
    }
    const view = outcome.value.namespaces.find((candidate) => candidate.ns === settingsNs)
    if (view === undefined) {
      const message = t('loadFailed', { message: `namespace ${settingsNs} is not registered` })
      for (const state of states) {
        state.error = message
        setStatus(state)
      }
      applyArmed = false
      return
    }
    const plan = buildModelOps({
      userSection: view.user,
      settingsPath,
      edits,
      visibleModelIds: visibleSnapshot ?? visibleModelIds(),
      // pi-ai 的每模型 reasoningEfforts 仍归插件管（作用域只限真正注入了控件的行，
      // 官方管理的行已在上面被过滤掉）；DeepSeek 没有每模型字段。
      manageReasoning: !isDeepSeek,
    })
    if (plan.issues.length > 0) {
      for (const issue of plan.issues) {
        const message = issueText(issue, t)
        const target = issue.id === undefined ? states[0] : states.find((state) => state.modelId === issue.id)
        if (target !== undefined) {
          target.error = message
          setStatus(target)
        }
      }
      applyArmed = false
      return
    }
    if (plan.ops.length === 0) {
      for (const state of states) {
        state.pending = undefined
        state.notice = t('notice')
        setStatus(state)
        scheduleNoticeClear(state)
      }
      applyArmed = false
      return
    }
    writing = true
    try {
      const write = await api.mutate(settingsNs, plan.ops, view.revision)
      if (disposed) return
      if (!write.ok) {
        const message = t('saveFailed', { code: write.code, message: write.message })
        for (const state of states) {
          state.error = message
          setStatus(state)
        }
        return
      }
      userSection = write.value.user
      resolvedSection = write.value.value
      storedModels = new Map(listStoredModels(userSection, settingsPath).map((model) => [model.id, model.entry]))
      for (const state of states) {
        state.pending = undefined
        state.error = undefined
        state.notice = t('notice')
        state.stored = draftFromEntry(storedModels.get(state.modelId))
        applyDraftToControls(state, state.stored)
        scheduleNoticeClear(state)
        if (!card.contains(state.row)) rows.delete(state.row)
      }
    } finally {
      writing = false
      applyArmed = false
    }
  }

  /** 官方主按钮点击：挂起改动等官方写入完成后再落盘。 */
  function onApplyClick(event: Event): void {
    const button = event.currentTarget
    if (button instanceof HTMLButtonElement && button.disabled) return
    applyArmed = true
    visibleSnapshot = visibleModelIds()
  }

  /** 官方取消按钮点击：丢弃挂起改动。 */
  function onCancelClick(): void {
    clearPending()
  }

  /** 绑定官方编辑器的保存 / 取消按钮（按钮可能被 React 重建）。 */
  function bindEditorButtons(): void {
    const actions = card.querySelector<HTMLElement>('[class*="_editorActions"]')
    if (actions === null) {
      if (boundSubmit !== undefined) {
        boundSubmit.removeEventListener('click', onApplyClick, true)
        boundSubmit = undefined
      }
      if (boundCancel !== undefined) {
        boundCancel.removeEventListener('click', onCancelClick, true)
        boundCancel = undefined
      }
      return
    }
    const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>('button'))
    const submit = buttons[buttons.length - 1]
    const cancel = buttons[0]
    if (submit !== undefined && submit !== boundSubmit) {
      if (boundSubmit !== undefined) boundSubmit.removeEventListener('click', onApplyClick, true)
      boundSubmit = submit
      submit.addEventListener('click', onApplyClick, true)
    }
    if (cancel !== undefined && cancel !== boundCancel && cancel !== submit) {
      if (boundCancel !== undefined) boundCancel.removeEventListener('click', onCancelClick, true)
      boundCancel = cancel
      cancel.addEventListener('click', onCancelClick, true)
    }
  }

  /** 模型 ID 输入框变化：更新行的 id / 已存基线。 */
  function onIdInput(event: Event): void {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement)) return
    const row = input.closest<HTMLElement>('[class*="_modelEntry"]')
    if (row === null) return
    const state = rows.get(row)
    if (state === undefined) return
    const id = input.value.trim()
    if (id === state.modelId) return
    state.modelId = id
    state.stored = draftFromEntry(storedModels.get(id))
    if (state.pending === undefined) applyDraftToControls(state, state.stored)
    else updateSummary(state)
  }

  /** 对齐 DOM 与行状态：注入 / 重注入、绑定按钮、检测编辑器关闭。 */
  function sync(): void {
    if (disposed) return
    const editorOpen = card.querySelector('[class*="_editorActions"]') !== null
    const currentRows = modelRowsOf(card)
    const currentSet = new Set(currentRows)
    for (const row of Array.from(rows.keys())) {
      if (currentSet.has(row)) continue
      // 编辑器还开着却少了一行 = 用户删了它，挂起改动一并丢弃；
      // 编辑器已关闭 = 行是被 React 卸载的，带挂起改动的状态要留到 applyPending 用完。
      if (editorOpen || rows.get(row)?.pending === undefined) rows.delete(row)
    }
    for (const row of currentRows) {
      let state = rows.get(row)
      if (state === undefined) {
        const initialId = readModelId(row)
        const storedEntry = storedModels.get(initialId)
        state = {
          row,
          modelId: initialId,
          wasNew: initialId === '',
          // 关键：新建行状态时就把用户层已存值读进来，否则展开时控件全是空的。
          stored: draftFromEntry(storedEntry),
          reasoningConfigured: hasConfiguredReasoning(storedEntry),
          preset: DEFAULT_REASONING_PRESET,
          levelChecks: {},
          levelInputs: {},
        }
        rows.set(row, state)
      }
      const idInput = modelIdInputOf(row)
      if (idInput !== undefined && idInput !== state.idInput) {
        if (state.idInput !== undefined) state.idInput.removeEventListener('input', onIdInput)
        state.idInput = idInput
        idInput.addEventListener('input', onIdInput)
      }
      const id = readModelId(row)
      if (id !== state.modelId) {
        state.modelId = id
        const storedEntry = storedModels.get(id)
        state.stored = draftFromEntry(storedEntry)
        state.reasoningConfigured = hasConfiguredReasoning(storedEntry)
        if (state.pending === undefined) applyInitialDraft(state)
      }
      const advanced = advancedOf(row)
      if (advanced === undefined) {
        state.container = undefined
        continue
      }
      // 归属运行期探测：官方推理控件与展开区在官方的同一次 React 提交里渲染，
      // MutationObserver 回调（→ rAF 的 sync）看到的已经是提交后的 DOM，因此
      // 0.2.1 上第一次注入前就能探测到官方控件（不会出现双份），0.2.0 上没有
      // 该组件则注入插件控件。万一官方控件晚一帧出现，它本身就是 DOM 变更，
      // 会再触发 observer → 这里按行重建。
      const officialControl = detectOfficialReasoning(row)
      if (state.officialControl !== officialControl) {
        // 归属切换：官方刚接管 = 丢弃本行草稿（绝不把 reasoningEfforts 写回）；
        // 插件刚接管 = 用已存值重建控件。
        state.officialControl = officialControl
        state.pending = undefined
        state.error = undefined
        state.notice = undefined
        state.container?.remove()
        state.container = undefined
      }
      if (state.container === undefined || !advanced.contains(state.container)) {
        injectRow(state, advanced)
      }
      hookCapacitySummary(state, advanced)
      autoFillCapacity(state, advanced)
      updateSummary(state)
    }
    bindEditorButtons()
    if (hadEditor && !editorOpen && applyArmed && hasPending()) {
      // 官方卡片关闭 = 官方 applyOnce 已 await 完写入（有 op 才写）；此时再写不会
      // 被官方草稿覆盖。用 microtask 让 React 的这次 DOM 提交先结束。
      queueMicrotask(() => {
        void applyPending()
      })
    }
    hadEditor = editorOpen
  }

  /** 合并多次 DOM 变更为一次 sync；用 rAF 让出主线程，避免任何意外自激卡死页面。 */
  function scheduleSync(): void {
    if (syncQueued || disposed) return
    syncQueued = true
    const run = (): void => {
      syncQueued = false
      sync()
    }
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
    else window.setTimeout(run, 0)
  }

  const observer = new MutationObserver((records) => {
    // 插件自己控件里的文字变化（摘要 / 状态行）会再触发 observer；忽略它们，
    // 只对官方 DOM 的变化重新对齐，否则 microtask 自激会把页面卡死。
    for (const record of records) {
      if (!insideOwnControls(record.target)) {
        scheduleSync()
        return
      }
    }
  })
  observer.observe(card, { childList: true, subtree: true })

  const disposeSettings = api.onSettingsChanged(settingsNs, () => {
    if (disposed || writing) return
    void (async () => {
      await loadSettings()
      if (applyArmed && hasPending()) await applyPending()
    })()
  })

  void loadSettings().then(() => scheduleSync())
  sync()

  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      observer.disconnect()
      disposeSettings()
      if (boundSubmit !== undefined) boundSubmit.removeEventListener('click', onApplyClick, true)
      if (boundCancel !== undefined) boundCancel.removeEventListener('click', onCancelClick, true)
      for (const state of rows.values()) {
        if (state.idInput !== undefined) state.idInput.removeEventListener('input', onIdInput)
        state.container?.remove()
      }
      rows.clear()
    },
  }
}
