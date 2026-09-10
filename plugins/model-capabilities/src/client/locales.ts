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
  presetCustom: '自定义',
  presetOpenAI: 'OpenAI 兼容',
  presetAnthropic: 'Anthropic',
  levelsHint: '都不勾选 = 该模型不支持思考（写 false）；未勾选的档位会被钉成不支持。',
  reasoningProviderHint:
    'DeepSeek 适配器没有每模型思考强度；档位由提供方级 reasoningEffort / thinking 控制（settings.yaml）。',
  reasoningProviderDefault: '提供方默认',
  wireOffHint: '留空 = 不发参数',
  input: '多模态',
  inputText: '文本',
  inputTextImage: '文本+图片',
  capacityPreset: '1M / 128K',
  capacityHint: '把官方「上下文窗口 / 最大输出」输入框填成 1000000 / 131072',
  summary: '当前：思考 {reasoning} · 多模态 {input} · 上下文 {context} / 输出 {max}',
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
  presetCustom: 'Custom',
  presetOpenAI: 'OpenAI-compatible',
  presetAnthropic: 'Anthropic',
  levelsHint: 'No level ticked means the model does not reason (writes false); unticked levels are pinned unsupported.',
  reasoningProviderHint:
    'The DeepSeek adapter has no per-model reasoning effort; levels come from the provider-level reasoningEffort / thinking fields (settings.yaml).',
  reasoningProviderDefault: 'provider default',
  wireOffHint: 'Blank = send no parameter',
  input: 'Multimodal',
  inputText: 'Text',
  inputTextImage: 'Text + images',
  capacityPreset: '1M / 128K',
  capacityHint: 'Fill the official context window / max output inputs with 1000000 / 131072',
  summary: 'Current: reasoning {reasoning} · multimodal {input} · context {context} / output {max}',
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
