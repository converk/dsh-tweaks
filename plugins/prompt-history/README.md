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

- **只在输入框为空时才接管 ↑**：不会跟 `/` 命令菜单、`@` 引用菜单抢方向键，也不会打断正常编辑（输入法打字中、按着 Ctrl/Alt 时都不管）。
- **历史只属于当前会话**：包含你在运行中插话发过的内容；刷新页面后依然在。
- 直接开始打字就会退出历史浏览，已经填进输入框的内容会保留（"回忆出来直接改"）。
- 最多记 200 条。
- 角标文案跟随界面语言：中文「历史 n/N」，英文「History n/N」。

## 安装

```powershell
npx @deepseek-ai/dsh plugin --profile web add "D:\你的目录\dsh-tweaks\plugins\prompt-history"
```

重启 DSH，并在浏览器中强制刷新（`Ctrl + Shift + R`）。

> `web` 为 DSH 的 profile 名称，可在 `C:\Users\你的用户名\.dsh\profiles\` 下确认。

## DSH 兼容性（本次审计）

- **最低支持 DSH 0.1.7**。本次逐条核对的版本：**0.1.7-rc.2** 与 **0.2.0-rc.2**（两份完整安装）。
- 核对方式：直接读官方产物（`lib/types/**/*.d.ts` 与已构建的 `lib/client.js`），对同名文件做 sha256
  逐字比对；类型看不出的地方再读运行时产物里的真实结构。路径都是相对 `<dsh>/node_modules/@deepseek-ai/`。
- **结论：本插件依赖的契约在 0.2.0 全部仍然成立，没有需要修的真失效 → 本次未改动运行期代码。**
  下表里「未变」= 两版文件 sha256 完全相同；「兼容增补」= 文件有改动但本插件用到的成员逐字未变。

| 本插件用到的契约 | 官方产物位置（相对 `<dsh>/node_modules/@deepseek-ai/`） | 两版核对结果 |
|---|---|---|
| overlay 席位键 `conversation.input.overlay`（`kind: 'list'` / `scope: 'session'`） | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts` L220 | **未变**（整文件同哈希 `e02c4d3f…`） |
| 会话标准 props `useInput` / `inputActions` | 同上 L336 / L338 | **未变** |
| `useChat` 标准 prop | `dsh-client-ui-chat/lib/types/client/contract/slots.d.ts` L223 | **未变**（`77aeeff0…`） |
| `useChat(s => s.legacy.nodes)`：`LegacyConversationSlice` / `ChatSnapshot.legacy` | `dsh-client-ui-chat/lib/types/client/contract/snapshot.d.ts` L79 / L96 | **未变**（`7ec9af61…`）；运行时 `LegacySliceBuilder` 前 3000 字符两版逐字相同 |
| 节点 `kind: 'user' \| 'steering'` + `content: readonly ContentBlock[]` | `dsh-client-ui-conversation/lib/types/client/contract/records.d.ts` L45 / L88 | **未变**（整文件 sha256 两版完全相同 `cbf5d7bf…`）；运行时构造 `{kind, content: event.data.content}` 两版逐字相同 |
| 文本块 `{ type: 'text'; text: string }` | `dsh-llm/lib/types/types.d.ts` L46 | **未变**（整文件两版相同 `6b7f5b81…`） |
| `inputActions.setDraft(text)` | `dsh-client-ui-conversation/lib/types/client/contract/input.d.ts` L206 / L217 | **兼容增补**：文件新增了可选 `submit(mode, source?)` / `MessageSubmission` 等，`InputActions` 成员逐字未变 |
| `snapshot.draft` / `snapshot.phase === 'plain'` | 同上 L238 / L243（`'plain' \| 'adjudicating' \| 'claimed' \| 'submitting'`） | **兼容增补**（成员逐字未变） |
| `slots.inject(key, cb)` / `slots.register({ name, id, order }, el)` | `dsh-client-ui-renderer/lib/types/client/registry.d.ts` L111 / L85；服务名 `ctx.slots` 见同包 `client/index.d.ts` L27 | **未变**（`8a3219d3…`）；注册语义在 `dsh-client-ui-slots`，该包 d.ts 两版同哈希 `3eb9c5ec…` |
| `locale.register(ns, lang, dict)` / `locale.bind(ns)` | `dsh-client-locale/lib/types/client/index.d.ts` L209 / L226 | **未变**（该 d.ts 与 `dsh-client-locale/lib/client.js` 两版同哈希） |
| DOM 判据 `[data-composer-card]`（键盘作用域限定） | 运行时产物 `dsh-client-ui-conversation/lib/client.js` | **未变**：`"data-composer-card"` 在 0.1.7 L17367 / 0.2.0 L17444；`renderSlot("conversation.input.overlay")` 仍位于同一张卡片节点内部（L17375 / L17452） |
| client bundle 加载协议 `window.__ModuleLoader__.load({ id, factory })` | `dsh-client-modules` | **未变**（除 `package.json` 外整包同哈希）；页面 react 种子模块表仍映射 `react` / `react/jsx-runtime`，`dsh-web-frontend/dist/assets/vendor-*.js` 两版字节完全相同 |

> 0.2.0 里 `dsh-client-ui-chat` 确实有 7 个 d.ts 改动
> （`chat-settings` / `index` / `client/apply` / `client/locale` / `client/transcript-view` /
> `client/message-chrome` / `client/TurnProcessNodeView`），但**没有一个落在本插件的契约面上**：
> 它们是设置 schema、内部时长格式化、chat 自己的 locale 键改名等。

### 未受类型保护的脆弱点（已知限制）

- `[data-composer-card]` 是**运行时 DOM 判据，不在任何 d.ts 里**：官方改名或把 overlay 挂载点移出
  composer 卡片时，类型检查不会报警，`anchor.closest('[data-composer-card]')` 会返回 `null`，
  表现为 **↑/↓ 静默失效**（界面无反应、无报错）。升级 DSH 后复核这一条，要直接读运行时产物：
  确认 `"data-composer-card"` 与 `renderSlot("conversation.input.overlay")` 仍在同一个卡片节点内。
- `useChat` / `useInput` / `inputActions` 是 Slot 运行时注入的 props，本插件用**结构投影**
  （`src/client/types.ts`）读取，**没有编译期保证**；升级 DSH 后同样要跑一遍真机冒烟（输入框为空时按 ↑）。
- 本插件当前**没有** `scripts/selftest.mjs` / `clientsmoke.mjs`，CI 只能覆盖 `build.mjs` 与
  `tsc --noEmit`；上面两条因此只能靠人工/真机复核。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
