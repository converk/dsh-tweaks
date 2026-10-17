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

- **最低支持 DSH 0.2.0**（2026-10 起不再考虑 0.1.7）。
- 本次逐条核对的版本：**0.2.0-rc.2** 与 **0.2.1-rc.1**；另对 npm `next` 的 **0.2.1-rc.2** 做了关键产物抽检（关键 client 产物与 rc.1 逐字节相同）。
- 核对方式：直接读官方产物（`lib/types/**/*.d.ts` 与已构建的 `lib/client.js`），对同名文件做 sha256 逐字比对；类型看不出的地方再读运行时产物里的真实结构。
- **结论：本插件依赖的契约在 0.2.1 全部仍然成立，没有需要修的真失效 → 本次未改动运行期代码。**
- 本次补齐了 `scripts/selftest.mjs` 契约闸门：无 DSH 部署时跑 bundle 协议 + 源码契约面 + vm 驱动 `apply` 的行为断言（CI 可跑）；设 `DSH_CONTRACT_HOMES` 时追加官方产物原文/结构断言（overlay 席位、标准 props、快照类型、`inputActions.setDraft`、locale 签名、`data-composer-card` 与 overlay 的运行时邻接）。

| 本插件用到的契约 | 官方产物位置（相对 `<dsh>/node_modules/@deepseek-ai/`） | 0.2.0 → 0.2.1 核对结果 |
|---|---|---|
| overlay 席位键 `conversation.input.overlay`（`kind: 'list'` / `scope: 'session'` / `replaceRisk: 'none'`） | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`；slot-catalog（`dsh-cordis-client-runner/lib/client.js`） | 未变（occupants 仍是 commands / input-trigger / message-feedback 三席） |
| 会话标准 props `useInput` / `inputActions` | 同上 | 未变 |
| `useChat` 标准 prop | `dsh-client-ui-chat/lib/types/client/contract/slots.d.ts` | 未变（session 标准 props 仅增补 remote-access 系列，本插件不用） |
| `useChat(s => s.legacy.nodes)`：`LegacyConversationSlice` / `ChatSnapshot.legacy` | `dsh-client-ui-chat/lib/types/client/contract/snapshot.d.ts` | 未变 |
| 节点 `kind: 'user' \| 'steering'` + `content: readonly ContentBlock[]` | `dsh-client-ui-conversation/lib/types/client/contract/records.d.ts` | 未变 |
| 文本块 `{ type: 'text'; text: string }` | `dsh-llm/lib/types/types.d.ts` | 未变 |
| `inputActions.setDraft(text)` | `dsh-client-ui-conversation/lib/types/client/contract/input.d.ts` | 未变 |
| `snapshot.draft` / `snapshot.phase === 'plain'` | 同上 | 未变 |
| `slots.inject(key, cb)` / `slots.register({ name, id, order }, el)` | `dsh-client-ui-renderer/lib/types/client/registry.d.ts`；服务 `ctx.slots` 见同包 `client/index.d.ts` | 未变（SlotCore 运行时语义不变；0.2.1 起它不再作为独立包随完整安装发布，见 AGENTS.md §3.9） |
| `locale.register(ns, lang, dict)` / `locale.bind(ns)` | `dsh-client-locale/lib/types/client/index.d.ts`；运行时 `lib/client.js` | 未变（两版 `lib/client.js` sha256 相同） |
| DOM 判据 `[data-composer-card]`（键盘作用域限定） | 运行时产物 `dsh-client-ui-conversation/lib/client.js` | 未变：0.2.1 里 `"data-composer-card": true` 之后约 426 字符就是 `renderSlot("conversation.input.overlay")`（0.2.0 为 351，同一卡片子树；0.2.1 新增 `data-composer-overlay` 属纯增补） |
| client bundle 加载协议 `window.__ModuleLoader__.load({ id, factory })` | `dsh-client-modules`（manifest） | 未变 |

### 未受类型保护的脆弱点（已知限制）

- `[data-composer-card]` 是**运行时 DOM 判据，不在任何 d.ts 里**：官方改名或把 overlay 挂载点移出
  composer 卡片时，类型检查不会报警，`anchor.closest('[data-composer-card]')` 会返回 `null`，
  表现为 **↑/↓ 静默失效**（界面无反应、无报错）。升级 DSH 后复核这一条，要直接读运行时产物：
  确认 `"data-composer-card"` 与 `renderSlot("conversation.input.overlay")` 仍在同一个卡片节点内
  （`scripts/selftest.mjs` 已有这条官方产物断言，本机设了 `DSH_CONTRACT_HOMES` 时生效）。
- `useChat` / `useInput` / `inputActions` 是 Slot 运行时注入的 props，本插件用**结构投影**
  （`src/client/types.ts`）读取，**没有编译期保证**；升级 DSH 后同样要跑一遍真机冒烟（输入框为空时按 ↑）。
- 本插件现在有 `scripts/selftest.mjs`（CI 自动跑：bundle 协议 + 源码契约面 + vm 驱动 apply；官方产物段需要本机有 DSH 部署，CI 上自动跳过）；**仍没有 clientsmoke**——键盘交互最终仍需真机冒烟。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
