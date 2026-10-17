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
- 终端卡片、退出码 pill、后台 `job_output` / `job_kill`、沙箱拒绝与升级，表现与官方一致；
- **前台等超时会「转后台」而不是杀掉命令**（官方 `promoteOnTimeout` 语义）：长命令等满
  `timeoutMs` 后继续在后台跑，调用立刻交回 job id 与「到目前为止的输出」，之后用
  `job_output` 读、`job_kill` 停，跑完还会收到一条完成通知；
- **跟随会话当前目录**（DSH 0.2.1+）：模型用 `working_directory` 工具 `cd` 之后，`bash` 命令也在
  新目录执行；结果与终端卡片显示实际执行目录（`cwd` / `tool/result.meta.cwd`）。沙箱授权仍按
  原始项目计算——`cd` 不会扩大可写范围。

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
3. 点 **自动发现**：扫描 Git for Windows / MSYS2 / Cygwin 的安装根，把**第一个可用**的 `bash.exe`
   填进路径栏并**持久化**；找到多条 git 路径时，路径栏变成**下拉列表**，重启 DSH 后依然可以选。
4. **开一个新会话**即可生效。

说明：

- **不会用 WSL 的 bash**。`C:\Windows\System32\bash.exe` 与 `...\WindowsApps\bash.exe` 会被
  硬排除（`where bash` 在这些机器上经常先解析到 WSL），发现算法是「先找到 git，再由同一个安装反推 bash」。
- 自动发现按**目录**存在性探测安装根：git 不在 PATH 里时，注册表 / `%ProgramFiles%` / MSYS2 /
  Cygwin 的安装目录照样能扫到。
- 路径栏只显示路径本身：候选来源（`Git for Windows` / `MSYS2` / …）与 `bash --version`
  这类扫描细节不再摊在设置页里 —— 多条路径时路径栏就是选择器。
- 一个候选都没找到时，`Git Bash` 依然可选（只是还没有路径可用），点「自动发现」会给出一行「没有找到」说明。
- 路径栏可以手填，但**只有「文件名叫 `bash`/`bash.exe`、真实存在、且不是 WSL」的路径才会生效**：
  每次新会话替换前校验（`validateSettings` → `validateBashPath`），不合法就跳过替换（会话照旧 pwsh）
  并写一行诊断；路径为空是合法中间态。只判「存在」的话，任何 exe 都会被静默注册成 bash 工具。
- **设置行可写判据**：只看宿主设置快照的 `writable` 与 `status === 'ready'`，不依赖旧快照 / 家族兼容层里的
  `mode`；不可写时整行控件是灰的、界面不报错。
- 运行时如果这个 DSH 版本不具备替换所需的扩展点，设置行会显示「当前版本不支持：<原因>」，
  会话**完全不受影响**（插件不抛错、不 veto，只写诊断日志）。

![设置 → 通用 → 终端工具：默认只有 PowerShell（pwsh）与 Git Bash（bash）两个选项，切到 Git Bash 后才出现「Git Bash 路径」与「自动发现」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/git-bash-terminal-tool.png)

## DSH 兼容性

- **支持范围**：最低 DSH **0.2.0**，按 **0.2.1 契约基线**开发与核对；更高版本不做保证。
- **用到的关键契约**（全部以结构性窄化投影读取，不 import 官方包）：per-agent 初始化事件
  `agent/created`、async `ctx.sandbox.confine`、`tools.restrict` / `tools.register`、
  `systemPrompt.section` / `getSectionOrder`、`ctx.jobs.start` 的 `output` 拉取源与 `owner`
  解析以及 `wait` / `read` / `kill` / `remove`、`ToolExecution.rootCallId` + `output.presentationMeta`、
  entry Config = volatile schemastery；DSH 0.2.1 新增的会话当前目录 `ctx.workingDirectory.ensure`
  与 `jobs.start.toolCall`（`callId` + `rootCallId`）。
  0.2.0 上缺 `workingDirectory` 时命令退回 `session.header.cwd`，旧任务注册表忽略多出来的
  `toolCall`、旧 UI 忽略 `cwd` / `meta`，不影响最低支持范围内的可用性。
- 权威契约位置（官方 d.ts 与客户端产物）与版本基线口径见 [AGENTS.md](../../AGENTS.md) §3.9。

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

代价：一次性工具每条命令都要启动一个 `bash.exe`，而持久 PTY 只在第一条命令付一次启动成本，之后每条是毫秒级。

**如果你一定要「极简模式 + 持久 Git Bash」**：本插件做不到（PTY realm 是 preset 私有的）。
唯一的路子是自己复制一份 `minimal` preset 改造：把 `terminal-pwsh` / `persistent-pwsh` 两行换成
`@deepseek-ai/dsh-terminal-bash`（`shellPath` 指向 Git Bash）+ `@deepseek-ai/dsh-tool-bash-persistent`。
后端用的是 node-pty（Windows 上走 ConPTY），理论上可行，但**本仓库没有验证过这条路**。

## 安装

```powershell
# 从 npm（推荐；需要 DSH >= 0.2.0）
npx @deepseek-ai/dsh plugin --profile web add dsh-tweaks-git-bash-terminal-tool

# 或从本仓库源码（开发调试）
npx @deepseek-ai/dsh plugin --profile web add "<仓库目录>/plugins/git-bash-terminal-tool"
```

然后在 profile 的 `package.json` 里把 `dsh-tweaks-git-bash-terminal-tool` 加进 `dsh.profile.bundles`
（本仓库其他插件就是这么挂的；bundle 自带的 `cordis.patch.yml` 只 insert 自己一行）。

**重启一次 DSH**，再在浏览器里强制刷新（`Ctrl + Shift + R`）。

> 首次挂载必须重启：bundle 自带的 patch 在运行中插入的 row 只进组合树，
> 宿主半区的 `apply` 不会被调用（client bundle 会进启动图）。
> `web` 为 DSH 的 profile 名称；profile 配置在 DSH 主目录下的 `profiles/` 里：默认即用户目录下的
> `~/.dsh`（Windows 为 `%USERPROFILE%\.dsh`），若设置了 `DSH_HOME` 则以其为准。

### 装不上？先看是不是「本地 link 留下的 junction」

如果**之前用本地路径装过**本插件（上面那条开发调试命令），profile 的 `node_modules` 里会留下一个
指向本仓库的 **junction**：

```text
<profile>\node_modules\dsh-tweaks-git-bash-terminal-tool  ->  <仓库目录>\plugins\git-bash-terminal-tool
```

之后再用市场 / npm 装**正式版**时，`pnpm add` 会把它当成本地包重新导入，并在导入后的目录里重建依赖链接；
Windows 上创建真实符号链接需要管理员权限或开发者模式，于是整条命令失败（pnpm 与 dsh 市场都会以同样的形式挂掉）：

```text
[ERR_PNPM_EPERM] [importPackage <profile>\node_modules\dsh-tweaks-git-bash-terminal-tool]
EPERM: operation not permitted, symlink '<仓库目录>\plugins\git-bash-terminal-tool\node_modules\...\@deepseek-ai\schemastery'
```

**先删掉那个 junction，再装正式版**。它只是一个指向开发目录的链接，删掉不会动仓库里的任何文件：

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\web"   # 换成你自己的 profile 目录
cmd /c rmdir "$profile\node_modules\dsh-tweaks-git-bash-terminal-tool"
```

> 用 `rmdir`（不带 `/s`）而不是 `Remove-Item -Recurse`：前者只摘掉链接本身，后者在旧版
> Windows PowerShell 上会把链接**指向的目录内容**一起删掉。

判据：`Get-Item "$profile\node_modules\dsh-tweaks-git-bash-terminal-tool"` 的 `LinkType` 显示
`Junction` / `SymbolicLink` 就要删；为空（真实目录）说明是正常安装，不要动。

> 这不是包内容的问题：同一个包 `npm pack` 后在干净工程里 `pnpm add`、或装到没有历史 link 的
> profile 里都正常。只有「同一个包里既有本地 link、又要换成 registry 版本」时才会踩到。
> 想少踩：开发调试改用 tarball（`npm pack` 后 `dsh plugin add .\dsh-tweaks-git-bash-terminal-tool-<版本>.tgz`），
> 它不会留下 junction。

## 卸载

从 profile 的 `dsh.profile.bundles` 里移除、重启 DSH 即恢复原状：

- DSH 源码 / `node_modules`：从未写过；
- preset 文件：从未改过；
- host 组合：只 insert 了自己一行，移除即消失；
- 工具目录与提示词：只在 agent 的内存 scope 里注册，随 agent 释放；
- `ctx.shell`：从头到尾没接管过。

唯一的持久化状态是**当前 profile 的 patch**（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）里
本插件那一行的 `config`（`dialect` / `bashPath` / 上一次自动发现扫到的 `bashCandidates`）。
`dsh plugin remove` 没有清理它的钩子，插件也无法区分「重启」与「卸载」（两种情况插件都会被卸载一次，
在 dispose 里删数据会让重启丢掉你要保留的路径），所以那一行是**惰性的**：卸载后没有任何代码会读它，
手动删掉即可。更早的实现写在 `$DSH_HOME/settings.yaml` 的残留段同样没有代码读取，可一并手动删除；
临时目录下的 `dsh-git-bash-terminal-tool.log` 同理。

## 已知限制

| 限制 | 说明 |
|---|---|
| 只对 Windows 生效 | bundle 自带的 patch 把整行 `disabled` 在非 win32 上：host 的 `apply` 不执行、client bundle 也不进启动图 |
| 只对新会话生效 | 运行中的会话保持启动时的终端选择（有意为之） |
| 极简模式会退化成一次性 shell | `minimal` 是唯一用持久 PTY 的官方预设；本插件在 win32 上把它的 `pwsh` 换成一次性 Git Bash（见「极简模式（minimal）的影响」） |
| 宿主侧改动要重启 | 与其他 DSH 插件一样：Node ESM 缓存，改宿主代码必须重启 |
| 原生 Windows 程序的中文输出是乱码 | 见下节「已知限制：原生 Windows 程序的输出编码」 |
| 「超时转后台」需要 DSH 0.2.x | 注册表齐 `wait`/`read`/`kill`/`remove` 才有（0.2.0 起齐备）；运行期仍保留能力探测，缺失时退回「超时即杀」 |
| 受限沙箱下 Git Bash 起不来 | 见下节「已知限制：受限模式下 Git Bash 起不来」（Windows ACL 沙箱与 MSYS2 信号管道冲突） |

### 已知限制：受限模式下 Git Bash 起不来（与插件无关）

DSH 在 Windows 上用「写受限令牌」实现文件沙箱（`dsh-sandbox-windows-acl`），而
MSYS2 / Git for Windows 的 `bash.exe` 启动时必须创建信号管道（`\\.\pipe\`）——
写受限令牌下这一步会被拒：

```text
bash.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
```

**这不是本插件的 bug**：在同一个 `workspace-write` 会话里，用官方 `pwsh` 工具跑
`& "C:\Program Files\Git\bin\bash.exe" -c "echo x"` 会得到**逐字相同**的报错；
同一个会话切到 `danger-full-access` 之后，本插件的 `bash` 工具正常返回 stdout。

所以要让 Git Bash 真正跑起来，会话沙箱必须是 **`danger-full-access`**
（启动时 `DSH_PERMISSION_MODE=danger-full-access`，或在界面上切到完全权限）。
本插件不会绕过 DSH 的沙箱策略。

### 已知限制：原生 Windows 程序的输出编码（与插件无关，Python 已缓解）

Git Bash 自己（`ls` / `grep` / `git` / bash 内建）输出 UTF-8，**中文一直是好的**。乱码只出现在
**原生 Windows 程序**上：它们把 stdio 按 **ANSI 代码页**（中文机器上是 936 / GBK）写进管道，
而 DSH 的采集端（`dsh-subprocess-local`）按 UTF-8 解码，于是：

```text
$ cmd /c ver
Microsoft Windows [�汾 10.0.x]      ← 「版本」

$ tasklist
ӳ������   PID �Ự��   �Ự#   �ڴ�ʹ��    ← 「映像名称 / PID / 会话名 / 内存使用」
```

结论：

- **`chcp 65001` 没有用**。它只改*控制台*代码页，而写**管道**用的是 `GetACP()` / `GetOEMCP()`，
  这两者不受 `chcp` 影响（加了 `chcp` 后管道输出照旧乱码）。
- **`cmd` / `powershell` / `tasklist` 这类插件改不了**：解码发生在 DSH 的 subprocess 采集层，
  不在本插件里。
- **Python 已缓解**：默认注入 `PYTHONIOENCODING=utf-8`
  （**只在环境里没有该变量时**才注入，不会覆盖你自己的设置），
  于是 `python -c "print('中文')"` 这类输出不再是乱码。
  只设 stdio 编码、不设 `PYTHONUTF8=1`——后者连 `open()` 与文件系统编码的默认值一起改，面太大。

想彻底解决，只能改系统设置（Windows「区域设置 → 管理 → 更改系统区域设置 →
Beta: 使用 Unicode UTF-8 提供全球语言支持」），或者给对应程序单独指定编码。

### 顺带一提：Git Bash 里 `cmd /c` 会被 MSYS 改写

MSYS2 会把看起来像路径的参数做转换，`/c` 正好撞上，于是 `cmd /c ...` 变成**交互式** cmd
（打印 banner 后挂住，看起来像命令卡死）：

```text
$ cmd /c "echo hi"          # 挂住：/c 被当成路径改写掉了
$ cmd //c "echo hi"         # ✅ 双斜杠转义
hi
$ MSYS2_ARG_CONV_EXCL='*' cmd /c "echo hi"   # ✅ 或者关掉参数转换
hi
```

## 排障

宿主半区每次启动、每次替换尝试都会往临时目录写一行日志：

```powershell
Get-Content "$env:TEMP\dsh-git-bash-terminal-tool.log" -Tail 30
```

> **测试不写这个文件。** `scripts/selftest.mjs` 会故意调用真 `apply()`（抓「事件名写错就静默失效」
> 的回归），所以它把诊断改道到自己的临时文件——通过环境变量 **`DSH_GIT_BASH_DIAG_FILE`** 做到，
> `diag.ts` 每次写入时读这个变量。**自己写脚本调 `apply()` 时也请设这个变量**，否则测试记录会混进
> 生产日志、把真问题淹掉。

常见几行：

| 日志 | 含义 |
|---|---|
| `apply: platform=win32 pid=…` | 宿主半区被加载了 |
| `settings: dialect=bash bashPath="…" candidates=N（新会话生效）` | 从 entry Config 读到的当前设置 |
| `routes: registered /api/dsh-tweaks-terminal/state` | 浏览器取数的路由挂上了 |
| `replace: applied agent=… bash=…` | 某个会话成功换成了 Git Bash |
| `replace: skipped agent=… reason=…` | 跳过的原因（设置是 pwsh / bashPath 为空 / 找不到 `pwsh` 可限制 …） |
| `settings: current value is invalid: invalid bashPath: …` | 存盘里的 `bashPath` 不合法（不存在 / 是 WSL）→ 只留痕，不拦启动 |
| `replace: skipped agent=… reason=invalid bashPath: …` | 该会话的替换被跳过（会话照旧 pwsh，绝不注册坏路径的工具） |
| `replace: failed agent=… unsupported JSON schema: …` | 工具 schema 超出当前 DSH 的 JSON Schema 子集 → 只跳过替换并留痕 |
| `replace: restrict(deny:[pwsh]) refused, skipping` | 该 agent 已看不到 `pwsh`（典型：子代理继承了父层的处理结果）→ 正常跳过 |

安装阶段就失败的（pnpm / 市场报 `ERR_PNPM_EPERM ... symlink`）与本插件的日志无关：
见「[安装 → 装不上？先看是不是「本地 link 留下的 junction」](#装不上先看是不是本地-link-留下的-junction)」。

## 开发者

```powershell
node build.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs        # 发现算法 / 设置 / 契约 / 替换 / 工具契约 / 转后台 + 真机跑 Git Bash（找不到 bash 时跳过）
node scripts/clientsmoke.mjs     # client bundle 协议 + apply + 行组件

# 契约漂移闸门：拿官方产物逐条核对（会真的 npm pack 到 .compat-cache/）
node scripts/compatcheck.mjs --fetch <dsh-version> [<dsh-version> …]

# 让自测用部署里的真件复核：dsh-tools 的工具 schema 校验器 + dsh-settings 的 volatileForm（CI 里可不设）
DSH_STABLE_HOME=<DSH 完整安装目录> node scripts/selftest.mjs
```

拿**本地目录**调试（`dsh plugin add <本目录>`）会在 profile 里建一个 junction；**换回 npm 正式版之前先把它删掉**，
否则 `pnpm add` 会以 `ERR_PNPM_EPERM` 失败（原因与判据见「安装 → 装不上？…」）。不想反复删就用 tarball 调试：
`npm pack` → `dsh plugin add .\dsh-tweaks-git-bash-terminal-tool-<版本>.tgz`。

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。

实现要点（细节都在源码注释里）：

- **运行时只依赖 `@deepseek-ai/schemastery`**（entry Config 必须是真 schema）；其余官方契约全部是
  `src/host/types.ts` 的结构性窄化投影，工具定义与执行器都自带
  （因为 win32 上 `ctx.shell` 就是 pwsh，本插件不接管它）。
- 替换发生在 per-agent 初始化事件 `agent/created`，动作只有三个：在**该 agent 自己的 scope** 里
  `tools.restrict({ deny: ['pwsh'] })`、`tools.register(<自包含 Git Bash 工具>)`、
  `systemPrompt.section({ name: 'tool:pwsh', order: <TOOL_PWSH>, text: '' })` 压掉残留提示词
  （顺序优先读 `systemPrompt.getSectionOrder()`，读不到才用常量）。注册到一半失败时按登记的逆序
  **全部撤回**。
- **会话当前目录**（0.2.1+）：`await ctx.workingDirectory.ensure(agent, signal)` → 命令 cwd；
  没有该服务时退回 `session.header.cwd`。输出三个分支都带 `cwd`，并由 `presentationMeta`
  写进 `tool/result.meta`。
- 沙箱升级（`sandbox_permissions` + 审批）按官方契约**逐字**复刻（`src/host/escalation.ts`），
  包括错误文案、严格更宽顺序与 fail-closed 语义。
- **超时 / 后台两条路径**（`src/host/bash-tool.ts`）按官方 0.2.x 复刻：
  `ctx.jobs.start({ kind, label, owner: <agent id>, toolCall: { callId, rootCallId }, output: [拉取源…], run })`；
  有 `wait/read/kill/remove` 时前台「等满即转后台」（`promoted`），没有就退回「超时即杀」。
  两条**静默失效**的纪律写在源码注释里：`owner` 必须是 id 字符串、`output` 拉取源必须给
  （少给的表现是任务照常跑完但 `job_output` 永远为空）。
- **PATH 组装**（`bashPathEntries` / `composePath`）按「Git 安装根 → 真实存在的子环境目录」推导：
  `bin` 上一层、`usr/bin` 上两层；`ucrt64` / `mingw64` / `clang64` 按存在性探测；
  与环境 PATH 按归一化键去重。发现算法的安装根按**目录**存在性判断，且默认不探测
  `bash --version`（在 Fetch handler 里同步 spawn 会阻塞宿主事件循环）。
- 包名/目录为 `dsh-tweaks-git-bash-terminal-tool`；**设置 namespace 是 entry id `git-bash-terminal-tool`**；
  locale 命名空间与设置行 slot id 仍叫 `terminal-tool`（纯实现标识，不参与设置寻址）。
