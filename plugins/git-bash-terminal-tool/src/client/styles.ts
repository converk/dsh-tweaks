/**
 * 设置行的样式（自注入 `<style>`，不依赖任何 CSS-in-JS 依赖或官方哈希类名）。
 *
 * 视觉上对齐官方 General 行的惯例（参考 `dsh-client-ui-theme` 的 AppearanceRow）：
 * 标题一行、控件一行、说明一行，颜色一律用 `--dsw-alias-*` 变量，跟随主题。
 */

/** 注入的 `<style>` 标签标识（HMR/重复 apply 时用它去重）。 */
export const STYLE_TAG_ID = 'dsh-tweaks-git-bash-terminal-tool/row.css'

/** 行样式文本。 */
export const ROW_CSS = `
.tterm-group{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.tterm-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.tterm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tterm-chip{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:20px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;padding:8px 20px;cursor:pointer}
.tterm-chip:hover:not(:disabled):not(.tterm-chip-on){background:var(--dsw-alias-interactive-bg-hover)}
.tterm-chip-on{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-static-neutral-bluish-400)}
.tterm-chip:disabled{opacity:.45;cursor:not-allowed}
.tterm-input{box-sizing:border-box;flex:1 1 260px;min-width:200px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px}
select.tterm-input{cursor:pointer}
select.tterm-input:disabled{cursor:not-allowed}
.tterm-button{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:0 0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 14px;cursor:pointer}
.tterm-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tterm-button:disabled{opacity:.45;cursor:not-allowed}
.tterm-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tterm-error{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary));font-size:12px;line-height:18px}
`

/** 把样式注入 `<head>`（重复调用幂等）。 */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-tweaks-git-bash-terminal-tool'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = ROW_CSS
  document.head.appendChild(tag)
}
