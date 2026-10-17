/**
 * 行内控件文案字典。
 *
 * 用内置 locale 的三参非类型化形态注册（本插件无法 import 官方
 * `LocaleNamespaceMap`，也不该为了类型去依赖官方包）：
 * `ctx.locale.register(NS, 'zh', zh)` / `(NS, 'en', en)` + `ctx.locale.bind(NS)`。
 * 占位符用 `{name}`，与 LocaleRuntime 的插值规则一致。
 */

/** 本插件的 locale 命名空间。 */
export const LOCALE_NS = 'model-capabilities'

/** 中文文案（键集的事实来源）。 */
export const zh = {
  reasoning: '思考强度',
  reasoningNone: '不支持思考',
  preset: '协议预置',
  presetOpenAI: 'OpenAI',
  presetAnthropic: 'Anthropic',
  levelsHint: '都不勾选 = 该模型不支持思考（写 false）；未勾选的档位会被钉成不支持。',
  reasoningProviderHint:
    'DeepSeek 适配器没有每模型思考强度；档位由提供方级 reasoningEffort / thinking 控制（settings.yaml）。',
  reasoningOfficial: '由官方模型行控件管理',
  reasoningOfficialHint: '思考强度由官方模型行原生的推理控件管理；本插件只补充容量快捷填入。',
  reasoningProviderDefault: '提供方默认',
  providerTitle: '提供方级思考（DeepSeek）',
  providerHint: 'DeepSeek 的每模型档位由目录决定；这里补的是提供方级 thinking / reasoningEffort。',
  providerThinking: '思考开关',
  providerEffort: '默认强度',
  providerDefault: '继承默认',
  providerEnabled: '启用',
  providerDisabled: '禁用',
  providerWrite: '写入',
  providerSaved: '已写入',
  providerConflict: 'thinking 为 disabled 时 reasoningEffort 只能是 off 或留空',
  providerLoadFailed: '读取提供方设置失败：{message}',
  providerWriteFailed: '写入提供方设置失败：{message}',
  wireOffHint: '留空 = 不发参数',
  capacityLabel: '上下文长度与最大输出长度：',
  capacityPreset: '1M / 128K',
  capacityHint: '把官方「上下文窗口 / 最大输出」输入框填成 1000000 / 131072',
  summary: '当前：思考 {reasoning} · 上下文 {context} / 输出 {max}',
  pending: '已改，点官方「保存」后写入',
  notice: '已写入',
  readOnly: '设置只读',
  saveFailed: '写入失败：{code} {message}',
  loadFailed: '读取设置失败：{message}',
  issueModelIdEmpty: '模型 ID 不能为空',
  issueModelNotSaved: '{id} 还没保存；请先点官方「保存」',
  issueModelsNotConfigured: '读不到模型列表，请先点官方「保存」',
  issueStorageConflict: '该路由同时存在 models 与 modelOverrides，请先修正 settings.yaml',
  issueReasoningOnlyOff: '只勾 off 等于「不发参数」，还需要至少一个非 off 档；都不勾 = 不支持思考',
  issueReasoningWireRequired: '{level} 档必须填写过线拼写',
} as const

/** 英文文案（键集与中文一致）。 */
export const en: Record<keyof typeof zh, string> = {
  reasoning: 'Reasoning effort',
  reasoningNone: 'Does not reason',
  preset: 'Protocol preset',
  presetOpenAI: 'OpenAI',
  presetAnthropic: 'Anthropic',
  levelsHint: 'No level ticked means the model does not reason (writes false); unticked levels are pinned unsupported.',
  reasoningProviderHint:
    'The DeepSeek adapter has no per-model reasoning effort; levels come from the provider-level reasoningEffort / thinking fields (settings.yaml).',
  reasoningOfficial: 'Managed by the official model-row controls',
  reasoningOfficialHint: 'Reasoning effort is managed by the official model-row reasoning controls; this plugin only adds the capacity shortcut.',
  reasoningProviderDefault: 'provider default',
  providerTitle: 'Provider-level reasoning (DeepSeek)',
  providerHint: 'Per-model levels come from the catalog; this panel writes the provider-level thinking / reasoningEffort fields.',
  providerThinking: 'Thinking',
  providerEffort: 'Default effort',
  providerDefault: 'Inherit default',
  providerEnabled: 'Enabled',
  providerDisabled: 'Disabled',
  providerWrite: 'Write',
  providerSaved: 'Written',
  providerConflict: 'reasoningEffort can only be off or unset when thinking is disabled',
  providerLoadFailed: 'Failed to read provider settings: {message}',
  providerWriteFailed: 'Failed to write provider settings: {message}',
  wireOffHint: 'Blank = send no parameter',
  capacityLabel: 'Context window & max output:',
  capacityPreset: '1M / 128K',
  capacityHint: 'Fill the official context window / max output inputs with 1000000 / 131072',
  summary: 'Current: reasoning {reasoning} · context {context} / output {max}',
  pending: 'Changed — click the official Save to write',
  notice: 'Written',
  readOnly: 'Settings are read-only',
  saveFailed: 'Write failed: {code} {message}',
  loadFailed: 'Reading settings failed: {message}',
  issueModelIdEmpty: 'Model ID must not be empty',
  issueModelNotSaved: '{id} is not saved yet; click the official Save first',
  issueModelsNotConfigured: 'No model list could be read; click the official Save first',
  issueStorageConflict: 'This route carries both models and modelOverrides; fix settings.yaml first',
  issueReasoningOnlyOff: 'Off alone means "send nothing"; add at least one non-off level, or untick all for no reasoning',
  issueReasoningWireRequired: 'Level {level} needs its wire spelling',
}
