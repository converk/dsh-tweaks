/**
 * DeepSeek 提供方级思考字段（`thinking` / `reasoningEffort`）的纯逻辑。
 *
 * 官方 0.2.1 的模型设置页只给 `llm-pi-ai` / `llm-deepseek` 两个 family 渲染
 * `DeepSeekModelsEditor`；`llm-deepseek-account` 的 `layoutOf` 是 `unknown`，
 * 没有模型行可增补。所以 DeepSeek 的提供方级档位（account 唯一可用的思考开关）
 * 由插件在提供方卡片里补一个小面板，走 `settingsPath = []` 的根字段。
 *
 * 抽成纯模块便于自测，也避免把 schema 细节散在 React 组件里。
 */
import type { SettingsPathOp } from '../client/capability.js'

/** 提供方级思考字段的取值（空字符串 = 不写该字段，继承下层默认）。 */
export interface ProviderReasoning {
  thinking: '' | 'enabled' | 'disabled'
  effort: '' | 'off' | 'low' | 'high' | 'max'
}

/** 空值（全部继承）。 */
export function emptyProviderReasoning(): ProviderReasoning {
  return { thinking: '', effort: '' }
}

/** 从设置根分节读取这两个字段；非法/缺失一律当空。 */
export function providerReasoningFrom(value: unknown): ProviderReasoning {
  const root = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const thinking = root.thinking
  const effort = root.reasoningEffort
  return {
    thinking: thinking === 'enabled' || thinking === 'disabled' ? thinking : '',
    effort: effort === 'off' || effort === 'low' || effort === 'high' || effort === 'max' ? effort : '',
  }
}

/**
 * 校验两个字段的组合。
 *
 * `thinking: 'disabled'` 时只能 `effort: 'off'` 或留空；否则请求会同时要求
 * 「禁用思考」与「非 off 档」，DSH 的 DeepSeek 适配器会在 resolve 时抛错。
 * @returns `'thinking-disabled-effort'`（UI 按 code 本地化）；合法时 undefined。
 */
export function validateProviderReasoning(value: ProviderReasoning): 'thinking-disabled-effort' | undefined {
  if (value.thinking === 'disabled' && value.effort !== '' && value.effort !== 'off') {
    return 'thinking-disabled-effort'
  }
  return undefined
}

/**
 * 由当前值生成 settings.mutate 的 path ops（只写有变化的字段）。
 *
 * 空字符串 = unset（继承），非空 = set。两个字段都未变时返回空数组。
 * @param current - 当前已生效值。
 * @param next - 用户选择的值。
 * @returns path ops（顺序固定：thinking → reasoningEffort）。
 */
export function providerReasoningOps(
  current: ProviderReasoning,
  next: ProviderReasoning,
): SettingsPathOp[] {
  const ops: SettingsPathOp[] = []
  if (current.thinking !== next.thinking) {
    ops.push(next.thinking === ''
      ? { op: 'unset', path: ['thinking'] }
      : { op: 'set', path: ['thinking'], value: next.thinking })
  }
  if (current.effort !== next.effort) {
    ops.push(next.effort === ''
      ? { op: 'unset', path: ['reasoningEffort'] }
      : { op: 'set', path: ['reasoningEffort'], value: next.effort })
  }
  return ops
}
