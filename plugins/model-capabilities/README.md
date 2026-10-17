# dsh-tweaks-model-capabilities

在 DSH 的模型编辑界面里，补上官方没有的「思考强度 / 多模态 / 容量」设置。

## 它能做什么

在「设置 → 模型」里编辑模型时，官方界面只能改名字和上下文长度，没法告诉 DSH「这个模型支不支持思考」「支不支持看图」。这个插件把这些开关补进模型行：

- **思考强度** —— 先用「协议预置」选协议，它决定可选档位：`OpenAI` = off / minimal / low / medium / high / xhigh / max，`Anthropic` = off / low / medium / high / xhigh / max（取自 DSH 自带 pi-ai 目录里两家模型的实测映射）。两个预置默认都勾 off / low / high / max；一个都不勾 = 这个模型不支持思考。（只有第三方网关 `llm-pi-ai` 有这一项）
- **多模态** —— 选「文本」或「文本+图片」。（`llm-pi-ai` 和 `llm-deepseek` 都有）
- **容量快捷填入** —— 「上下文窗口 / 最大输出」各有一个 `1M` / `128K` 按钮；新建模型行展开容量时自动填好 1000000 / 131072。

## 怎么用

1. 打开 **设置 → 模型**，选一个提供方 → **编辑** → **自定义设置**。
2. 找到要改的那个模型，点那一行的 **「容量」** 展开。
3. 展开后顶部会显示这个模型当前的配置摘要，下面是思考强度、多模态和容量按钮：
   - **思考强度**：先用「协议预置」选协议（`OpenAI` / `Anthropic`），档位行会换成该协议的枚举；勾上这个模型支持的档位，右边输入框是该档的"过线拼写"，不同网关叫法不一样（比如 `max` 在你那边叫 `ultra`），可以改。
   - 切换预置会把档位重新按默认勾成 off / low / high / max；没配置过思考强度的模型展开时默认就是 OpenAI 预置 + off / low / high / max。
   - 一个档都不勾 = 这个模型不支持思考。
4. 改完点官方那个 **「保存」** 才真正写进去（改过之后行内会提示"已改，点官方『保存』后写入"）；点官方「取消」则丢弃这次改动。

**第三方网关（`llm-pi-ai`）** —— 思考强度 + 多模态 + 容量快捷填入：

![llm-pi-ai 模型行展开：思考强度选 OpenAI 预置（档位 off/minimal/low/medium/high/xhigh/max，默认勾 off/low/high/max），下面是多模态与「上下文长度与最大输出长度：1M / 128K」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/model-capabilities-third-party.png)

**官方 DeepSeek（`llm-deepseek`）** —— 只有多模态（DeepSeek 的思考档位是提供方级设置，这里只读显示当前值）：

![llm-deepseek 模型行展开：没有每模型思考强度，只提示档位由提供方级 reasoningEffort / thinking 控制；下面是「多模态：」与「上下文长度与最大输出长度：1M / 128K」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/model-capabilities-official.png)

## 说明

- 上下文窗口、最大输出仍然由官方输入框管，插件只是帮你少敲几个 0。
- 「添加提供方」时的新卡片里不注入控件（还没保存过，这时写入会出问题）；保存进编辑页之后就能配置了。
- 预置只决定「有哪些档位可选」和「默认勾什么」，**不改变协议本身**：模型说 Responses 还是 Messages 由提供方的 `compat` 决定，插件不碰 `compat`。
- 没配置过思考强度的模型，展开时会自动套用 OpenAI 预置并勾上 off / low / high / max，行内随即提示"已改，点官方『保存』后写入"；不想写就把档位全部取消勾选。
- 保存失败（比如设置冲突）会原样显示 DSH 报的错，改动会保留，可以再点一次「保存」重试。

## DSH 兼容性（本次审计）

- **最低支持 DSH 0.2.0**（2026-10 起不再考虑 0.1.7）。
- 本次核对覆盖两份**完整安装**：**0.2.0-rc.2** 与 **0.2.1-rc.1**；另对 npm `next` 的 **0.2.1-rc.2** 做了关键产物抽检（关键 client 产物与 rc.1 逐字节相同）。
- 核对方式：直接读官方产物（`lib/types/**/*.d.ts` 与已构建的 `lib/client.js`）做逐文件 sha256 对比；类型看不出的地方再读运行时产物里的真实结构。
- **结论：运行期契约在 0.2.1 全部仍然成立，没有真失效 → 本次未改动运行期代码，版本号不动（仍 0.1.0）。** 开发期闸门有 3 处漂移（官方产物路径/源码格式变化，不影响插件行为），已在 `scripts/selftest.mjs` 里改成稳健解析/结构断言。
- 另一个产品层提示：0.2.1 官方在模型行里新增了行内「思考强度」编辑（`ModelReasoningEfforts`），**只对用户自声明的 pi-ai 路由渲染**（`declared === true`）；本插件注册的 `llm-pi-ai` / `llm-deepseek` 是内置适配器（`declared=false`），所以两套 UI 不会重叠。将来官方若把内置适配器也标成 declared，需要复核一次。

| 契约 | 官方产物位置（相对 `<dsh>/node_modules/@deepseek-ai/`） | 0.2.0 → 0.2.1 核对结果 |
|---|---|---|
| `inject` 的 4 个服务名 `slots` / `locale` / `remote` / `remote.settings` | 渲染层 `dsh-client-ui-renderer/lib/client.js`；`dsh-client-locale/lib/client.js`；**`dsh-api-gateway/lib/client.browser.js`**（0.2.1 起从 `lib/client.js` 改名，`exports["./client"]` 按 browser/default/node 条件映射） | 未变（gateway 仅文件改名，`super(ctx,"remote")` / `remoteServiceKey` 原文逐字仍在） |
| `remote.settings.describe()` / `mutate(ns, ops, revision)` 入参与返回 | `dsh-api-settings-controller/lib/typert.remote-client.d.ts`：`describe: () => Promise<RemoteResult<SettingsDescribeValue>>`、`mutate: (ns, ops: SettingsPathOpView[], expectedRevision: number \| undefined) => Promise<RemoteResult<SettingsNamespaceView>>` | 未变（文件类型改为 `TypertRemoteInfo<…>` 方法映射，但这两个方法的参数与 `RemoteResult` 包装不变） |
| `settings/document-updated` 事件名与实参顺序 | `dsh-api-remotes/lib/types/remote-events.d.ts`（转发白名单）；`dsh-settings/lib/types/types.d.ts` 的 `'settings/document-updated'(ns, revision)`；客户端派发 `dsh-api-gateway/lib/client.browser.js` 的 `parallel(eventKey(frame.event), ...frame.args)` | 未变：实参仍是 `(ns, revision)` |
| keyed slot `settings.models.provider-card` 的键与 owner props | `dsh-client-ui-settings-models/lib/types/client/slot-contract.d.ts`；渲染点 `lib/client.js` 的 `renderSlot("settings.models.provider-card", { provider, configured, keyConfigured }, { entryKey: row.entry.settingsNs })`；slot-catalog（`dsh-cordis-client-runner/lib/client.js`）里 kind=keyed / scope=root / replaceRisk=none / `registerOptions.key` required | 未变 |
| 行内 **DOM 判据**（`_rowCard` / `_setupCard` / `_modelEntry` / `_modelList` / `_modelAdvanced` / `_modelRow` / `_editorActions`、`input[type="text"]`、`_editorActions` 的按钮顺序） | `dsh-client-ui-settings-models/lib/client.js`：7 个局部名在 0.2.1 仍在；`ModelRow` 展开区仍是 `contextWindow` → `maxTokens` → 输入类型 checkbox（之后官方新增 `ModelReasoningEfforts`）；动作行仍是 [取消, 保存] | 未变（容量输入仍是展开区前两个 input；官方新增控件在之后） |
| `locale` 三参 `register(ns, lang, dict)` 与 `bind(ns)` | `dsh-client-locale/lib/types/client/index.d.ts`；运行时 `lib/client.js` 两版 sha256 相同 | 未变 |
| 插件写入的模型字段名 | `dsh-llm-pi-ai/lib/types/catalog.d.ts` 的 `input?: PiAiModality[]` 与 `reasoningEfforts?: false \| PiAiReasoningEfforts`；`dsh-llm-deepseek/lib/index.js` 的 `inputModalities`；`dsh-base/cordis.patch.yml` 的 entry id `llm-pi-ai` / `llm-deepseek` | 未变 |

**开发期闸门的 3 处漂移（只影响 `scripts/selftest.mjs`，已修）**：

1. `dsh-api-gateway` 在 0.2.1 的 client 产物拆成 `lib/client.browser.js` + `lib/client.node.js`，没有 `lib/client.js` → 自测改为按 `package.json` 的 `exports["./client"]` 条件解析（browser → default → node），0.2.0 旧布局仍兼容。
2. `dsh-client-ui-slots` 不再随完整安装发布（它只是 renderer 的 devDependency，SlotCore 内联进 `dsh-web-frontend/dist/assets/index-*.js` 的页面种子模块）→ 自测改为读 slot-catalog / dist 产物。
3. 0.2.1 把 `modelAdvanced` 的 `children` 数组从单行改成多行 `jsxs`（语义未变）→ 自测从字面格式断言改成 `ModelRow` 结构断言。

### 未受类型保护的脆弱点（重要）

- **行内控件靠 DOM 增补**：官方 `settings.models.provider-card` 席位只到「提供方卡片」一级，模型行内部没有 Slot，所以「思考强度 / 多模态 / 容量」控件只能按 `[class*="_modelEntry"]` 这类**子串匹配**注入。官方一旦改 CSS Module 局部名或换组件结构，`tsc` 与 cordis 都不会报错，表现只是**静默不注入**。自测里的「官方契约原文 / 结构顺序」断言就是为这条设的告警线。
- **硬依赖 `inject` 也是静默的**：若官方 remote 装配没有挂上 `remote.settings`（或 slot 未被声明），本条目会永远 pending，界面毫无反应、日志没有异常。
- 本次只做了**产物级静态核对 + 纯逻辑自测**，没有在运行中的 0.2.1 浏览器里实测点击流程（不重启当前 3080 会话的约束）；DOM 判据与官方产物已逐条静态核对。

### 复现核对

在插件目录下（无需 DSH 也能跑，只会跳过官方产物那一半）：

```powershell
$env:DSH_CONTRACT_HOMES="D:\env\node-global\dsh-stable"
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs
```

## 安装

```powershell
npx @deepseek-ai/dsh plugin --profile web add "D:\你的目录\dsh-tweaks\plugins\model-capabilities"
```

重启 DSH，并在浏览器中强制刷新（`Ctrl + Shift + R`）。

> `web` 为 DSH 的 profile 名称，可在 `C:\Users\你的用户名\.dsh\profiles\` 下确认。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
