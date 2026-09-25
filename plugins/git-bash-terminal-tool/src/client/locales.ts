/**
 * 设置行的中英文案。命名空间由本插件独占（`terminal-tool`）。
 *
 * `t` 由 `locale.bind(NS)` 给出；locale 未就绪时退回 key。
 * 占位符用 `{name}`，与 LocaleRuntime 的插值规则一致。
 *
 * 只保留真正会被渲染的键：候选清单、来源标签（`Git for Windows` / `由 PATH 上的 git 反推` …）
 * 与 `bash --version` 那一坨已经删掉 —— 路径栏本身就是选择器，不需要把扫描细节摊在设置页里。
 */

/** 本插件的 locale 命名空间。 */
export const LOCALE_NS = 'terminal-tool'

/** 中文文案（键集的事实来源）。 */
export const zh: Record<string, string> = {
  'row.title': '终端工具',
  'row.dialect.pwsh': 'PowerShell（pwsh）',
  'row.dialect.bash': 'Git Bash（bash）',
  'row.path.label': 'Git Bash 路径',
  'row.path.placeholder': '例如 D:/env/msys2/usr/bin/bash.exe',
  'row.path.none': '尚未选择',
  'row.path.missing': '还没选 Git Bash 路径：点「自动发现」扫一遍，或直接填一个 bash.exe 的绝对路径。',
  'row.discover': '自动发现',
  'row.discovering': '正在扫描…',
  'row.foundNone': '没有找到任何 Git Bash（既不是 Git for Windows，也不是 MSYS2/Cygwin）。',
  'row.newSession': '更改对新会话生效（运行中的会话保持启动时的选择）。',
  'row.notSupported': '当前版本不支持自动切换：{reason}',
  'row.saveFailed': '保存失败：{message}',
  'row.rejected': '宿主拒绝了这次保存（revision 冲突或字段不可编辑），请刷新后重试。',
  'row.unavailable': '宿主设置服务不可用（设置无法保存）。',
}

/** 英文文案（键集与中文一致）。 */
export const en: Record<keyof typeof zh, string> = {
  'row.title': 'Terminal tool',
  'row.dialect.pwsh': 'PowerShell (pwsh)',
  'row.dialect.bash': 'Git Bash (bash)',
  'row.path.label': 'Git Bash path',
  'row.path.placeholder': 'e.g. D:/env/msys2/usr/bin/bash.exe',
  'row.path.none': 'not chosen yet',
  'row.path.missing': 'No Git Bash path yet: click "Auto-detect", or type the absolute path to a bash.exe.',
  'row.discover': 'Auto-detect',
  'row.discovering': 'Scanning…',
  'row.foundNone': 'No Git Bash found (neither Git for Windows nor MSYS2/Cygwin).',
  'row.newSession': 'Changes apply to new sessions (running sessions keep the shell they started with).',
  'row.notSupported': 'Not supported by this DSH version: {reason}',
  'row.saveFailed': 'Save failed: {message}',
  'row.rejected': 'The host rejected this save (revision conflict or a non-editable field). Refresh and retry.',
  'row.unavailable': 'Host settings service unavailable (settings cannot be saved).',
}
