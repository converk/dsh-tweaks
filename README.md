# dsh-tweaks

给 **DSH（DeepSeek Harness）** 装的一套小插件：装上就直接用，不用改 DSH 本身。

> 适配 DSH **0.2.1**（最低 0.2.0）；本仓库当前版本：`git-bash-terminal-tool` **0.5.0**、`model-capabilities` **0.1.2**、`prompt-history` **0.1.1**、`smart-list` **0.1.0**。

---

## 目录

- [prompt-history —— 输入框里的历史提示词](#prompt-history--输入框里的历史提示词)
- [smart-list —— 输入框里的列表自动续号](#smart-list--输入框里的列表自动续号)
- [model-capabilities —— 给模型行补上「思考强度 / 容量」](#model-capabilities--给模型行补上思考强度--容量)
- ~~[turn-file-revert —— 本轮改动统计 + 一键撤回](#turn-file-revert--本轮改动统计--一键撤回)~~
  —— **已弃用并停止维护**：功能已由官方提供（DSH 0.2.x 自带的回合改动卡片 + 逐文件 diff 复核），
  最后一个支持版本 **0.2.0**
- [git-bash-terminal-tool —— 可将 Windows 环境下的终端工具替换为 Git Bash](#git-bash-terminal-tool--可将-windows-环境下的终端工具替换为-git-bash)
- [安装](#安装)

---

## prompt-history —— 输入框里的历史提示词

**它能做什么**

在会话输入框里按 ↑ / ↓，翻出这个会话里之前发过的提示词，像终端里翻命令历史一样。翻到想要的，改一改就能直接发。

**怎么用**

1. 点进输入框，确保里面是空的。
2. 按 **↑**：自动填上你上一次发过的提示词；再按 **↑** 继续往更早翻。
3. 按 **↓** 往回翻；翻过最新一条时，输入框恢复成你按 ↑ 之前的内容。
4. 翻到想要的 → 直接编辑，或者回车发送。

翻的过程中，输入框右上角会显示 `↑↓ 历史 3/12`，告诉你现在翻到第几条：

![输入框里按 ↑/↓ 召回本会话的历史提示词](docs/images/prompt-history.png)

> 只有输入框为空时才会接管 ↑，不会跟 `/` 命令菜单、`@` 引用菜单打架；历史只属于当前会话，刷新页面也还在。
>
> **0.1.1**：多段文本块的历史提取改用换行连接（不再粘成一串）；`Shift+↑` / `Shift+↓` 不再被历史召回拦截，留给编辑器自己做选择；`scripts/selftest.mjs` 补了纯逻辑断言（提取、去重、上限、多段文本）。

---

## smart-list —— 输入框里的列表自动续号

**它能做什么**

在输入框里写「1. … 2. … 3. …」这类列表时，按 **Shift+Enter** 换行后自动补上下一个编号，不用自己敲 `2.`、`3.`。

**怎么用**

1. 输入第一条：`1. 第一件事`（也支持 `1) `、`1、`、`1）`，以及 `- ` / `* ` / `+ ` / `• ` 无序列表）。
2. 按 **Shift+Enter**：新的一行自动出现 `2. `，直接接着写第二项。
3. 继续 Shift+Enter 会依次出现 `3. `、`4. `……写完正常按 Enter 发送。

```
1. 把 DSH 0.2.1 的契约核对一遍
2. 给 smart-list 补上列表自动续号的用例
3. 写 README 并测试安装
```

![在输入框里连续按 Shift+Enter，列表自动 1 → 2 → 3 续号](docs/images/smart-list.png)

> 只接管 **Shift+Enter**（普通 Enter 仍是发送）；输入法组合期、有选区、`@` / `/` 菜单都不受影响。
> 缩进、前导零都会保留；空条目（`2. ` 后面没内容）只换行、不再续号。
>
> 和 Codex / ChatGPT 的「列表块」不同：那边是富文本列表 marker，DSH 的 composer 是
> 普通段落 + 软换行，本插件用纯文本插入 `换行 + 下一个标记` 达到同样的输入体验，
> 不改文档结构、不碰 `@` 引用 chip。详细原理与兼容性见
> [`plugins/smart-list/README.md`](./plugins/smart-list/README.md)。
>
> **发布状态**：npm [`dsh-tweaks-smart-list@0.1.0`](https://www.npmjs.com/package/dsh-tweaks-smart-list)（CI trusted publishing + provenance）；
> 插件市场条目已提交 [awesome-dsh-plugin PR #7740](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7740)，等维护者合并后自动出现在市场。

---

## model-capabilities —— 给模型行补上「思考强度 / 容量」

**它能做什么**

在「设置 → 模型」的模型行「容量」展开区注入：

- **思考强度**（只有第三方网关 `llm-pi-ai`、且**官方没有渲染推理控件**的模型行有）—— 协议预置 `OpenAI` = off / minimal / low / medium / high / xhigh / max，`Anthropic` = off / low / medium / high / xhigh / max；默认勾 off / low / high / max；一个都不勾 = 不支持思考。原则是**官方有的我们就不提供**：DSH 0.2.1 官方已给 hand-declared 路由渲染推理控件（`ModelReasoningEfforts`），这些行插件按行探测到官方控件后不再提供自己的编辑器，只留摘要 / 容量 / 一句提示；官方没有控件的行（如 0.2.0 的 declared 路由）才由插件补预置 UI。
- **容量快捷填入** —— 官方「上下文窗口 / 最大输出」输入框旁的 `1M` / `128K` 按钮；新建模型行展开容量时自动填好 1000000 / 131072。
- 官方 DeepSeek（`llm-deepseek`）没有每模型思考强度（档位是提供方级 `thinking` / `reasoningEffort`），插件只补容量 + 摘要，不提供提供方级面板。
- 插件**只写 `reasoningEfforts`**，不写 `input` / `inputModalities`，也不重复注入官方已有的多模态控件（官方模型行自 0.2.0 起自带 `ModelInputTypes`）。

**怎么用**

1. 打开 **设置 → 模型**，选一个提供方（比如 `llm-pi-ai`）→ **编辑**。
2. 找到要改的模型那一行，点 **「容量」** 展开：顶部是当前配置摘要；插件管理的 `llm-pi-ai` 行会显示思考强度编辑器（官方已渲染推理控件的行不显示，只提示由官方控件管理）；底部是 `1M` / `128K` 按钮。
3. 改完点官方 **「保存」** 才真正写入；点官方「取消」丢弃这次改动。

> 截图是 0.1.0 旧版，仍能看到 0.1.1 已删除的重复「多模态」单选框；实际界面多模态只保留官方原生控件。

**第三方网关（`llm-pi-ai`）** —— 官方没有渲染推理控件的行：思考强度 + 容量快捷：

![llm-pi-ai 模型行展开：思考强度选 OpenAI 预置（默认勾 off/low/high/max）+ 1M / 128K](docs/images/model-capabilities-third-party.png)

**官方 DeepSeek（`llm-deepseek`）** —— 容量快捷 + 摘要（截图是 0.1.0 旧版，图里的「多模态」单选框现在由官方控件提供）：

![llm-deepseek 模型行展开：提供方级思考档位提示 + 1M / 128K](docs/images/model-capabilities-official.png)

---

## turn-file-revert —— 本轮改动统计 + 一键撤回

> **⚠️ 已弃用：功能已由官方提供，本插件停止维护。**

**它能做什么**

每轮对话结束，这个插件在回合末尾补一行：

- 这一轮总共 **加了多少行、删了多少行**，改了 **几个文件**；
- 一个 **「撤回全部修改」** 按钮：一次把这一轮改过的文件全部还原到改动前；
- 撤回之后按钮会变成 **「重新应用修改」**，再点一下就原样写回去。

补出来的一行长这样：

    本轮改动情况：+52 行 −7 行    3 个文件    [撤回全部修改]

**怎么用**

1. 等一轮"改过文件"的对话结束。
2. 在回合末尾找到插件补的那一行。
3. 点 **「撤回全部修改」** → 文件回到这一轮开始前的内容，按钮变成「重新应用修改」。
4. 想反悔，就再点 **「重新应用修改」**。

> 这一行**不依赖官方的「本轮文件改动」行**：模型在 `run_code` 里改文件时官方不会列，插件照样统计。
> **只有本会话最后一次对话能撤回 / 重新应用**：更早回合的按钮是灰的，鼠标移上去提示「该轮对话改动现在不支持撤回/恢复」。

**① 本轮有改动 —— 统计 + 可点的「撤回全部修改」**

![本轮有改动：本轮改动情况 +52 行 −7 行、3 个文件，「撤回全部修改」按钮可点](docs/images/turn-file-revert-modified.png)

**② 点了「撤回全部修改」—— 按钮变成「重新应用修改」**

![撤回后：按钮变为「重新应用修改」并提示「已撤回本回合修改」](docs/images/turn-file-revert-reverted.png)

**③ 更早的回合 —— 按钮置灰，鼠标移上去给提示**

![非最后一次对话：按钮置灰不可点，hover 提示「该轮对话改动现在不支持撤回/恢复」](docs/images/turn-file-revert-latest-only.png)

---

## git-bash-terminal-tool —— 可将 Windows 环境下的终端工具替换为 Git Bash

> ⚠️ **请用 0.5.0 或更高**（最低支持 DSH **0.2.0**）。**0.4.1** 已修掉 DSH 0.2.1 上的设置行只读；**0.5.0** 对齐会话当前目录（`working_directory`）/ 结果 `cwd` + `presentationMeta` / `jobs.toolCall`，并修掉审计发现的四个缺陷（安装根探测、文件名校验、半注册回滚、`/state` 降级）。

**它能做什么**

Windows 上 DSH 默认让模型用 PowerShell（工具名 `pwsh`）执行命令。这个插件把它换成 **Git Bash**，
并且**对所有 preset 生效**（standard / ptc / cordis / minimal）——不改 DSH 源码，也不改任何 preset 文件。

- 模型看到的工具叫 `bash`，描述是 Git Bash 方言（POSIX 路径、`$VAR`）；`pwsh` 从工具目录里消失；
- system prompt 里的 PowerShell 段被压掉，换成 bash 那段；
- **会话当前目录**：模型用 `working_directory` 工具切目录后，命令与终端卡片都跟随新目录（沙箱授权仍按原始项目，不随 `cd` 扩大）；
- 终端卡片、退出码 pill、后台任务、沙箱拒绝与升级，表现与官方一致。

**怎么用**

1. 打开 **设置 → 通用 → 终端工具**（插件只在 Windows 上挂载，其他平台这一行根本不存在）。
   默认是 **PowerShell（pwsh）**，这里只有两个工具选项 —— 插件**不会自动替你选**。
2. 点 **Git Bash（bash）**：这时才出现「Git Bash 路径」与 **自动发现** 按钮（切回 pwsh 就又收起来）。
3. 点 **自动发现**：扫描 Git for Windows / MSYS2 / Cygwin，把**第一个可用** `bash.exe` 填进路径栏并记住它；
   找到多条 git 路径时，路径栏会变成**下拉列表**，重启 DSH 后依然可选。
4. **开一个新会话**即生效。

![设置 → 通用 → 终端工具：默认只有 PowerShell（pwsh）与 Git Bash（bash）两个选项，切到 Git Bash 后才出现「Git Bash 路径」与「自动发现」](docs/images/git-bash-terminal-tool.png)

> 不用 WSL 的 `bash`：`System32` / `WindowsApps` 下的 `bash.exe` 会被硬排除。
> 且**会话沙箱必须是 `danger-full-access`**，受限模式下 Git Bash 起不来。

详细说明（含排障与已知限制）见 [`plugins/git-bash-terminal-tool/README.md`](./plugins/git-bash-terminal-tool/README.md)。

---

## 安装

下载本仓库，然后安装需要的插件。各插件互相独立，下方以 **prompt-history** 为例，把名称换成
对应插件所在目录名（如 `smart-list`、`model-capabilities`、`turn-file-revert`、`git-bash-terminal-tool`）即可：

```
npx @deepseek-ai/dsh plugin --profile web add "<仓库目录>/plugins/prompt-history"
```

安装完成后重启 DSH，并在浏览器中强制刷新（`Ctrl + Shift + R`）。

> 纯浏览器半区的插件（如 `smart-list`）安装后刷新浏览器即可，不需要重启 DSH 宿主。

> `<仓库目录>` 指你把本仓库下载（克隆）到的目录；`web` 为 DSH 的 profile 名称，其配置在 DSH 主目录下的 `profiles/` 里：默认即用户目录下的 `~/.dsh`（Windows 为 `%USERPROFILE%\.dsh`），若设置了 `DSH_HOME` 则以其为准。
