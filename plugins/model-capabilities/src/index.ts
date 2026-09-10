/**
 * dsh-tweaks-model-capabilities — 宿主半区。
 *
 * 纯 UI 插件：全部行为在浏览器半区（`exports["./client"]`，经
 * package.json 的 `dsh.client` 声明被 DSH 扫描进 Web 启动图）。
 * 这里的空 `apply` 只为让插件出现在宿主组合树 / Loader 中。
 */

/** 宿主插件体 — 无宿主侧行为。 */
export function apply(): void {}
