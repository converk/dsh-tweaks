# dsh-tweaks-model-capabilities

> **⚠️ 已停止维护（2026-10）**：DSH 官方 0.2.1 已原生提供模型行的输入类型控件与 hand-declared
> `llm-pi-ai` 路由的推理等级控件，本插件的剩余增量不足，已从插件市场下架、本机安装已卸载，
> 不再随 DSH 迭代。**最后一个核对过的 DSH 版本是 `0.2.1`** —— 之后的版本更迭、契约审计、CI 与发布
> 都**忽略本插件**（规则见 [AGENTS.md §2](../../AGENTS.md)）。仓库版本停在 `0.1.2`（未发布），
> npm 最后发布为 `0.1.1`；源码保留只作参考。

在 DSH 的模型编辑界面里，补上官方没有的「思考强度 / 容量」设置。

## 它能做什么

在「设置 → 模型」里编辑模型时，官方模型行只有名字、上下文长度与输入类型；插件在模型行的「容量」展开区补上：

- **思考强度**（只有第三方网关 `llm-pi-ai`、且**官方没有渲染推理控件**的模型行有）—— 先用「协议预置」选协议，它决定可选档位：`OpenAI` = off / minimal / low / medium / high / xhigh / max，`Anthropic` = off / low / medium / high / xhigh / max（取自 DSH 自带 pi-ai 目录里两家模型的实测映射）。两个预置默认都勾 off / low / high / max；一个都不勾 = 这个模型不支持思考（写 `reasoningEfforts: false`）。官方已经渲染了推理控件的行（DSH 0.2.1 的 hand-declared 路由）**插件不再提供**自己的编辑器，只显示「由官方控件管理」提示。
- **容量快捷填入** —— 「上下文窗口 / 最大输出」各有一个 `1M` / `128K` 按钮；新建模型行展开容量时自动填好 1000000 / 131072。
- **摘要** —— 展开行顶部显示该模型当前的思考状态与上下文 / 输出。

两个官方提供方卡片都挂同一份行内实现：

| 提供方 | 能补什么 |
|---|---|
| `llm-pi-ai`（含用户在 profile 里声明的路由） | 官方没渲染推理控件的行补思考强度；所有行补容量快捷；官方已渲染的行只显示提示 |
| `llm-deepseek`（官方 DeepSeek api-key） | DeepSeek 的思考档位是**提供方级**设置（`thinking` / `reasoningEffort`），适配器没有每模型思考强度；插件不显示思考编辑器、不提供提供方级面板，只补容量快捷 + 摘要 |

## 怎么用

1. 打开 **设置 → 模型**，选一个提供方 → **编辑** → **自定义设置**。
2. 找到要改的那个模型，点那一行的 **「容量」** 展开。
3. 展开后顶部会显示这个模型当前的配置摘要，下面是思考强度（插件管理的 `llm-pi-ai` 行）与容量按钮：
   - **思考强度**：先用「协议预置」选协议（`OpenAI` / `Anthropic`），档位行会换成该协议的枚举；勾上这个模型支持的档位，右边输入框是该档的"过线拼写"，不同网关叫法不一样（比如 `max` 在你那边叫 `ultra`），可以改。
   - 切换预置会把档位重新按默认勾成 off / low / high / max；没配置过思考强度的模型展开时默认就是 OpenAI 预置 + off / low / high / max。
   - 一个档都不勾 = 这个模型不支持思考。
4. 改完点官方那个 **「保存」** 才真正写进去（改过之后行内会提示"已改，点官方『保存』后写入"）；点官方「取消」则丢弃这次改动。

**第三方网关（`llm-pi-ai`）** —— 思考强度 + 容量快捷填入（截图是 0.1.0 旧版；图里的「多模态」单选框 0.1.1 起已删除，改由官方模型行自带的输入类型控件提供）：

![llm-pi-ai 模型行展开（0.1.0 旧版）：思考强度选 OpenAI 预置（档位 off/minimal/low/medium/high/xhigh/max，默认勾 off/low/high/max）；多模态行 0.1.1 已删除；下面是「上下文长度与最大输出长度：1M / 128K」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/model-capabilities-third-party.png)

**官方 DeepSeek（`llm-deepseek`）** —— 没有每模型思考强度（提供方级字段见提供方设置），只有容量快捷 + 摘要：

![llm-deepseek 模型行展开（0.1.0 旧版）：没有每模型思考强度，只提示档位由提供方级 reasoningEffort / thinking 控制；「多模态」单选框已删除；下面是「上下文长度与最大输出长度：1M / 128K」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/model-capabilities-official.png)

## 说明

- 上下文窗口、最大输出仍然由官方输入框管，插件只是帮你少敲几个 0。
- 「添加提供方」时的新卡片里不注入控件（还没保存过，这时写入会出问题）；保存进编辑页之后就能配置了。
- 预置只决定「有哪些档位可选」和「默认勾什么」，**不改变协议本身**：模型说 Responses 还是 Messages 由提供方的 `compat` 决定，插件不碰 `compat`。
- 没配置过思考强度的模型，展开时会自动套用 OpenAI 预置并勾上 off / low / high / max，行内随即提示"已改，点官方『保存』后写入"；不想写就把档位全部取消勾选。
- 保存失败（比如设置冲突）会原样显示 DSH 报的错，改动会保留，可以再点一次「保存」重试。
- **只写 `reasoningEfforts`**：插件不写 `input` / `inputModalities`，不会覆盖官方输入类型控件或目录继承的图片能力；也**不再注入多模态控件**（官方模型行自 0.2.0 起就自带）。
- DeepSeek 的 `thinking` / `reasoningEffort` 是提供方级根字段，插件只在摘要里只读显示当前值，不提供编辑面板（0.1.2 移除了 0.1.1 加的面板）。
- **官方有的我们就不提供**：DSH 0.2.1 起官方会给 **hand-declared** 的 `llm-pi-ai` 路由渲染推理控件（`ModelReasoningEfforts`）。插件按行**运行期探测**（`_modelReasoning` DOM 判据）：探测到官方控件的行不再提供自己的思考强度编辑器，只保留摘要 / 容量快捷和「由官方控件管理」提示，也不把 `reasoningEfforts` 写回；官方没有该控件的行（例如 0.2.0 的 declared 路由）才由插件补预置 UI。

## DSH 兼容性（0.2.0 – 0.2.1）

- **最低支持 DSH 0.2.0**（2026-10 起不再考虑 0.1.7）。
- 本次核对覆盖两份**完整安装**：**0.2.0-rc.2** 与 **0.2.1-rc.2**（0.2.1-rc.1 也全量核对过）。
- 核对方式：直接读官方产物（`lib/types/**/*.d.ts` 与已构建的 `lib/client.js`）做逐文件比对；类型看不出的地方再读运行时产物里的真实结构。自测在 0.2.0-rc.2 与 0.2.1-rc.2 两套产物上都是绿的。
- **0.1.2 的运行期改动**：撤销 0.1.1 针对本插件加入的**非 bug 修复**改动——删除 `llm-deepseek` / `llm-deepseek-account` 的提供方级 thinking / reasoningEffort 面板与 account 席位；思考强度的归属恢复「官方有的我们就不提供」：官方已渲染推理控件的行不再提供插件编辑器（只留摘要 / 容量 / 提示），官方没有的行才显示插件的「协议预置」UI（与 0.1.0 一致，按行运行期探测以兼容 0.2.0）。**保留** 0.1.1 的 bug 修复：只写 `reasoningEfforts`、不覆盖官方多模态字段、不重复注入多模态控件、`files` 含 `src` 修类型悬空。
- 开发期闸门有 3 处漂移（官方产物路径 / 源码格式变化，不影响插件行为），已在 `scripts/selftest.mjs` 里改成稳健解析 / 结构断言。

| 契约 | 官方产物位置（相对 `<dsh>/node_modules/@deepseek-ai/`） | 0.2.0 → 0.2.1 核对结果 |
|---|---|---|
| `inject` 的 4 个服务名 `slots` / `locale` / `remote` / `remote.settings` | 渲染层 `dsh-client-ui-renderer/lib/client.js`；`dsh-client-locale/lib/client.js`；**`dsh-api-gateway/lib/client.browser.js`**（0.2.1 起从 `lib/client.js` 改名，`exports["./client"]` 按 browser/default/node 条件映射） | 未变（gateway 仅文件改名，`super(ctx,"remote")` / `remoteServiceKey` 原文逐字仍在） |
| `remote.settings.describe()` / `mutate(ns, ops, revision)` 入参与返回 | `dsh-api-settings-controller/lib/typert.remote-client.d.ts`：`describe: () => Promise<RemoteResult<SettingsDescribeValue>>`、`mutate: (ns, ops, expectedRevision) => Promise<RemoteResult<SettingsNamespaceView>>` | 未变（文件类型改为 `TypertRemoteInfo<…>` 方法映射，但这两个方法的参数与 `RemoteResult` 包装不变） |
| `settings/document-updated` 事件名与实参顺序 | `dsh-api-remotes/lib/types/remote-events.d.ts`（转发白名单）；`dsh-settings/lib/types/types.d.ts` 的 `'settings/document-updated'(ns, revision)`；客户端派发 `dsh-api-gateway/lib/client.browser.js` 的 `parallel(eventKey(frame.event), ...frame.args)` | 未变：实参仍是 `(ns, revision)` |
| keyed slot `settings.models.provider-card` 的键与 owner props | `dsh-client-ui-settings-models/lib/types/client/slot-contract.d.ts`；渲染点 `lib/client.js` 的 `renderSlot("settings.models.provider-card", { provider, configured, keyConfigured }, { entryKey: row.entry.settingsNs })`；slot-catalog（`dsh-cordis-client-runner/lib/client.js`）里 kind=keyed / scope=root / replaceRisk=none / `registerOptions.key` required | 未变 |
| 行内 **DOM 判据**（`_rowCard` / `_setupCard` / `_modelEntry` / `_modelList` / `_modelAdvanced` / `_modelRow` / `_editorActions`、`input[type="text"]`、`_editorActions` 的按钮顺序） | `dsh-client-ui-settings-models/lib/client.js`：7 个局部名在 0.2.1 仍在；`ModelRow` 展开区仍是 `contextWindow` → `maxTokens` → 官方输入类型控件（0.2.1 再往后是官方推理控件）；动作行仍是 [取消, 保存] | 未变（容量输入仍是展开区前两个 input） |
| 官方输入类型控件 `ModelInputTypes` | `dsh-client-ui-settings-models/lib/client.js`：`function ModelInputTypes(` 与 `modelInputTypes` 在 0.2.0 与 0.2.1 都有 | 未变（插件不注入它，避免重复） |
| `locale` 三参 `register(ns, lang, dict)` 与 `bind(ns)` | `dsh-client-locale/lib/types/client/index.d.ts`；运行时 `lib/client.js` 两版 sha256 相同 | 未变 |
| 插件写入的模型字段名 | `dsh-llm-pi-ai/lib/types/catalog.d.ts` 的 `reasoningEfforts?: false \| PiAiReasoningEfforts`；插件 **0.1.1 起只写 `reasoningEfforts`**，`input` / `inputModalities` 由官方控件写 | 未变（插件写入面收窄到 `reasoningEfforts`） |
| 两个提供方 entry id `llm-pi-ai` / `llm-deepseek` | `dsh-base/cordis.patch.yml` | 未变 |

### 未受类型保护的脆弱点（重要）

- **行内控件靠 DOM 增补**：官方 `settings.models.provider-card` 席位只到「提供方卡片」一级，模型行内部没有 Slot，所以「思考强度 / 容量」控件只能按 `[class*="_modelEntry"]` 这类**子串匹配**注入。官方一旦改 CSS Module 局部名或换组件结构，`tsc` 与 cordis 都不会报错，表现只是**静默不注入**。自测里的「官方契约原文 / 结构顺序」断言就是为这条设的告警线。
- **硬依赖 `inject` 也是静默的**：若官方 remote 装配没有挂上 `remote.settings`（或 slot 未被声明），本条目会永远 pending，界面毫无反应、日志没有异常。
- 本次只做了**产物级静态核对 + 纯逻辑自测**，没有在运行中的 0.2.1 浏览器里实测点击流程；DOM 判据与官方产物已逐条静态核对。

### 复现核对

在插件目录下：

```powershell
# 无 DSH 部署也能跑（只跳过官方产物那一半；CI 同样跑这段）
node build.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs

# 有完整 DSH 部署时再核对官方产物；DSH_CONTRACT_HOMES 可用路径分隔符给多份
$env:DSH_CONTRACT_HOMES="D:\env\node-global\dsh-stable"
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
