# dsh-tweaks-model-capabilities

给 DSH 模型编辑行补上官方没有的能力开关；**官方已经有的控件不再重复注入**。

## 它能做什么

在「设置 → 模型」里编辑模型时：

- **思考强度** —— 只对 **非 hand-declared 的 `llm-pi-ai` 路由**补一套档位编辑器（协议预置 `OpenAI` = off/minimal/low/medium/high/xhigh/max，`Anthropic` = off/low/medium/high/xhigh/max；默认勾 off/low/high/max；一个都不勾 = 不支持思考，写 `false`）。
  - DSH 0.2.1 已经给 **hand-declared pi-ai 路由**原生渲染了推理控件（`ModelReasoningEfforts`），插件**跳过这些路由**，不再重复注入。
- **多模态** —— **不再由本插件提供**。DSH 从 0.1.7 起每个模型行就有原生「文本 / 图片」输入类型控件（`ModelInputTypes`）；插件重复注入会和官方草稿打架，并可能把继承的图片能力写成仅文本。0.1.1 已删除这个重复控件。
- **容量快捷填入** —— 官方「上下文窗口 / 最大输出」输入框旁边有 `1M / 128K` 按钮；新建模型行展开容量时自动填好 1000000 / 131072。
- **摘要** —— 展开行顶部显示当前思考档位（或 DeepSeek 提供方级档位）与上下文/输出。
- **DeepSeek 提供方级面板** —— `thinking`（继承/启用/禁用）与 `reasoningEffort`（继承/off/low/high/max）；account 路由没有模型行，这是它唯一可编辑的思考入口。

支持三个提供方卡片：

| 提供方 | 能补什么 |
|---|---|
| `llm-pi-ai`（含用户在 profile 里声明的路由） | 非 declared 路由补思考强度；所有路由补容量快捷 |
| `llm-deepseek`（api-key） | 不碰每模型思考/多模态；补容量快捷 + 摘要 + 提供方级 thinking/reasoningEffort 面板 |
| `llm-deepseek-account`（账户登录，当前默认） | 官方 0.2.1 的 `layoutOf` 是 `unknown`，**没有模型行**；只补提供方级 thinking/reasoningEffort 面板 |

## 怎么用

1. 打开 **设置 → 模型**，选一个提供方 → **编辑**。
2. 找到要改的模型，点那一行的 **「容量」** 展开。
3. 展开后：顶部是摘要；非 declared 的 `llm-pi-ai` 路由会有思考强度编辑器；底部是 `1M / 128K` 按钮。
4. 改完点官方 **「保存」** 才真正写入；点官方「取消」丢弃这次改动。

> 截图是 0.1.0 旧版，仍能看到已删除的重复「多模态」单选框；0.1.1 的实际界面不会再出现这一行，多模态只保留官方原生控件。

## 说明

- 上下文窗口、最大输出仍由官方输入框管理，插件只帮忙少敲几个 0。
- 「添加提供方」的新卡片里不注入控件（还没保存过）；保存进编辑页后才会出现。
- 预置只决定「有哪些档位可选」和「默认勾什么」，**不改变协议本身**：Responses / Messages 由提供方的 `compat` 决定，插件不碰 `compat`。
- 保存失败（例如设置冲突）会原样显示 DSH 报错，挂起改动保留，可以再点一次「保存」重试。
- 插件只写 `reasoningEfforts`；**不再写 `input` / `inputModalities`**，因此不会覆盖官方多模态控件或目录继承的图片能力。

## DSH 兼容性（0.2.1 审计 / 0.1.1）

- 最低支持 DSH 0.1.7；0.1.1 按 **0.2.1** 重新核对。
- 官方模型行原生提供 `ModelInputTypes`（0.1.7 起）与 `ModelReasoningEfforts`（0.2.1 起，仅 hand-declared pi-ai 路由）。插件现在**只补官方没有的非 declared pi-ai 推理控件**，并覆盖 `llm-deepseek-account`。
- 自测 `scripts/selftest.mjs` 的官方契约段既支持完整 CLI 部署（`lib/client.js` + d.ts），也支持桌面运行时 asar（`lib/client.node.js` / `lib/client.browser.js`，无 d.ts）；后者会跳过类型契约、只核对运行时代码。
- 已验证：`tsc --noEmit`、`build.mjs`、`selftest.mjs` 全绿；本机 0.2.1-rc.1 的桌面产物上官方契约段 31 项通过（跳过 8 条该部署没有的 d.ts / 旧 CSS 结构断言）。

### 未受类型保护的脆弱点

- 行内控件仍靠 DOM 增补：`settings.models.provider-card` 只到提供方卡片一级，模型行内部没有 Slot。官方改 CSS Module 局部名或组件结构时，`tsc` 与 cordis 都不会报错，表现只是**静默不注入**；自测里的 DOM 判据是告警线。
- `inject = ['slots','locale','remote','remote.settings']` 是硬依赖；任一服务缺失时条目会永远 pending，界面无反应、日志无异常。

### 复现核对

```powershell
node node_modules/typescript/bin/tsc --noEmit
node build.mjs
node scripts/selftest.mjs

# 有完整 DSH CLI 部署时（可选）：
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
