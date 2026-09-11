/**
 * 角标文案（zh / en）。
 *
 * 命名空间由本插件独占；`t` 由 `locale.bind(NS)` 给出，locale 未就绪时退回 key。
 * 占位符用 `{name}`，与 LocaleRuntime 的插值规则一致。
 */

/** 本插件的 locale 命名空间。 */
export const LOCALE_NS = 'prompt-history'

/** 中文文案（键集的事实来源）。 */
export const zh: Record<string, string> = {
  position: '历史 {n}/{total}',
  browseTitle: '历史提示词（↑ / ↓ 切换）',
}

/** 英文文案（键集与中文一致）。 */
export const en: Record<keyof typeof zh, string> = {
  position: 'History {n}/{total}',
  browseTitle: 'Prompt history (↑ / ↓ to browse)',
}
