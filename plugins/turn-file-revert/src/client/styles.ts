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
  // [hidden] 的 UA 默认 display:none 会被下面这些显式 display 盖掉（.dshTfr_root 是
  // flex、.dshTfr_button 是 inline-flex），必须自己补一条：否则「本回合没有文件改动」
  // 时仍会留下一个空行，以及一个空的按钮胶囊（看起来像一小段横线）。
  '[data-dsh-tfr][hidden]{display:none}',
  // 三个部分（增减行数 / 文件数 / 按钮）的直接子节点间距：24px ≈ 原 8px 的三倍。
  '.dshTfr_root{display:flex;flex-wrap:wrap;align-items:center;gap:24px;margin-top:8px;',
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
  // 非最后一轮：不可点但仍要能 hover 出 title 提示（见 augment.ts 的 aria-disabled 用法）。
  '.dshTfr_button[aria-disabled="true"]{opacity:.5;cursor:not-allowed}',
  '.dshTfr_button[aria-disabled="true"]:hover{background:0 0}',
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
