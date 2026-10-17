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
- **前台等超时会「转后台」而不是杀掉命令**（官方 0.2.x 的 `promoteOnTimeout` 语义）：
  长命令等满 `timeoutMs` 后继续在后台跑，调用立刻交回 job id 与「到目前为止的输出」，
  之后用 `job_output` 读、`job_kill` 停，跑完还会收到一条完成通知。
- **跟随会话当前目录**（DSH 0.2.1+）：模型用 `working_directory` 工具 `cd` 之后，`bash` 命令也在
  新目录执行；结果与终端卡片显示实际执行目录（`cwd` / `tool/result.meta.cwd`）。

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
- 路径栏可以手填，但**只有「文件名叫 `bash`/`bash.exe`、真实存在、且不是 WSL」的路径才会生效**：
  每次新会话替换前校验（`validateSettings` → `validateBashPath`），不合法就跳过替换（会话照旧 pwsh）
  并写一行诊断；路径为空是合法中间态。文件名判据 0.4.0 就写了，但直到 **0.5.0** 才真正接到替换前
  校验上（见「升级到 0.5.0」）——只判「存在」会把任何 exe 静默注册成 bash 工具。
- 运行时如果这台机器/这个 DSH 版本不具备替换所需的扩展点，设置行会显示「当前版本不支持：<原因>」，
  会话**完全不受影响**（插件不抛错、不 veto，只写诊断日志）。

![设置 → 通用 → 终端工具：默认只有 PowerShell（pwsh）与 Git Bash（bash）两个选项，切到 Git Bash 后才出现「Git Bash 路径」与「自动发现」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/git-bash-terminal-tool.png)

## 升级到 0.5.0（DSH 0.2.1：跟随会话当前目录 + 终端卡片 cwd）

DSH 0.2.1 把「会话当前目录」从不可变的 `session.header.cwd` 拆成了可变的
`ctx.workingDirectory`：模型可以用 `working_directory` 工具 `cd`。0.4.x 仍然读 header cwd，
升级后的表现是：**模型 `cd` 到 `src/`，`bash` 却还在原目录跑，终端卡片显示的也是旧目录。**

0.5.0 按官方 0.2.1 的终端工具契约逐条对齐：

- **cwd 跟随 `working_directory`**：每次执行先 `await ctx.workingDirectory.ensure(agent, signal)`；
  相对 `workdir` 相对当前目录解析；没有该服务时退回 `session.header.cwd`。
  沙箱 workspace root 仍是原始项目（与官方一致：`cd` 不会扩大沙箱授权）。
- **结果带 `cwd` + `presentationMeta`**：`background` / `promoted` / `foreground` 三个分支都带
  `cwd`，并由 `output.presentationMeta` 把 `{ cwd }` 写进 `tool/result.meta` —— 0.2.1 的终端卡片
  优先读它显示目录。
- **后台任务归属**：`jobs.start({ toolCall: { callId, rootCallId } })`，PTC 子调用也能归到模型
  真正发起的那次根调用，`job/registered` / `job/settled` 会话事件里的任务卡片能正确落位。
- **工具参数/描述对齐**：`description` 排在 `command` 前，并补上官方 0.2.1 的
  “Provide `description` before `command`” 提示；`workdir` 描述改成「默认当前会话目录」。
- **设置行可写判据不变**：仍按 0.4.1 的口径只看宿主快照的 `writable` + `status === 'ready'`，
  不读 `mode`（0.2.1 快照没有该字段，见「升级到 0.4.1」）。

**0.5.0 同时修掉审计发现的四个缺陷**：

- **文件名判据真正生效**：`validateSettings` 现在调用 `validateBashPath`，`node.exe` 等非 bash
  可执行文件会在替换前被拒（0.4.0 声称的修复此前只落在发现算法里，没有接到替换前校验）。
- **自动发现不再跳过安装根**：安装根改用**目录**存在性探测，注册表 / `%ProgramFiles%` / MSYS2 /
  Cygwin 根在 git 不在 PATH 时也能扫到（此前把安装根当文件判断，整段扫描被跳过）。
- **半注册回滚**：工具 / 提示词 section 注册到一半失败时**全部**撤回（按登记的逆序），不再留下
  「`pwsh` 提示词被压掉、`bash` 工具半注册」的坏状态。
- **首次 `/state` 失败不再永久隐藏设置行**：平台未知时降级为可渲染并显示错误，不再停在
  `loading`（只能重挂载页面才恢复）；同时**默认不再探测 `bash --version`**，避免在 Fetch
  handler 里同步 spawn 阻塞宿主事件循环。

兼容性：0.2.1 的这些字段都是**可选读取 + 附加输出**——缺少 `workingDirectory` 时命令退回
`session.header.cwd`，旧版任务注册表忽略多出来的 `toolCall`，旧 UI 忽略 `cwd` / `meta`，
工具照常可用。**最低支持仍是 DSH 0.2.0**：0.2.0 上 `rootCallId` / `presentationMeta` 已齐（是
`compatcheck` 的硬契约）；`workingDirectory` / `jobs.toolCall` 是 0.2.1 新增，0.2.0 上按缺失降级。

## 升级到 0.4.1（DSH 0.2.1）

这一版只修一个 **DSH 0.2.1 上的静默失效**：设置行还在，但整行控件被禁用。运行期行为、host 半区、
设置值格式都不变。

**问题**：DSH 0.2.1 把官方设置快照 `ConfigFormSnapshot` 的 `mode` 字段删了——0.2.0 还有
`mode: 'host' | 'memory'`，0.2.1 只剩 `status` / `value` / `base` / `user` / `revision` / `writable`。
0.4.0 判断「设置是否可写」写的是：

```text
writable = snapshot.writable && snapshot.mode === 'host' && snapshot.status === 'ready'
```

在 0.2.1 上 `snapshot.mode` 是 `undefined`，整条表达式恒为 `false`：设置行照常渲染
（所以不是「设置行不见了」这种好排查的现象），但两个工具 chip、「Git Bash 路径」输入框、
「自动发现」按钮**全部 disabled**，界面不报错、日志也没有异常。用户 profile 的家族兼容层
（`webUiSettings`）会把设置 promote 到官方原生 `configForms`，快照形状跟着官方走，所以真实中招。

**修复**：写权限只看宿主快照自己的 `writable`：

```text
writable = snapshot.writable && snapshot.status === 'ready'
```

- 0.2.0 的 `memory` 模式（remote 进程内偏好）宿主本来就会给 `writable: false`，所以
  「memory 不可写」的语义不变；0.2.0 的 `host` 模式照常可写。
- `src/client/types.ts` 的 `SettingsScopeSnapshotLike.mode` 改成**可选**，只为给 0.2.0 /
  家族兼容层 `webUiSettings` 的快照留一个类型位；业务判据不再读它。
- `scripts/clientsmoke.mjs` 的假快照全部改成 0.2.1 形状（无 `mode`），并新增 4 条回归断言：
  ① 0.2.1 原生 `configForms` 快照（无 `mode`）→ chips / 路径栏 / 自动发现可点；
  ② `writable: false` → 全部 disabled；③ 0.2.0 `memory` 模式（`mode: 'memory'` + `writable: false`）
  仍 disabled；④ 0.2.0 `host` 模式（带 `mode`）向后兼容仍可写。另加静态断言：源码与构建产物里
  都不再出现 `snapshot.mode === 'host'`，防止判据回退。

升级后**重启 DSH + 浏览器强制刷新**即可；设置仍存在同一个 entry Config（`dialect` / `bashPath` /
`bashCandidates`），不需要重新选。**自 0.4.1 起最低支持 DSH 0.2.0**（0.1.7 及更早不再支持）。

## 升级到 0.4.0（与 DSH 0.2.x 的后台/超时契约对齐）

这一版把工具执行面按 DSH **0.2.0-rc.2** 的官方契约重新对齐，并修掉两个真机上会静默出错的问题。

**① 前台超时不再杀命令，改为「转后台」（官方 `promoteOnTimeout`）**

官方 0.2.x 的 `dsh-tool-bash` 在超时后**不杀进程**：命令继续跑，调用交回 job id 与已产出的输出，
之后由 `job_output` / `job_kill` 接管（`output.schema` 因此多了 `promoted` 分支）。
0.4.0 之前本插件是「超时即杀」——一个跑了 2 分钟的构建会在第 120 秒被干掉，白跑。

现在行为与官方一致：

```text
<到目前为止的输出>
[still running after 120000ms; moved to background job bash-3]
The command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.
```

`timeoutMs` 的措辞也跟着变（"…on expiry the command moves to the background as a job instead of being killed."）。
**能力探测**：这套需要注册表齐 `wait` / `read` / `kill` / `remove`。0.2.0 起官方产物四者俱全，
自 0.4.1 起这是 **`compatcheck` 的硬契约**（缺任一个即报红）；插件运行期仍保留能力探测做防御式降级——
万一缺方法会退回「超时即杀」（工具描述同时退回旧措辞），不会报错。

**② 后台任务的输出以前是空的（`job_output` 读不到任何东西）**

`ctx.jobs` 的注册表**只认** `start({ output: [...] })` 这种「拉取源」：它按源把 stdout / stderr
泵进任务的输出环，`job_output` 读的就是那个环。0.4.0 之前本插件写的是在 hooks 上返回一个
`readOutput()` —— `dsh-jobs-local` 里**根本没有这个成员**，于是：

> 后台任务照常跑完、状态也对（`completed` / `exit code: 0`），但 `job_output` **永远是空的**。

现在两路流都通过 `output` 拉取源接入（并有 `clientsmoke` + `compatcheck` 双重防线）。
顺带修掉同一处的另一个问题：`owner` 必须是 **agent id（session id）字符串**，注册表拿它
`agents.get()` 反查活着的 agent；传 agent 对象会抛 `session "[object Object]" has no live agent`。

**③ PATH 里不再出现不存在的目录**

`bashPathEntries` 原来一律用 `..\..` 推 Git 安装根，但 Git for Windows 有**两个** bash：
`<root>\bin\bash.exe`（启动器）与 `<root>\usr\bin\bash.exe`（真正的 MSYS2 bash）。选前者时
`..\..` 会越过安装根落到 `C:\Program Files`，于是**每条命令**的 PATH 里都被塞进：

```text
C:\Program Files\bin        ← 不存在
C:\Program Files\usr\bin    ← 不存在
C:\Program Files\cmd        ← 不存在
C:\Program Files\mingw64\bin ← 不存在（而且 UCRT64 版 Git 用的是 ucrt64\bin）
```

真机实测：PATH 前 8 条里 4 条是死目录，而真正有用的 `…\Git\usr\bin` 反倒没被补上。
现在按「`bin` 上一层 / `usr\bin` 上两层」正确反推安装根，**只收录真实存在的目录**，
并按 `ucrt64` → `mingw64` → `clang64` 探测真实子环境（不再写死 mingw64）；
与环境里已有的 PATH 条目按「分隔符 + 大小写」归一化去重。

**④ 其余对齐官方 0.2.x 的细节**

| 项 | 说明 |
|---|---|
| `stopped` 字段 | 运行被 `job_kill` 停掉时，前台结果里带上停止原因（渲染成 `[stopped: …]`） |
| 沙箱事实 | 修掉「第一次读发生在进程还在跑时，就把 `denied: false` 永久缓存」的 bug——沙箱拒绝现在一定报得出来 |
| `processOutcome` | 沙箱注记拼进任务的 `detail`（任务列表那一行也看得到拒绝） |
| 任务登记被拒 | 例如该 owner 的并发任务已达上限时，**降级**为前台硬超时并写一行诊断，而不是让调用失败 |
| 渲染 | 「转后台」走通用卡片（不给退出码 pill），与官方 `presentBashResult` 一致 |
| provider 失败 | 子进程实现（沙箱 runner 等）在 spawn 之后崩掉时，**渲染前就把原错误抛回**（工具调用 isError），不再把 `exitCode: null` 渲染成看起来像成功的 `[exit code: 0]` |

**⑤ 自测/兼容闸门**

- `scripts/selftest.mjs` 不再写死作者机器上的 bash 路径（那是**换机即崩**的写法）：
  改为走发现算法，找不到就把依赖真实路径的断言整段 skip。新增「转后台 / 能力探测 / 输出拉取源 /
  `stopped` / PATH 组装」等回归断言。
- `scripts/compatcheck.mjs` 新增三条契约（`output` 拉取源、`owner` 解析、`wait/read/kill/remove`）——
  当时 `wait/read/kill/remove` 标成可选（缺失只告警、不算失败，给 0.1.7 这类老部署留余地）。
  **自 0.4.1 起最低支持 0.2.0，这四项已升级为硬契约**（见「DSH 兼容性」）。
- 顺手修掉 `--fetch` 在 Windows 上的一个真 bug：原来把含盘符的绝对路径交给 `tar`，
  MSYS / GNU tar 会把 `D:` 当成远程主机（`tar: Cannot connect to D: resolve failed`）。

**⑥ 子进程输出编码：Python 的中文不再是乱码**

原生 Windows 程序按 ANSI 代码页（中文机器 936/GBK）写管道，DSH 按 UTF-8 解码，
所以 `python -c "print('中文')"`、`tasklist` 这类输出读回来都是乱码。
`cmd` / `powershell` 插件改不了（解码在 DSH 的 subprocess 层），但 **Python 能修**：
现在默认注入 `PYTHONIOENCODING=utf-8`（**只在环境里没有该变量时**注入，不覆盖你自己的设置）。
详见「已知限制 → 原生 Windows 程序的输出编码」。

**⑦ 路径校验加文件名判据（行为变更）+ 自测不再污染诊断日志**

两处都是「追一个幽灵问题」追出来的，根因是同一件事：**自测拿 `process.execPath`
（`…\nodejs\node.exe`）当「存在的 bash 路径」替身，而校验当时只判「存在 + 不是 WSL」**。

- **校验现在要求文件名是 `bash` 或 `bash.exe`**（不做任何 spawn，只看名字）。
  旧口径下**任何** exe 都会被当成 bash 接受，于是一个填错的 `bashPath` 会**静默注册一个
  坏掉 bash 工具**：`node.exe -c "echo hi"` 里的 `-c` 是 `--check`，什么都不执行，模型只看到
  一片空白。现在会明确拒绝并在设置行/诊断里给出原因（会话退回 pwsh，不会半坏）。
  ⚠️ 这是**行为变更**：手填的非 bash 路径不再被接受；`Git for Windows` / `MSYS2` / `Cygwin`
  的 bash 一律叫 `bash(.exe)`，正常路径不受影响。
- **自测的诊断改道到自己的临时文件**，通过 `DSH_GIT_BASH_DIAG_FILE` 覆盖（见「排障」）。
  之前两者共用一个日志文件，生产日志里混进了 100 多行测试记录
  （`replace: applied agent=session-1 bash=…node.exe`），把真问题淹掉、还让人误以为
  另有一个跑歪的 DSH 实例。

## 升级到 0.3.3（修复：在 DSH 0.1.6+ 上替换根本没生效）

> ⚠️ 本节是历史记录（当时最低支持 DSH 0.1.7）。**自 0.4.1 起最低支持版本是 DSH 0.2.0。**

0.2.0 ~ 0.3.2 的**替换逻辑在 DSH 0.1.6 之后是死的**（issue #1）：
设置照常保存、日志照常写、设置行状态正常，但模型**始终只看到 `pwsh`，`bash` 从不出现**。
两个互相独立的原因，都是本插件当年按 DSH **0.1.5-rc.1** 写的契约，而它们在 0.1.6 一起变了：

| 契约 | 0.1.5-rc.1（写码时的部署） | 0.1.6 起（0.1.7 / 0.2.0 都是） | 表现 |
|---|---|---|---|
| per-agent 初始化事件 | `agent/session-start` | **`agent/created`** | 监听器**永不触发**：不隐藏 pwsh、不注册 bash、提示词也不替换；日志里连一条 `replace:` 都没有 |
| `ctx.sandbox.confine` | 同步返回 `ConfinedArgv` | **async，返回 `Promise`** | 受限（read-only / workspace-write）模式下每次 `bash` 调用都失败：`Error: undefined is not iterable` |

0.3.3 改的就是这两处（事件名抽成常量 `AGENT_INIT_EVENT`；`confineArgv` 改成 async 并在
`jobs.start` 之前 await），并补了两道防线：

- `scripts/selftest.mjs` 现在**走公开入口 `apply()`** 断言「订阅的事件名」与「收到事件后的四个动作」，
  事件名再写错会立刻红；
- 新增 `scripts/compatcheck.mjs`：拿官方产物逐条核对本插件依赖的每个契约，
  当时的核对命令是 `node scripts/compatcheck.mjs --fetch 0.1.7-rc.2 0.2.0-rc.2`（现在最低支持
  0.2.0，见「DSH 兼容性」）。

这两个契约写错的表现都是**静默失效**（cordis 不会因为事件名不存在而报错；没 await 也只是拿到
一个 Promise），所以别把它们改回去。

### 已知限制：受限模式下 Git Bash 起不来（与插件无关）

DSH 在 Windows 上用「写受限令牌」实现文件沙箱（`dsh-sandbox-windows-acl`），而
MSYS2 / Git for Windows 的 `bash.exe` 启动时必须创建信号管道（`\\.\pipe\\`）——
写受限令牌下这一步会被拒：

```text
bash.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
```

**这不是本插件的 bug**：在同一个 `workspace-write` 会话里，用官方 `pwsh` 工具跑
`& "C:\Program Files\Git\bin\bash.exe" -c "echo x"` 会得到**逐字相同**的报错。
实测同一个会话切到 `danger-full-access` 之后，本插件的 `bash` 工具正常返回 stdout。

所以要让 Git Bash 真正跑起来，会话沙箱必须是 **`danger-full-access`**
（启动时 `DSH_PERMISSION_MODE=danger-full-access`，或在界面上切到完全权限）。
本插件不会绕过 DSH 的沙箱策略。

## 升级到 0.3.x（安装问题修复）

0.3.0 ~ 0.3.2 **没有改运行期行为**：host / client 半区的代码与 0.2.1 相同 —— 工具替换、设置面、沙箱升级、
`minimal` 的取舍都不变。这几版修的是**装不上**：

- README 补上「本地 link 留下的 junction 会让后续 npm / 市场安装报 `ERR_PNPM_EPERM`」的判据与清理步骤
  （见「安装 → 装不上？…」），以及开发调试章节里「换回正式版前先清掉 junction」的提醒；
- 只在文档与版本号上有变化，所以老机器上的持久化设置原样保留
  （选择仍存在 profile patch 的 `git-bash-terminal-tool` 行 config 里）。

| 版本 | 内容 |
|---|---|
| 0.3.0 | 安装排障文档 + 版本号（首次发布） |
| 0.3.1 | 与 0.3.0 内容相同，只把删 junction 的命令从 `Remove-Item -Recurse` 换成 `cmd /c rmdir`：旧版 Windows PowerShell（5.1）对 junction 用前者会连**链接目标**的内容一起删掉 |
| 0.3.2 | 与 0.3.1 内容相同，只是改由仓库 CI（npm trusted publishing）发布，带 provenance，并在干净 Ubuntu 上复跑 tsc / build / selftest / clientsmoke |
| 0.4.0 | 对齐 DSH 0.2.x 的执行契约：前台超时转后台（`promoted`）、后台输出拉取源、`owner` 用 agent id、PATH 安装根修正 |
| 0.4.1 | 修 DSH 0.2.1 的设置行只读：`ConfigFormSnapshot` 删除 `mode` 后，可写判据只看 `writable` + `status`（0.5.0 已包含） |
| 0.5.0 | 对齐 DSH 0.2.1：cwd 跟随 `working_directory`、结果与 `presentationMeta` 带 `cwd`、后台任务带 `toolCall`；并修安装根探测 / 文件名校验 / 半注册回滚 / `/state` 失败降级 |

用部署里的真件复核过 DSH **0.2.0-rc.1 / 0.2.0-rc.2**：`node scripts/selftest.mjs` 与
`node scripts/clientsmoke.mjs` 全绿（含 `@deepseek-ai/dsh-tools` 的工具 schema 校验器与
`@deepseek-ai/dsh-settings` 的 `volatileForm`）——
`tools.restrict` / `tools.register` / `systemPrompt.section` / entry Config 这几个契约在 0.2.x 上确实没变。

⚠️ 但这几个契约没变**不代表插件就是好的**：真正变的是 `agent/session-start → agent/created` 与
`confine` 的同步 → async（见「升级到 0.3.3」），而它们当年没有被复核到。
现在这类漂移交给 `scripts/compatcheck.mjs` 逐版本核对。

## 升级到 0.2.0（DSH 0.1.7）

> ⚠️ 本节是历史记录（0.2.0 版本适配 DSH 0.1.7）。**自 0.4.1 起最低支持版本是 DSH 0.2.0。**

DSH 0.1.7 换了设置模型（旧 `ctx.settings.register` 已不存在），本插件 0.2.0 随之上车：

- 设置从「插件自造的 `terminal-tool` 命名空间」改成**插件 entry 自己的 Config**，
  表单按 **profile entry id `git-bash-terminal-tool`** 定位；
- 可编辑字段用 schemastery 的 `.volatile()` 声明，所以插件多了一个运行时依赖
  `@deepseek-ai/schemastery`；
- 持久化位置从 `$DSH_HOME/settings.yaml` 变成**当前 profile 的 patch**
  （`profiles/<profile>/cordis.patch.yml`）里本插件那一行的 `config`。

⚠️ **旧选择不会自动迁移**：0.1.7 的旧设置导入按「分区名 = entry id」执行，
`settings.yaml` 里的 `terminal-tool:` 匹配不到 `git-bash-terminal-tool`，只会被跳过
（原文件已改名为 `settings.yaml.imported`）。所以升级后请**重新选一次**：
设置 → 通用 → 终端工具 → 点 **Git Bash** → 点 **自动发现** → 开一个新会话。

本版按 DSH **0.1.7-rc.2** 的设置模型实现：host 侧是 volatile Config；浏览器侧优先用家族兼容层的
`webUiSettings`，没有它就退回官方原生 `configForms.get(entryId)`（所以没有家族兼容层的普通部署也能用）。
更旧的 DSH（0.1.5 那套 `ctx.settings.register` / `settingsScope`）请继续用 0.1.0。
**0.3.3 起的最低支持版本是 DSH 0.1.7；自 0.4.1 起最低支持版本改为 DSH 0.2.0**（0.1.5 的
`agent/session-start` 与同步 `confine` 都不再兼容，也不打算兼容）。

## DSH 兼容性

- **最低支持 DSH 0.2.0**（自 0.4.1 起；0.1.7 及更早不再支持 —— 0.1.5 的 `agent/session-start`
  与同步 `confine` 早已不兼容）。
- 本次逐条核对的版本：**0.2.0-rc.2 / 0.2.1-rc.1 / 0.2.1-rc.2**（另用本机
  `D:/env/node-global/dsh-stable` 部署 0.2.1-rc.2 复核了真件）。
- 结论：
  - **宿主侧契约在 0.2.0 / 0.2.1 都成立**：per-agent 初始化事件 `agent/created`、async
    `ctx.sandbox.confine`、`tools.restrict` / `tools.register`、`systemPrompt.section` /
    `getSectionOrder`、`ToolExecution.rootCallId` + `output.presentationMeta`、`ctx.jobs.start` 的
    `output` 拉取源 / `owner` 解析 / `wait` `read` `kill` `remove`、entry Config = volatile schemastery。
    `scripts/compatcheck.mjs` 在 **0.2.0-rc.2 上 13/13、0.2.1-rc.1 与 0.2.1-rc.2 上各 17/17 通过**
    （0.2.0 自动跳过 4 条 0.2.1 才有的契约）；`rootCallId` / `presentationMeta` 与
    `wait` / `read` / `kill` / `remove` 都是**硬契约**（缺任一项直接红）。
  - **0.2.1 新增并已核对的契约**：会话当前目录 `ctx.workingDirectory.ensure` +
    `working-directory/change`、`jobs.start` 的 `toolCall`（`callId` + `rootCallId` 归属）、
    官方终端工具 `dsh-tool-pwsh` 的 `cwd` + `presentationMeta` + `workingDirectory` 镜像、
    `ConfigFormSnapshot` 没有 `mode`。0.2.0 部署上这些按缺失降级（工具退回 header cwd /
    不做 job 归属），不影响最低支持版本内的可用性。
  - **客户端侧唯一真漂移**：0.2.1 的官方设置快照删除了 `mode` 字段——已由 0.4.1 修复（见「升级到 0.4.1」）。
  - 其余客户端契约（`settings.general.item` 的空 owner props、`slots` / `locale` 服务、设置按 entry id
    寻址、`webUiSettings` 与原生 `configForms` 的 `get` / `mutate` / `set` / `unset` 用法）在 0.2.1 上
    本次核对仍然成立。
- 复跑（插件目录内）：`node scripts/selftest.mjs`（无部署 211/211；加 `DSH_STABLE_HOME` 真件复核
  227/227）、`node scripts/clientsmoke.mjs`（59/59）、
  `node scripts/compatcheck.mjs --fetch 0.2.0-rc.2 0.2.1-rc.1 0.2.1-rc.2`。
  `DSH_STABLE_HOME=<部署目录>` 会用部署里的真件复核（事件契约 / schema 校验器 / `volatileForm`）。

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
# 从 npm（推荐；需要 DSH >= 0.2.0）
npx @deepseek-ai/dsh plugin --profile web add dsh-tweaks-git-bash-terminal-tool

# 或从本仓库源码（开发调试）
npx @deepseek-ai/dsh plugin --profile web add "D:\你的目录\dsh-tweaks\plugins\git-bash-terminal-tool"
```

然后在 profile 的 `package.json` 里把 `dsh-tweaks-git-bash-terminal-tool` 加进 `dsh.profile.bundles`
（本仓库其他插件就是这么挂的；bundle 自带的 `cordis.patch.yml` 只 insert 自己一行）。

**重启一次 DSH**，再在浏览器里强制刷新（`Ctrl + Shift + R`）。

> 首次挂载必须重启：bundle 自带的 patch 在运行中插入的 row 只进组合树，
> 宿主半区的 `apply` 不会被调用（client bundle 会进启动图）。
> `web` 为 DSH 的 profile 名称，可在 `C:\Users\你的用户名\.dsh\profiles\` 下确认。

### 装不上？先看是不是「本地 link 留下的 junction」

如果这台机器**之前用本地路径装过**本插件（上面那条开发调试命令），profile 的 `node_modules` 里会留下一个
指向本仓库的 **junction**：

```text
<profile>\node_modules\dsh-tweaks-git-bash-terminal-tool  ->  D:\...\dsh-tweaks\plugins\git-bash-terminal-tool
```

之后再用市场 / npm 装**正式版**时，`pnpm add` 会把它当成本地包重新导入，并在导入后的目录里重建依赖链接；
Windows 上创建真实符号链接需要管理员权限或开发者模式，于是整条命令失败（2026-09 实测：pnpm 11.22 / Node 24 /
非管理员，pnpm 与 dsh 市场都会以同样的形式挂掉）：

```text
[ERR_PNPM_EPERM] [importPackage <profile>\node_modules\dsh-tweaks-git-bash-terminal-tool]
EPERM: operation not permitted, symlink 'D:\...\plugins\git-bash-terminal-tool\node_modules\...\@deepseek-ai\schemastery'
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

> 这不是包内容的问题：把同一个包 `npm pack` 后在干净工程里 `pnpm add`、或用市场装到没有历史 link 的
> profile 里都正常。只有「同一个包里既有本地 link、又要换成 registry 版本」时才会踩到。
> 想少踩：开发调试改用 tarball（`npm pack` 后 `dsh plugin add .\dsh-tweaks-git-bash-terminal-tool-0.5.0.tgz`），
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
手动删掉即可。旧版（0.1.0）写在 `$DSH_HOME/settings.yaml` 的 `terminal-tool:` 段不会被 0.1.7 导入
（见「升级到 0.2.0」），它只留在 `settings.yaml.imported` 里，同样可以手动删。
临时目录下的 `dsh-git-bash-terminal-tool.log` 同理。

## 已知限制

| 限制 | 说明 |
|---|---|
| 只对 Windows 生效 | bundle 自带的 patch 把整行 `disabled` 在非 win32 上：host 的 `apply` 不执行、client bundle 也不进启动图 |
| 只对新会话生效 | 运行中的会话保持启动时的终端选择（有意为之） |
| 极简模式会退化成一次性 shell | `minimal` 是唯一用持久 PTY 的官方预设；本插件在 win32 上把它的 `pwsh` 换成一次性 Git Bash（见「极简模式（minimal）的影响」） |
| 宿主侧改动要重启 | 与其他 DSH 插件一样：Node ESM 缓存，改宿主代码必须重启 |
| 原生 Windows 程序的中文输出是乱码 | 见下节「已知限制：原生 Windows 程序的输出编码」 |
| 「超时转后台」需要 DSH 0.2.x | 注册表齐 `wait`/`read`/`kill`/`remove` 才有；更老的 DSH 上自动退回「超时即杀」 |

### 已知限制：原生 Windows 程序的输出编码（与插件无关，Python 已缓解）

Git Bash 自己（`ls` / `grep` / `git` / bash 内建）输出 UTF-8，**中文一直是好的**。乱码只出现在
**原生 Windows 程序**上：它们把 stdio 按 **ANSI 代码页**（中文机器上是 936 / GBK）写进管道，
而 DSH 的采集端（`dsh-subprocess-local`）按 UTF-8 解码，于是：

```text
$ cmd /c ver
Microsoft Windows [�汾 10.0.19045.6466]      ← 「版本」

$ tasklist
ӳ������   PID �Ự��   �Ự#   �ڴ�ʹ��    ← 「映像名称 / PID / 会话名 / 内存使用」
```

实测结论：

- **`chcp 65001` 没有用**。它只改*控制台*代码页，而写**管道**用的是 `GetACP()` / `GetOEMCP()`，
  这两者不受 `chcp` 影响（本机复核过：加了 `chcp` 输出照旧乱码）。
- **`cmd` / `powershell` / `tasklist` 这类插件改不了**：解码发生在 DSH 的 subprocess 采集层，
  不在本插件里。
- **Python 可以修，而且已经修了**：0.4.0 起默认注入 `PYTHONIOENCODING=utf-8`
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
> 的回归），所以它必须把诊断改道到自己的临时文件 —— 它是通过环境变量 **`DSH_GIT_BASH_DIAG_FILE`**
> 做到的，`diag.ts` 每次写入时读这个变量。
>
> 这不是洁癖：0.4.0 之前两者共用一个文件，生产日志里混进了 100 多行只可能来自测试的记录
> （`replace: applied agent=session-1 bash=…/nodejs/node.exe`），排查时被读成
> 「另有一个跑歪的 DSH 实例」，白追了一轮。**自己写脚本调 `apply()` 时也请设这个变量。**

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
node scripts/selftest.mjs        # 发现算法 / 设置 / 升级契约 / 替换 / 工具契约 / 转后台 + 真机跑 Git Bash
node scripts/clientsmoke.mjs     # client bundle 协议 + apply + 行组件

# 契约漂移闸门：拿官方产物逐条核对（这里会真的 npm pack 到 .compat-cache/）
# 0.2.0 上会自动跳过 0.2.1 才有的契约（since 机制）
node scripts/compatcheck.mjs --fetch 0.2.0-rc.2 0.2.1-rc.1 0.2.1-rc.2

# 让自测用**部署里的**真件复核：dsh-tools 的工具 schema 校验器 + dsh-settings 的 volatileForm（推荐，CI 里可不设）
DSH_STABLE_HOME="D:/env/node-global/dsh-stable" node scripts/selftest.mjs
```

拿**本地目录**调试（`dsh plugin add <本目录>`）会在 profile 里建一个 junction；**换回 npm 正式版之前先把它删掉**，
否则 `pnpm add` 会以 `ERR_PNPM_EPERM` 失败（原因与判据见「安装 → 装不上？…」）。不想反复删就用 tarball 调试：
`npm pack` → `dsh plugin add .\dsh-tweaks-git-bash-terminal-tool-0.5.0.tgz`。

设计文档见 [`docs/plans/git-bash-terminal-tool-design.md`](../../docs/plans/git-bash-terminal-tool-design.md)（本地文档，不入库），
本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。

实现要点（细节都在源码注释里）：

- **运行时只依赖 `@deepseek-ai/schemastery`**（entry Config 必须是真 schema，见「升级到 0.2.0」）；
  其余官方契约全部是 `src/host/types.ts` 的结构性窄化投影，工具定义与执行器都自带
  （因为 win32 上 `ctx.shell` 就是 pwsh，本插件不接管它）。
- 替换发生在 per-agent 初始化事件 `agent/created`（0.1.5-rc.1 的 `agent/session-start` 自 0.1.6 起已被官方移除，
  见「升级到 0.3.3」），动作只有三个：在**该 agent 自己的 scope** 里
  `tools.restrict({ deny: ['pwsh'] })`、`tools.register(<自包含 Git Bash 工具>)`、
  `systemPrompt.section({ name: 'tool:pwsh', order: <TOOL_PWSH>, text: '' })` 压掉残留提示词
  （顺序优先读 `systemPrompt.getSectionOrder()`，读不到才用常量）。注册到一半失败时按登记的逆序
  **全部撤回**（0.5.0）。
- **会话当前目录**（0.2.1）：`await ctx.workingDirectory.ensure(agent, signal)` → 命令 cwd；
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
- 包名/目录已改名为 `dsh-tweaks-git-bash-terminal-tool`（体现 Git Bash）。**设置 namespace 现在是
  entry id `git-bash-terminal-tool`**（设置面按 entry id 定位，见「升级到 0.2.0」）；
  locale 命名空间与设置行 slot id 仍叫 `terminal-tool`（纯实现标识，不参与设置寻址）。
