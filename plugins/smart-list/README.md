# dsh-tweaks-smart-list

在 DSH 的输入框里写列表时，按 **Shift+Enter** 换行后**自动补上下一个编号**——
`1. 事项` ↵ `2. 事项` ↵ `3. …`，不用每次自己敲编号。

> 名字里 `smart-list` = 「智能列表」；它**不改变 DSH 的输入框结构**，只是把
> 「换行 + 下一个标记」一次敲完（原理见下文「和 Codex 的列表格式有什么区别」）。

## 它能做什么

在会话输入框里输入：

```
1. 把 DSH 0.2.1 的契约核对一遍
```

按 **Shift+Enter** 后，新的一行自动变成：

```
2. 
```

直接接着敲第二项就行；再按 Shift+Enter 会继续出现 `3. `、`4. `……

![在输入框里连续按 Shift+Enter，列表自动 1 → 2 → 3 续号](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/smart-list.png)

支持：

- **有序列表**：`1. `、`1) `、`1、`、`1）`（中文分隔符可以不跟空格，如 `1、事项`）。
- **无序列表**：`- `、`* `、`+ `、`• `。
- **缩进**：`  1. 子项` → 换行后还是 `  2. `；层内编号单独递增。
- **前导零**：`01. ` → `02. `（保持宽度）；`9. ` → `10. ` 正常进位。
- **行中换行**：光标在行中间时按 Shift+Enter，会把后半行拆到新条目里。
- **空条目自动停**：如果当前是 `2. ` 这种还没写内容的空条目，按 Shift+Enter
  只换行、不再生成 `3. `，方便自然结束列表。

## 怎么用

1. 在输入框里输入第一条：`1. 第一件事`（或 `1、第一件事`、`- 第一件事`）。
2. 按 **Shift+Enter** 换行——新行自动带上 `2. `（无序列表则重复 `- `）。
3. 继续写第二项；再按 Shift+Enter 继续。写完正常按 **Enter** 发送。

> 普通 **Enter** 仍然是发送，插件只接管 **Shift+Enter**。

## 说明与边界

- **只接管 Shift+Enter**：普通 Enter 发送、Ctrl/Meta/Alt 组合键、输入法组合期、
  有选区（选中了一段文本）时都不接管；`/` 命令、`@` 引用菜单照常工作。
- **不整段重写草稿**：插入走官方公开的 `inputActions.insertText()`，不会动你在
  草稿里的 `@` 文件引用 / `/` 命令 chip，也不会把光标丢到末尾。
- **空条目只换行**：`2. ` 后面没有正文时按 Shift+Enter 会停留在空行（`2. ` 还在，
  按删除键删掉即可）——不会再冒出 `3. `、`4. `。
- **只对光标所在行生效**：行首不是「编号/符号 + 正文」时完全不干预。
- 当前版本**没有设置项**；行为固定为「有序 + 无序 + 缩进 + 空条目停」。

### 和 Codex 的列表格式有什么区别

你在 Codex / ChatGPT 输入框里看到「敲下 `1. ` 后编号整体右移」是因为它们是
**富文本列表**：`1. ` 被转成了列表块的 marker，编号是块属性而不是正文文本。DSH 的
composer 是 Lexical 的普通段落 + 软换行（没有列表节点，也不支持 Markdown 隐式格式），
所以这里用**纯文本续号**达到同样的操作体验：

- 好处：不动文档结构，不碰 `@` / `/` chip，不破坏撤销历史，视觉上也和普通文本一致；
- 代价：没有 Codex 那种「编号块缩进 / 自动重排」的隐形格式。

如果以后 DSH 的 composer 暴露了列表节点或 Markdown 自动格式，这个插件可以再升级成
块级列表。

## 安装

从 npm 安装：

```powershell
npx @deepseek-ai/dsh plugin --profile web add dsh-tweaks-smart-list
```

也可以从本仓库源码安装（开发调试）：

```powershell
npx @deepseek-ai/dsh plugin --profile web add "<仓库目录>/plugins/smart-list"
```

这是纯浏览器半区插件，安装后**刷新浏览器**（`Ctrl + Shift + R`）即可，不需要重启 DSH 宿主。

> `web` 为 DSH 的 profile 名称；profile 配置在 DSH 主目录下的 `profiles/` 里：默认即用户目录下的
> `~/.dsh`（Windows 为 `%USERPROFILE%\.dsh`），若设置了 `DSH_HOME` 则以其为准。

## DSH 兼容性

- **支持范围**：最低 DSH **0.2.0**，按 **0.2.1 契约基线**核对；更高版本不做保证。
- 用到的关键契约：`conversation.input.overlay` 席位（`kind: 'list'` / `scope: 'session'` /
  `replaceRisk: 'none'`）、session 标准 props `useInput` / `inputActions`；
  `InputActions.captureInsertion(): TokenSpan` 与 `insertText(text, span)`（插件唯一的文本插入入口）、
  `TokenSpan { start, end, draftRev }`、`InputState.phase === 'plain'`；composer 可编辑根把字面
  `\n` 当换行渲染（`white-space: pre-wrap`），官方粘贴路径同样用 `selection.insertText` 接收多行文本；
  `[data-composer-card]` 与 overlay 的渲染邻接；client bundle 的 `window.__ModuleLoader__` 加载协议。
- 权威契约位置（官方 d.ts 与客户端产物）见 [AGENTS.md](../../AGENTS.md) §3.9。

### 未受类型保护的脆弱点（已知限制）

- `[data-composer-card]` / `[contenteditable="true"]` 是**运行时 DOM 判据，不在任何 d.ts 里**：
  官方改名或把 overlay 挂载点移出 composer 卡片时，类型检查不会报警，
  `anchor.closest('[data-composer-card]')` 会返回 `null`，表现为 **Shift+Enter 静默失效**。
  升级 DSH 后复核这一条，要直接读运行时产物：确认 `"data-composer-card"` 与
  `renderSlot("conversation.input.overlay"` 仍在同一段代码里。
- **Shift+Enter 的默认处理来自 Lexical 的 `KEY_ENTER_COMMAND`（优先级 0）**：它会自己插入
  软换行，所以插件成功插入后在 **捕获相** 同时 `preventDefault + stopPropagation`，
  让这次 Shift+Enter 只有「插件插入的换行 + 标记」一个效果。升级 DSH 后要真机复核
  Shift+Enter 是否只换一行。
- **字面 `\n` 依赖 composer 的 `white-space: pre-wrap`，也依赖 DSH 自己的粘贴路径继续用
  `selection.insertText` 接收多行文本**；若官方改成强制拆段，插入行为需重新评估。
  `scripts/selftest.mjs` 已把这两条运行期语义钉成断言（提供 DSH 部署路径时生效）。
- `scripts/selftest.mjs` 不需要 DSH 部署即可跑大部分断言：bundle 协议、源码契约面、
  列表标记推导、假 DOM 行提取、vm 里驱动 overlay 组件的按键行为（含不接管场景）；
  提供 DSH 部署路径时（`DSH_CONTRACT_HOMES`）追加官方产物原文/结构断言。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
