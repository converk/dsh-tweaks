/**
 * 本插件的文案（zh / en）。
 *
 * 命名空间由本插件独占；`t` 由 `locale.bind(NS)` 给出，locale 未就绪时退回 key。
 */

/** 本插件的 locale 命名空间。 */
export const LOCALE_NS = 'turn-file-revert'

/** 中文文案。 */
export const zh: Record<string, string> = {
  label: '本轮改动情况：',
  addedLines: '+{count} 行',
  removedLines: '−{count} 行',
  files: '{count} 个文件',
  notLatest: '该轮对话改动现在不支持撤回/恢复',
  revertAll: '撤回全部修改',
  reapplyAll: '重新应用修改',
  reverting: '撤回中…',
  reapplying: '重新应用中…',
  reverted: '已撤回本回合修改',
  reapplied: '已重新应用本回合修改',
  partial: '{count} 个文件处理失败：{message}',
  overwrote: '覆盖了 {count} 个已被改动的文件',
  failed: '失败：{message}',
  newFile: '新建',
  tipHeader: '本回合改动 {count} 个文件',
  tipLine: '{path}  +{added} −{removed}',
  tipMore: '…另有 {count} 个文件',
  tipBlocked: '另有 {count} 个文件没有内容快照（过大或二进制），无法撤回/重放',
}

/** 英文文案。 */
export const en: Record<string, string> = {
  label: 'Changes this turn:',
  addedLines: '+{count} lines',
  removedLines: '−{count} lines',
  files: '{count} files',
  notLatest: 'Only the latest turn of this session can be reverted or reapplied',
  revertAll: 'Revert all changes',
  reapplyAll: 'Reapply changes',
  reverting: 'Reverting…',
  reapplying: 'Reapplying…',
  reverted: 'Reverted this turn',
  reapplied: 'Reapplied this turn',
  partial: '{count} files failed: {message}',
  overwrote: 'overwrote {count} already-changed files',
  failed: 'Failed: {message}',
  newFile: 'new',
  tipHeader: '{count} files changed this turn',
  tipLine: '{path}  +{added} −{removed}',
  tipMore: '…and {count} more files',
  tipBlocked: '{count} files have no content snapshot (too large or binary) and cannot be reverted or reapplied',
}
