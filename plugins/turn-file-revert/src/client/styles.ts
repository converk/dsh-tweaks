/**
 * 本插件自己的样式（`data-plugin-css` 幂等注入）。
 *
 * 只定义本插件元素用的类（`dshTfr_*`），颜色一律走主题变量，因此在亮/暗主题
 * 下都跟着官方走；绝不覆盖官方类名。
 */

/** 样式标签的稳定标识（重复 apply 时靠它去重）。 */
const STYLE_ID = 'dsh-tweaks-turn-file-revert/panel.css'

/** 本插件的 CSS。 */
const CSS = [
  '.dshTfr_root{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px;',
  'font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta,0px));',
  'color:var(--dsw-alias-label-secondary)}',
  '.dshTfr_stats{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}',
  '.dshTfr_added{color:var(--dsw-alias-state-success-primary);font-weight:500}',
  '.dshTfr_removed{color:var(--dsw-alias-state-error-primary);font-weight:500}',
  '.dshTfr_files{color:var(--dsw-alias-label-tertiary)}',
  // 按钮刻意用常规文字色：撤回/重新应用都是普通动作，不做红/蓝的语义着色。
  '.dshTfr_button{font:inherit;color:var(--dsw-alias-label-secondary);background:0 0;',
  'border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0 8px;cursor:pointer;',
  'line-height:20px;transition:background-color .12s}',
  '.dshTfr_button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dshTfr_button:disabled{opacity:.5;cursor:default}',
  '.dshTfr_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.dshTfr_status{color:var(--dsw-alias-label-tertiary)}',
  '.dshTfr_status[data-kind="ok"]{color:var(--dsw-alias-state-success-primary)}',
  '.dshTfr_status[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
].join('')

/**
 * 幂等注入样式：同一个页面重复 apply（HMR）时不会叠加 style 标签。
 * @returns 无。
 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-tweaks-turn-file-revert'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
