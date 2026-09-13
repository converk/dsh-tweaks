# dsh-tweaks-git-bash-terminal-tool

把 DSH 在 Windows 上的默认终端工具从 **PowerShell（pwsh）** 换成 **Git Bash（bash）** ——
一个开关，**所有 preset**（standard / ptc / cordis / minimal）自动跟随，**不改 DSH 源码、不改任何 preset 文件**
（唯一有代价的是 `minimal`：它会从「持久 shell」退化成「一次性 shell」，见下文）。

## 它能做什么

Windows 上的 DSH 默认让模型用一个 PowerShell 工具（工具名 `pwsh`）执行命令：工具目录、
system prompt、终端卡片里都是 PowerShell 方言。装了这个插件之后，你在 **设置 → 通用 → 终端工具**
里把终端工具切成 **Git Bash**：

- 模型看到的工具**叫 `bash`**，描述改成 Git Bash 方言（POSIX 路径、`$VAR`、不需要 `C:\` 转义）；
- `pwsh` 从模型可见的工具目录里**消失**（包括 PTC 模式生成的 SDK 签名）；
- system prompt 里那段 PowerShell 提示词被压掉，换成 bash 的那段；
- 终端卡片、退出码 pill、后台 `job_output` / `job_kill`、沙箱拒绝与升级，表现与官方一致。

切换**只对新会话生效**：运行中的会话保持它启动时的选择（这样工具目录与提示词不会中途变化，
KV cache 与历史工具调用都不会错位）。改完开一个新会话即可。

- 只想用 PowerShell？切回 `PowerShell（pwsh）` 就行，行为和没装插件一样。
- **不会**碰 DSH 自己的 `ctx.shell`（host 的 pwsh 执行器原样保留），所以 hooks、内部调用等
  用到 `ctx.shell` 的地方完全不受影响。
- ⚠️ 官方预设里只有 **`minimal`** 用的是「持久 shell」，它会因为本插件退化成「一次性 shell」；
  `standard` / `ptc` / `cordis` 本来就是一次性的，不受影响。详见下节「极简模式（minimal）的影响」。

## 怎么用

1. 打开 **设置 → 通用**，找到 **终端工具** 这一行（插件只在 Windows 上挂载，非 Windows 连这一行都不存在）。
   默认是 **PowerShell（pwsh）**，而且这里**只有两个工具选项** —— 插件不替你选、也不自己切换。
2. 点 **Git Bash（bash）**：只有这时才出现「Git Bash 路径」与 **自动发现** 按钮（切回 pwsh 就收起来）。
   此时路径若还是空的，新会话仍然跑 pwsh，不会出现半坏状态。
3. 点 **自动发现**：扫描 Git for Windows / MSYS2 / Cygwin，把**第一个可用**的 `bash.exe`
   填进路径栏并**持久化**；找到多条 git 路径时，路径栏变成**下拉列表**，重启 DSH 后依然可以选。
4. **开一个新会话**即可生效。

说明：

- **不会用 WSL 的 bash**。`C:\Windows\System32\bash.exe` 与 `...\WindowsApps\bash.exe` 会被
  硬排除（`where bash` 在这些机器上经常先解析到 WSL），发现算法是「先找到 git，再由同一个安装反推 bash」。
- 路径栏只显示路径本身：候选来源（`Git for Windows` / `MSYS2` / …）与 `bash --version`
  这类扫描细节不再摊在设置页里 —— 多条路径时路径栏就是选择器。
- 一个候选都没找到时，`Git Bash` 依然可选（只是还没有路径可用），点「自动发现」会给出一行「没有找到」说明。
- 手动把一个不存在的路径写进 settings.yaml 会被 host 的 `validate` 拒绝；路径为空则是合法的中间态。
- 运行时如果这台机器/这个 DSH 版本不具备替换所需的扩展点，设置行会显示「当前版本不支持：<原因>」，
  会话**完全不受影响**（插件不抛错、不 veto，只写诊断日志）。

## 极简模式（minimal）的影响

四个官方预设里，**只有 `minimal` 的终端是「持久 shell」**：

| 预设（win32 上） | 终端工具 | 调用之间保留状态？ |
|---|---|---|
| `standard` / `ptc` / `cordis` | `@deepseek-ai/dsh-tool-pwsh`（消费 `ctx.shell`） | ❌ 一次性：每次调用 spawn 一个新的 pwsh 进程 |
| `minimal` | `@deepseek-ai/dsh-tool-pwsh-persistent` + `@deepseek-ai/dsh-terminal` 的 PTY | ✅ 持久：cwd / 环境变量 / 函数 / 交互式程序跨调用保留 |

本插件在 win32 上会隐藏 preset 注册的 `pwsh`（`tools.restrict({ deny: ['pwsh'] })`）并注册自己的 Git Bash 工具，于是：

- **对 `standard` / `ptc` / `cordis` 没有影响**：它们本来就是一次性 shell，换成 Git Bash 仍然是一次性，语义一一对应；
- **对 `minimal` 有影响**：它从「持久 shell」变成「一次性 shell」—— 每次调用都是一个新进程，
  `cd` / 环境变量 / 函数 / `source` 过的脚本不再跨调用保留，也不能再驱动交互式程序（REPL、需要 TTY 的命令）。
  机制：`minimal` 的持久 shell 绑在 preset 自己的 PTY 栈上（`isolate: { terminals: true }` 的 realm 私有服务），
  外部插件没有办法「只换后端、保留工具」—— 隐藏工具就是连持久性一起换掉。

代价的量级：一次性工具每条命令都要启动一个 `bash.exe`（本机实测含沙箱/杀软约 200–280 ms/次），
而持久 PTY 只在第一条命令付一次启动成本，之后每条是毫秒级。

这不是本插件独有的取舍：你机器上的第三方预设 `liangshen` 在 win32 上同样把持久 PTY 组 `disabled` 掉，
改成自己实现的一次性 Git Bash 工具（`custom-bash.mjs`）—— 原话是「PTY 后端在 linux/darwin 之外没有对应实现，
所以 win32 禁用持久组，走普通的跨平台 subprocess 缝」，两边最后都只剩一个叫 `bash` 的工具。

**如果你一定要「极简模式 + 持久 Git Bash」**：本插件做不到（PTY realm 是 preset 私有的）。
唯一的路子是自己复制一份 `minimal` preset 改造：把 `terminal-pwsh` / `persistent-pwsh` 两行换成
`@deepseek-ai/dsh-terminal-bash`（`shellPath` 指向 Git Bash）+ `@deepseek-ai/dsh-tool-bash-persistent`。
后端用的是 node-pty（Windows 上走 ConPTY），理论上可行，但**本仓库没有验证过这条路**。

## 安装

```powershell
npx @deepseek-ai/dsh plugin --profile web add "D:\你的目录\dsh-tweaks\plugins\git-bash-terminal-tool"
```

然后在 profile 的 `package.json` 里把 `dsh-tweaks-git-bash-terminal-tool` 加进 `dsh.profile.bundles`
（本仓库其他插件就是这么挂的；bundle 自带的 `cordis.patch.yml` 只 insert 自己一行）。

**重启一次 DSH**，再在浏览器里强制刷新（`Ctrl + Shift + R`）。

> 首次挂载必须重启：bundle 自带的 patch 在运行中插入的 row 只进组合树，
> 宿主半区的 `apply` 不会被调用（client bundle 会进启动图）。
> `web` 为 DSH 的 profile 名称，可在 `C:\Users\你的用户名\.dsh\profiles\` 下确认。

## 卸载

从 profile 的 `dsh.profile.bundles` 里移除、重启 DSH 即恢复原状：

- DSH 源码 / `node_modules`：从未写过；
- preset 文件：从未改过；
- host 组合：只 insert 了自己一行，移除即消失；
- 工具目录与提示词：只在 agent 的内存 scope 里注册，随 agent 释放；
- `ctx.shell`：从头到尾没接管过。

唯一的残留是 `$DSH_HOME/settings.yaml` 里的 `terminal-tool:` 段 —— 它保存本插件唯一的持久化状态
（`dialect` / `bashPath` / 上一次自动发现扫到的 `bashCandidates`）。`dsh plugin remove` 没有清理设置文档的钩子，
插件也无法区分「重启」与「卸载」（两种情况插件都会被卸载一次，在 dispose 里删数据会让重启丢失你要保留的路径），
所以这段是**惰性的**：卸载后没有任何代码会读它，手动删掉那几行即彻底消失。
临时目录下的 `dsh-git-bash-terminal-tool.log` 同理。

## 已知限制

| 限制 | 说明 |
|---|---|
| 只对 Windows 生效 | bundle 自带的 patch 把整行 `disabled` 在非 win32 上：host 的 `apply` 不执行、client bundle 也不进启动图 |
| 只对新会话生效 | 运行中的会话保持启动时的终端选择（有意为之） |
| 极简模式会退化成一次性 shell | `minimal` 是唯一用持久 PTY 的官方预设；本插件在 win32 上把它的 `pwsh` 换成一次性 Git Bash（见「极简模式（minimal）的影响」） |
| 宿主侧改动要重启 | 与其他 DSH 插件一样：Node ESM 缓存，改宿主代码必须重启 |

## 排障

宿主半区每次启动、每次替换尝试都会往临时目录写一行日志：

```powershell
Get-Content "$env:TEMP\dsh-git-bash-terminal-tool.log" -Tail 30
```

常见几行：

| 日志 | 含义 |
|---|---|
| `apply: platform=win32 pid=…` | 宿主半区被加载了 |
| `settings: registered bash bashPath="…"` | 设置读到了 |
| `routes: registered /api/dsh-tweaks-terminal/state` | 浏览器取数的路由挂上了 |
| `replace: applied agent=… bash=…` | 某个会话成功换成了 Git Bash |
| `replace: skipped agent=… reason=…` | 跳过的原因（设置是 pwsh / bashPath 为空 / 找不到 `pwsh` 可限制 …） |
| `settings: register failed: invalid bashPath: …` | 存盘里的 `bashPath` 不合法（不存在 / 是 WSL）→ 本次启动**只降级成 pwsh**，会话不受影响 |
| `replace: failed agent=… unsupported JSON schema: …` | 工具 schema 超出当前 DSH 的 JSON Schema 子集 → 只跳过替换并留痕 |
| `replace: restrict(deny:[pwsh]) refused, skipping` | 该 agent 已看不到 `pwsh`（典型：子代理继承了父层的处理结果）→ 正常跳过 |

## 开发者

```powershell
node build.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs        # 发现算法 / 设置 / 升级契约 / 替换 / 工具契约 + 真机跑 Git Bash
node scripts/clientsmoke.mjs     # client bundle 协议 + apply + 行组件

# 让自测用**真的** @deepseek-ai/dsh-tools 校验器复核工具 schema（推荐，CI 里可不设）
DSH_STABLE_HOME="D:/env/node-global/dsh-stable" node scripts/selftest.mjs
```

设计文档见 [`docs/plans/git-bash-terminal-tool-design.md`](../../docs/plans/git-bash-terminal-tool-design.md)（本地文档，不入库），
本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。

实现要点（细节都在源码注释里）：

- **零 `@deepseek-ai/*` 运行时依赖**：所有官方契约都是 `src/host/types.ts` 的结构性窄化投影，
  工具定义与执行器都自带（因为 win32 上 `ctx.shell` 就是 pwsh，本插件不接管它）。
- 替换发生在 `agent/session-start`，动作只有三个：在**该 agent 自己的 scope** 里
  `tools.restrict({ deny: ['pwsh'] })`、`tools.register(<自包含 Git Bash 工具>)`、
  `systemPrompt.section({ name: 'tool:pwsh', order: 1010, text: '' })` 压掉残留提示词。
- 沙箱升级（`sandbox_permissions` + 审批）按官方契约**逐字**复刻（`src/host/escalation.ts`），
  包括错误文案、严格更宽顺序与 fail-closed 语义。
- 包名/目录已改名为 `dsh-tweaks-git-bash-terminal-tool`（体现 Git Bash），但**内部的 settings namespace、
  locale 命名空间与设置行 slot id 仍叫 `terminal-tool`**：前者是已经落盘的用户数据
  （改名等于清空用户选过的工具与路径），后两者是纯实现标识。
