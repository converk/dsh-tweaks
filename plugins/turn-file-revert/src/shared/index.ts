/**
 * host / client 共用的纯逻辑（无 node、无 DOM、无 React 依赖）。
 *
 * 这些模块是两侧唯一的「事实来源」：工具词表、路径展示、行差统计、RPC 协议。
 * 它不 import 任何官方包，也不 import 仓库内其他插件。
 */
export * from './diff.js'
export * from './mutation.js'
export * from './path.js'
export * from './protocol.js'
