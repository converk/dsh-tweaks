# dsh-tweaks-prompt-history

在 DSH 的会话输入框里按 **↑ / ↓**，翻出这个会话之前发过的提示词。

## 它能做什么

想改一改上次说过的话，不用翻聊天记录重打一遍——在输入框里按一下 ↑，上一次发过的提示词就回来了；接着按还能往更早翻。

## 怎么用

1. 点进输入框，确保里面是空的。
2. 按 **↑**：自动填上你上一次发过的提示词；再按 **↑** 继续往更早翻。
3. 按 **↓** 往回翻；翻过最新一条时，输入框恢复成你按 ↑ 之前的内容。
4. 翻到想要的 → 直接编辑，或者回车发送。

翻的过程中，输入框右上角会显示 `↑↓ 历史 3/12`，告诉你现在翻到第几条：

![输入框里按 ↑/↓ 召回本会话的历史提示词](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/prompt-history.png)

## 说明

- **只在输入框为空时才接管 ↑**：不会跟 `/` 命令菜单、`@` 引用菜单抢方向键，也不会打断正常编辑（输入法打字中、按着 Ctrl/Alt/Shift 时都不管）。
- **Shift+↑/↓ 放行**：保留编辑器自己的选择行为，不被历史召回拦截。
- **历史只属于当前会话**：包含你在运行中插话发过的内容；刷新页面后依然在。
- 一条消息里有多个 text 块时按换行连接，不会首尾相接地粘成一串。
- 直接开始打字就会退出历史浏览，已经填进输入框的内容会保留（「回忆出来直接改」）。
- 最多记 200 条。
- 角标文案跟随界面语言：中文「历史 n/N」，英文「History n/N」。

## 安装

```powershell
# 从 npm（推荐；需要 DSH >= 0.2.0）
npx @deepseek-ai/dsh plugin --profile web add dsh-tweaks-prompt-history

# 或从本仓库源码（开发调试）
npx @deepseek-ai/dsh plugin --profile web add "<仓库目录>/plugins/prompt-history"
```

重启 DSH，并在浏览器中强制刷新（`Ctrl + Shift + R`）。

> `web` 为 DSH 的 profile 名称；profile 配置在 DSH 主目录下的 `profiles/` 里：默认即用户目录下的
> `~/.dsh`（Windows 为 `%USERPROFILE%\.dsh`），若设置了 `DSH_HOME` 则以其为准。

## DSH 兼容性

- **支持范围**：最低 DSH **0.2.0**，按 **0.2.1 契约基线**核对；更高版本不做保证。
- 用到的关键契约：`conversation.input.overlay` 席位（`kind: 'list'` / `scope: 'session'` /
  `replaceRisk: 'none'`）、session 标准 props `useInput` / `inputActions` / `useChat`、
  `useChat(s => s.legacy.nodes)` 里 `kind: 'user' | 'steering'` 节点的文本块、
  `inputActions.setDraft(text)`、`locale.register` / `locale.bind`、client bundle 的
  `window.__ModuleLoader__` 加载协议。
- 权威契约位置（官方 d.ts 与客户端产物）见 [AGENTS.md](../../AGENTS.md) §3.9。

### 未受类型保护的脆弱点（已知限制）

- `[data-composer-card]` 是**运行时 DOM 判据，不在任何 d.ts 里**：官方改名或把 overlay 挂载点移出
  composer 卡片时，类型检查不会报警，`anchor.closest('[data-composer-card]')` 会返回 `null`，
  表现为 **↑/↓ 静默失效**（界面无反应、无报错）。升级 DSH 后复核这一条，要直接读运行时产物：
  确认 `"data-composer-card"` 与 `renderSlot("conversation.input.overlay")` 仍在同一个卡片节点内
  （`scripts/selftest.mjs` 已有这条官方产物断言，提供 DSH 部署路径时生效）。
- `useChat` / `useInput` / `inputActions` 是 Slot 运行时注入的 props，本插件用**结构投影**
  （`src/client/types.ts`）读取，**没有编译期保证**；升级 DSH 后同样要跑一遍真机冒烟（输入框为空时按 ↑）。
- 本插件有 `scripts/selftest.mjs`（CI 自动跑：bundle 协议 + 源码契约面 + 纯逻辑历史提取 + vm 驱动
  `apply` 的行为断言；官方产物段需要提供 DSH 部署路径，CI 上自动跳过）；**仍没有 clientsmoke**——
  键盘交互（Shift 放行、IME 组合期、相位判断）最终仍需真机冒烟。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
