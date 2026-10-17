# dsh-tweaks-model-capabilities

给 DSH 模型编辑行补上官方没有的能力开关；**官方已经有的控件不再重复注入**。

## 它能做什么

在「设置 → 模型」里编辑模型时：

- **思考强度** —— 只给 **官方没有渲染推理控件的 `llm-pi-ai` 模型行**补一套档位编辑器：先用「协议预置」选协议，它决定可选档位：`OpenAI` = off / minimal / low / medium / high / xhigh / max，`Anthropic` = off / low / medium / high / xhigh / max（取自 DSH 自带 pi-ai 目录里两家模型的实测映射）。两个预置默认都勾 off / low / high / max；一个都不勾 = 这个模型不支持思考（写 `reasoningEfforts: false`）。
  - 归属**逐行运行期探测**：DSH 0.2.1 起官方给 hand-declared pi-ai 路由原生渲染了推理控件（`ModelReasoningEfforts`），这些模型行只显示「由官方控件管理」、插件不重复注入也不写回；0.2.0 没有该组件，declared 路由同样由插件补上（不能静态按 `declared` 一刀切，否则 0.2.0 的思考编辑会整块消失）。
- **多模态** —— **不再由本插件提供**。官方模型行从 0.2.0 基线起就原生提供「文本 / 图片」输入类型控件（`ModelInputTypes`）；插件重复注入会和官方草稿打架，并可能把继承的图片能力写成仅文本。0.1.1 已删除这个重复控件。
- **容量快捷填入** —— 官方「上下文窗口 / 最大输出」输入框旁边有 `1M / 128K` 按钮；新建模型行展开容量时自动填好 1000000 / 131072。
- **摘要** —— 展开行顶部显示该模型的思考状态（插件档位 / 由官方控件管理 / DeepSeek 提供方级值）与上下文 / 输出。
- **DeepSeek 提供方级面板** —— `thinking`（继承 / 启用 / 禁用）与 `reasoningEffort`（继承 / off / low / high / max）；`llm-deepseek-account` 在 0.2.1 没有模型行，这是它唯一可编辑的思考入口。

支持三个提供方卡片：

| 提供方 | 能补什么 |
|---|---|
| `llm-pi-ai`（含用户在 profile 里声明的路由） | 官方没渲染推理控件的模型行补思考强度（0.2.0 的全部 pi-ai 路由；0.2.1 的非 declared 路由）；所有路由补容量快捷 |
| `llm-deepseek`（api-key） | 不碰每模型思考 / 多模态；补容量快捷 + 摘要 + 提供方级 thinking / reasoningEffort 面板 |
| `llm-deepseek-account`（账户登录，当前默认） | 0.2.1：官方 `layoutOf` 是 `unknown`、**没有模型行**，只补提供方级 thinking / reasoningEffort 面板；0.2.0：官方把它当 deepseek family 渲染模型行，容量快捷 / 摘要照常注入 |

## 怎么用

1. 打开 **设置 → 模型**，选一个提供方 → **编辑** → **自定义设置**。
2. 找到要改的那个模型，点那一行的 **「容量」** 展开。
3. 展开后顶部会显示这个模型当前的配置摘要，下面是思考强度（如果该行由插件管理）、容量按钮：
   - **思考强度**：先用「协议预置」选协议（`OpenAI` / `Anthropic`），档位行会换成该协议的枚举；勾上这个模型支持的档位，右边输入框是该档的"过线拼写"，不同网关叫法不一样（比如 `max` 在你那边叫 `ultra`），可以改。
   - 切换预置会把档位重新按默认勾成 off / low / high / max；没配置过思考强度的模型展开时默认就是 OpenAI 预置 + off / low / high / max。
   - 一个档都不勾 = 这个模型不支持思考。
   - 官方已渲染推理控件的行不显示档位编辑器，只提示「由官方控件管理」。
4. 改完点官方那个 **「保存」** 才真正写进去（改过之后行内会提示"已改，点官方『保存』后写入"）；点官方「取消」则丢弃这次改动。

**第三方网关（`llm-pi-ai`）** —— 思考强度 + 容量快捷填入（下图是 0.1.0 旧版，图中的「多模态」单选框 0.1.1 已删除，改由官方控件提供）：

![llm-pi-ai 模型行展开（0.1.0 旧版）：思考强度选 OpenAI 预置（档位 off/minimal/low/medium/high/xhigh/max，默认勾 off/low/high/max）；多模态行 0.1.1 已删除；下面是「上下文长度与最大输出长度：1M / 128K」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/model-capabilities-third-party.png)

**官方 DeepSeek（`llm-deepseek`）** —— 没有每模型思考强度，只提示档位由提供方级字段控制（0.1.1 起可在提供方级面板编辑）；容量快捷照常：

![llm-deepseek 模型行展开（0.1.0 旧版）：没有每模型思考强度，只提示档位由提供方级 reasoningEffort / thinking 控制；「多模态」单选框已删除；下面是「上下文长度与最大输出长度：1M / 128K」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/model-capabilities-official.png)

## 说明

- 上下文窗口、最大输出仍然由官方输入框管，插件只是帮你少敲几个 0。
- 「添加提供方」时的新卡片里不注入控件（还没保存过，这时写入会出问题）；保存进编辑页之后就能配置了。
- 预置只决定「有哪些档位可选」和「默认勾什么」，**不改变协议本身**：模型说 Responses 还是 Messages 由提供方的 `compat` 决定，插件不碰 `compat`。
- 没配置过思考强度的模型，展开时会自动套用 OpenAI 预置并勾上 off / low / high / max，行内随即提示"已改，点官方『保存』后写入"；不想写就把档位全部取消勾选。
- 保存失败（比如设置冲突）会原样显示 DSH 报的错，改动会保留，可以再点一次「保存」重试。
- 插件只写 `reasoningEfforts`；**不写 `input` / `inputModalities`**，因此不会覆盖官方多模态控件或目录继承的图片能力。
- 探测到官方推理控件的模型行不产生挂起草稿、也不会进入插件的写入计划（不会把 `reasoningEfforts` 写回官方管理的条目）。
- DeepSeek 的提供方级面板写的是命名空间根字段 `thinking` / `reasoningEffort`（官方 `llm-deepseek` / `llm-deepseek-account` 的 Config 都有这两个根字段），不碰 `models` / `modelOverrides`。

## DSH 兼容性（0.2.0 – 0.2.1）

- **最低支持 DSH 0.2.0**（2026-10 起不再考虑 0.1.7）。
- 本次核对覆盖两份**完整安装**：**0.2.0-rc.2** 与 **0.2.1-rc.1**；另对 npm `next` 的 **0.2.1-rc.2** 做了关键产物抽检（关键 client 产物与 rc.1 逐字节相同）。
- 核对方式：直接读官方产物（`lib/types/**/*.d.ts` 与已构建的 `lib/client.js`）做逐文件 sha256 对比；类型看不出的地方再读运行时产物里的真实结构。
- **0.1.1 的运行期改动**：删除与官方重复的多模态控件；declared pi-ai 路由的思考强度改为**按行运行期探测**官方 `ModelReasoningEfforts`（0.2.1 探测到官方控件就交给官方，0.2.0 没有该组件则插件继续补）；只写 `reasoningEfforts`；补 `llm-deepseek` / `llm-deepseek-account` 提供方级 thinking / reasoningEffort 面板。
- **自测把契约分硬 / 条件两类**：`ModelInputTypes` 等 0.2.0 起就有的硬契约必须全绿；`ModelReasoningEfforts` / `_modelReasoning` 局部名 / account 的 `modelOverrides` 这些只在 0.2.1 出现的契约按目标 DSH 版本条件化（0.2.0 跳过而不是报红）；官方控件归属的 DOM 判据单独钉成事实（P0 回归告警线）。

| 契约 | 官方产物位置（相对 `<dsh>/node_modules/@deepseek-ai/`） | 0.2.0 → 0.2.1 核对结果 |
|---|---|---|
| `inject` 的 4 个服务名 `slots` / `locale` / `remote` / `remote.settings` | 渲染层 `dsh-client-ui-renderer/lib/client.js`；`dsh-client-locale/lib/client.js`；**`dsh-api-gateway/lib/client.browser.js`**（0.2.1 起从 `lib/client.js` 改名，`exports["./client"]` 按 browser/default/node 条件映射） | 未变（gateway 仅文件改名，`super(ctx,"remote")` / `remoteServiceKey` 原文逐字仍在） |
| `remote.settings.describe()` / `mutate(ns, ops, revision)` 入参与返回 | `dsh-api-settings-controller/lib/typert.remote-client.d.ts`：`describe: () => Promise<RemoteResult<SettingsDescribeValue>>`、`mutate: (ns, ops, expectedRevision) => Promise<RemoteResult<SettingsNamespaceView>>` | 未变（文件类型改为 `TypertRemoteInfo<…>` 方法映射，但这两个方法的参数与 `RemoteResult` 包装不变） |
| `settings/document-updated` 事件名与实参顺序 | `dsh-api-remotes/lib/types/remote-events.d.ts`（转发白名单）；`dsh-settings/lib/types/types.d.ts` 的 `'settings/document-updated'(ns, revision)`；客户端派发 `dsh-api-gateway/lib/client.browser.js` 的 `parallel(eventKey(frame.event), ...frame.args)` | 未变：实参仍是 `(ns, revision)` |
| keyed slot `settings.models.provider-card` 的键与 owner props | `dsh-client-ui-settings-models/lib/types/client/slot-contract.d.ts`；渲染点 `lib/client.js` 的 `renderSlot("settings.models.provider-card", { provider, configured, keyConfigured }, { entryKey: row.entry.settingsNs })`；slot-catalog 里 kind=keyed / scope=root / replaceRisk=none / `registerOptions.key` required | 未变 |
| 行内 **DOM 判据**（`_rowCard` / `_setupCard` / `_modelEntry` / `_modelList` / `_modelAdvanced` / `_modelRow` / `_editorActions`、`input[type="text"]`、`_editorActions` 的按钮顺序） | `dsh-client-ui-settings-models/lib/client.js`：7 个局部名在 0.2.1 仍在；`ModelRow` 展开区仍是 `contextWindow` → `maxTokens` → 输入类型控件（0.2.1 之后再接官方推理控件）；动作行仍是 [取消, 保存] | 未变（容量输入仍是展开区前两个 input） |
| **官方推理控件的运行期判据**（P0） | `dsh-client-ui-settings-models/lib/client.js`：0.2.1 的 `ModelReasoningEfforts` 渲染在展开区、DOM 局部名 `_modelReasoning*`（含 `modelReasoningHead` / `modelReasoningRow` 等），且只对 `declared === true` 的 pi-ai 路由生成（`reasoningLevels` 非空才渲染） | **0.2.0 没有**：插件按行探测不到 → 注入自己的控件（declared 路由同样补）；0.2.1 探测到 → 交给官方 |
| `locale` 三参 `register(ns, lang, dict)` 与 `bind(ns)` | `dsh-client-locale/lib/types/client/index.d.ts`；运行时 `lib/client.js` 两版 sha256 相同 | 未变 |
| 插件写入的模型字段名 | `dsh-llm-pi-ai/lib/types/catalog.d.ts` 的 `input?: PiAiModality[]` 与 `reasoningEfforts?: false \| PiAiReasoningEfforts`；插件 **0.1.1 起只写 `reasoningEfforts`**，`input` / `inputModalities` 由官方控件写；DeepSeek 提供方级 `thinking` / `reasoningEffort` 是 `dsh-llm-deepseek/lib/index.js` 的 Config 根字段（0.2.1 account 用 `deepSeekConfigFields` 复用） | 未变（插件写入面收窄到 `reasoningEfforts`） |
| 三个提供方 entry id `llm-pi-ai` / `llm-deepseek` / `llm-deepseek-account` | `dsh-base/cordis.patch.yml`；account 路由在 0.2.1 的配置面改为 `modelOverrides`（**不能再配 `models`**），插件因此只在提供方卡片补根字段面板 | 0.2.0 account 仍有模型行（官方按 deepseek family 渲染）；0.2.1 没有 |

**开发期闸门的 3 处漂移（只影响 `scripts/selftest.mjs`，已修）**：

1. `dsh-api-gateway` 在 0.2.1 的 client 产物拆成 `lib/client.browser.js` + `lib/client.node.js`，没有 `lib/client.js` → 自测改为按 `package.json` 的 `exports["./client"]` 条件解析（browser → default → node），0.2.0 旧布局仍兼容。
2. `dsh-client-ui-slots` 不再随 0.2.1 完整安装发布（它只是 renderer 的 devDependency，SlotCore 内联进 `dsh-web-frontend/dist/assets/index-*.js` 的页面种子模块）→ 自测按包解析，缺失时回退到前端 dist 产物里找同一段 keyed 校验。
3. 0.2.1 把 `modelAdvanced` 的 `children` 数组从单行改成多行 `jsxs`（语义未变）→ 自测从字面格式断言改成 `ModelRow` 结构断言。

### 未受类型保护的脆弱点（重要）

- **行内控件靠 DOM 增补**：官方 `settings.models.provider-card` 席位只到「提供方卡片」一级，模型行内部没有 Slot，所以「思考强度 / 容量」控件只能按 `[class*="_modelEntry"]` 这类**子串匹配**注入；思考强度的归属也靠运行期探测官方 `_modelReasoning` 局部名。官方一旦改 CSS Module 局部名或换组件结构，`tsc` 与 cordis 都不会报错，表现只是**静默不注入 / 双份控件**。自测里的「官方契约原文 / 结构顺序」断言就是为这条设的告警线。
- **硬依赖 `inject` 也是静默的**：若官方 remote 装配没有挂上 `remote.settings`（或 slot 未被声明），本条目会永远 pending，界面毫无反应、日志没有异常。
- 本次只做了**产物级静态核对 + 纯逻辑自测**，没有在运行中的 0.2.1 浏览器里实测点击流程（不重启当前 3080 会话的约束）；DOM 判据与官方产物已逐条静态核对。

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
