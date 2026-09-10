/**
 * 行内控件样式注入。
 *
 * 只用与官方同页一致的 `--dsw-alias-*` 令牌，不发明颜色；注入方式照抄官方
 * client-ui 包的产物：`<style data-plugin="<包名>" data-plugin-css="<包名>/<模块>.module.css">`
 * 幂等判重，避免 HMR / 多次挂载重复插入。
 */

/** 本插件的包名（也是 `data-plugin` 的值）。 */
export const PLUGIN_ID = 'dsh-tweaks-model-capabilities'

/** CSS 模块标识（也是 `data-plugin-css` 的值）。 */
export const STYLE_ID = `${PLUGIN_ID}/inline.module.css`

const CSS = `
.dshMc_inline{display:flex;flex-direction:column;gap:10px;grid-column:1/-1;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px;margin-top:2px}
.dshMc_summary{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}
.dshMc_field{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshMc_label{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px;min-width:56px}
.dshMc_select{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:13px;line-height:20px;min-width:0;max-width:220px}
.dshMc_select:focus{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline:none}
.dshMc_select:disabled{opacity:.6;cursor:default}
.dshMc_levels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:6px 8px;align-items:center;width:100%}
.dshMc_level{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.dshMc_level code{font-family:var(--ds-font-family-code);font-size:12px}
.dshMc_check{margin:0;width:14px;height:14px;flex:none;accent-color:var(--dsw-alias-brand-primary,var(--dsw-alias-label-secondary))}
.dshMc_wire{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);height:28px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 8px;font-size:13px;line-height:20px;min-width:0}
.dshMc_wire:focus{border-color:var(--dsw-alias-brand-primary,var(--dsw-alias-border-l3));outline:none}
.dshMc_wire:disabled{opacity:.5}
.dshMc_radios{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dshMc_radio{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:pointer}
.dshMc_radio input{margin:0;accent-color:var(--dsw-alias-brand-primary,var(--dsw-alias-label-secondary))}
.dshMc_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}
.dshMc_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshMc_button{box-sizing:border-box;height:28px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:transparent;border:.5px solid var(--dsw-alias-border-l3);border-radius:14px;display:inline-flex;align-items:center;gap:4px;padding:0 10px;font-size:12px;line-height:18px}
.dshMc_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}
.dshMc_button:disabled{opacity:.5;cursor:default}
.dshMc_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dshMc_statusError{color:var(--dsw-alias-state-error-primary)}
.dshMc_statusSuccess{color:var(--dsw-alias-state-success-primary)}
`

/** 幂等注入行内控件样式（多次调用只插一次）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
