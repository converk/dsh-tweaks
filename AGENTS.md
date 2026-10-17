# AGENTS.md

本文件写**在这个仓库里开发 DSH 插件时的约定与坑**；项目介绍见 [README.md](./README.md)。

**契约基线：DSH 0.2.1；最低支持 DSH 0.2.0。** 写码前按 §3.9 读真实 d.ts **与客户端产物**核对，**禁止凭记忆猜 Service / Slot / prop / 事件名**；换 DSH 版本后按 §5 重跑兼容检查。完整安装根下就是 `node_modules/@deepseek-ai/`（真目录，`ls` / `rg` 可直接读）：

- **定位当前安装**：launcher 部署用 `DSH_STABLE_HOME` 指向其固定安装目录（启动前按 npm dist-tags 自动更新，`DSH_CHANNEL` / `DSH_SKIP_UPDATE` 可覆盖）；否则沿启动命令 / 入口文件找它的 `node_modules` 根。
- **核对任意版本**：`node scripts/compatcheck.mjs --fetch <版本>` 把官方包 `npm pack` 解包到插件目录的 `.compat-cache/`（gitignored，首次运行时创建）；也可 `npm pack @deepseek-ai/<包>@<版本>`。版本号以 `package.json` 的 `version` 为准。

## 0. 文档同步（强制）

**DSH 升版导致本仓库插件需要重新开发时，必须在同一次改动里同步本文档**：头部契约基线改为新版本；§2 支持范围改为新基线；§3 按新基线重写契约、包名、服务名、Slot、事件名——只描述「在基线上怎么写」，不记录旧写法与版本演进史。落笔前按 §3.9 核对真实产物；发版走 §6。

## 1. 仓库与目录结构

本仓库是一组**互相独立**的 DSH 插件：`plugins/<name>/` 各是一个独立 npm 包，包名 `dsh-tweaks-<name>`。

```text
plugins/<name>/
├── package.json     # dsh.client + dsh.bundle.patch 双面声明；devDeps 只有构建/类型工具
├── cordis.patch.yml # bundle 自带 patch：insert 自己那一行（装插件时自动应用，见 §3.2）
├── build.mjs        # esbuild：lib/index.js（host ESM）+ lib/client.js（工厂外壳 + sourcemap）
├── tsconfig.json    # strict + jsx: react-jsx + DOM lib
├── README.md / LICENSE / screenshots.json（市场截图 URL）
├── pnpm-workspace.yaml + pnpm-lock.yaml
├── scripts/*.mjs    # 按需：selftest（宿主 + 纯逻辑）、clientsmoke（bundle 协议）、compatcheck（契约漂移）
│                    # 现状：git-bash-terminal-tool 三者齐全；prompt-history / smart-list 只有 selftest
└── src/             # index.ts（host 半区）+ host/ + shared/（无 node / DOM / React 依赖）+ client/（Slot + 组件 + 类型投影）

仓库根：README.md、docs/images/（截图，索引 docs/images/README.md）、market/（市场投稿材料副本，见下）、
.github/workflows/publish.yml（唯一发布通道，§6）、AGENTS.md。
```

**`market/`**：`market/data/plugins/<owner>__<repo>--<路径把 / 换成 ->.yml` 是**投稿条目的本地副本**；条目无版本字段，市场按 `repository.url` + `repository.directory` 自动关联 npm → **日常发版不用开 PR**，只有改条目元数据或新增插件才要。⚠️ 删这里的 yml 不会让市场下架，下架要按 [market/README.md](./market/README.md) 向上游提 PR；流程与 §6 同步。

**包与依赖（强制）**：包名一律 `dsh-tweaks-<name>`，**禁止**用 `@deepseek-ai` 作本仓库包 scope；引入第三方 npm 包必须先给出理由。

**插件独立性（强制）**：插件 A 不得 import / 依赖 / 探测插件 B 的任何代码、导出、服务名、配置键或文件，不许「共享常量 / 共享 utils」这类隐式耦合。相似代码**先各自复制**，同一能力在 ≥ 2~3 个插件稳定复现后才考虑下沉到公共基座（依赖单向：插件 → 基座，基座不感知插件）。提交前自检：删掉 / 禁用本插件后，DSH 与其他插件是否照常工作？停维护插件的旧代码同样不能当共享代码。

## 2. 插件状态与 DSH 支持

维护中的插件只有三个：`git-bash-terminal-tool`、`prompt-history`、`smart-list`，都支持 **DSH 0.2.0 – 0.2.1**（契约基线 0.2.1，最低支持 0.2.0）。

> 另有 `model-capabilities` 与 `turn-file-revert` 两个插件已停止维护，代码与文档已从仓库移除（停维护原因与最后支持的 DSH 版本见 [README.md](./README.md) 与 git 历史）。**不要恢复它们**，也不要为它们改仓库其他部分；仅当它们阻塞其他插件或 DSH 本身（如依赖冲突）时才允许最小处置，并在提交信息里写明原因。

## 3. DSH 契约与开发规范

### 3.1 运行时依赖与类型边界

- 运行时只能指望 DSH 官方运行时（`@deepseek-ai/dsh*`、`@deepseek-ai/cordis`、`cosmokit`、`schemastery`）、将来若有的公共基座与页面种子模块；**纯 UI 插件可运行时零依赖**（react 来自页面种子模块，构建工具全在 devDependencies）。
- DSH 契约一律用**结构性窄化投影**（见各插件 `src/**/types.ts`）：**不要 import 官方包**，投影只描述实际调用的那一小片形状。
- ⚠️ 有可编辑设置的插件必须把 `@deepseek-ai/schemastery` 写进 `dependencies`（由使用方的 DSH 提供）：`Config` 不是真 schema 就过不了 `volatileForm()`（§3.7）。

### 3.2 cordis 组合层与挂载

- 一切皆插件；row = `{ id, name, config, inject, disabled }`，插件间靠服务协作，不互相 import。
- 读**可选**服务用 `ctx.get('x')` 判空；**确为硬依赖**才 `inject: ['x']` 并用 `ctx.x`（否则 Guard 拒：`cannot get property "x" without inject`）。
- patch 层叠：bundle 自带 → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`；`- id: x` 替换整个 config（覆盖官方 row 要重述关心的键），追加 row 用 insert。
- 装插件：`dsh plugin --profile <p> add <pkg>` 自动写 `dsh.profile.bundles`，bundle 自带 patch insert 自己那行。⚠️ 手写 insert 时裸 `- name:` 会被跳过并 warn `patch: id is required for non-insert patches`。
- 平台闸门：insert 项写 `disabled: !!js process.platform !== 'win32'`（官方 `bash-sandbox` / `tool-pwsh` 同写法）；非 win32 时 host `apply` 不执行、client bundle 不进启动图 = 没装。参考 `plugins/git-bash-terminal-tool/cordis.patch.yml`。
- ⚠️ 运行中插入的 row 只进组合树，宿主 `apply` 不执行（client bundle 会进启动图）→ **双面插件首次挂载要先重启 dsh** 再刷新浏览器。
- 判断宿主半区挂上没有（免浏览器）：未登录 `POST http://127.0.0.1:<port>/<channel>/<endpoint>`，**401 = 路由已注册**、405 = 没注册；`/api` 下任何路径都被栅栏拦成 401，基准要拿**非 `/api`** 未知路径对照。

### 3.3 双面插件与 client bundle 协议

- `package.json` 声明 `dsh.client.platform = 'web'`；**host 半区** = `main` 导出的 `apply(ctx, config)`（纯 UI 插件空 apply，只在宿主组合树占位；要可编辑设置同时导出 `Config`，见 §3.7）；**client 半区** = `exports["./client"]` 指向的**已构建** bundle。
- bundle 必须是**经典脚本**（非 ESM）：自注册工厂 `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {…} })`，工厂体 CJS，只允许 `require` 页面种子模块（`react` / `react/jsx-runtime`），**必须带 sourcemap trailer**（`//# sourceMappingURL=client.js.map`，合法 v3）。构建照抄 `plugins/prompt-history/build.mjs`。
- 页面 React 是 **18**（`@types/react ~18.3`，别引 React 19 类型）。
- ⚠️ client 半区**必须 `export const inject = [...]` 声明用到的服务**（如 `slots`、`locale`）：入口插件没有 inject 会立刻激活，此时 `slots` 可能还没被提供，插件会**静默什么都不注册**。
- ⚠️ 反面：硬 `inject` 的服务在目标 DSH 里**永远不出现**时条目**永远 pending**（界面无反应、日志无异常）。可选服务一律 `ctx.get` 判空。
- client 侧改动要构建监视才热重载；**宿主侧改代码必须重启 dsh**（Node ESM 缓存）。

### 3.4 Slot 与浏览器 UI 扩展点

- 四种 kind：`single`（整体替换，多数 `shadows-shipped-ui`，慎用）/ `list`（追加条目，**新 id 即新增**）/ `keyed`（按 key 替换，如 `conversation.chat.node` 按 ChatNodeKind）/ `chain`（**独木桥**：按优先级取第一个接受 owner 的注册项就 break，官方已占的 chain 抢不到）。
- 注册：`slots.inject(key, () => slots.register({ name, id, order }, (props) => el))`，keyed 席位用 `{ name, key }`；disposer 由注入回调原样交还。`slots` 由 `dsh-client-ui-renderer` 提供；`SlotCore` 0.2.1 起**不再随完整安装单独发布**（内联进 `dsh-web-frontend/dist`），以运行时产物与 slot-catalog 为准。
- session 作用域 Slot 注入标准 props（按需判空）：`sessionId`、`useChat`、`useSession`、`useInput`、`inputActions`、`useProjection`…；选择器要返回**引用稳定**的值，否则每次 store 变化都重渲染。
- 常用席位：`conversation.input.overlay`（composer 卡片内浮层，纯 UI 首选）/ `conversation.input.left|right` / `conversation.input.dock` / `conversation.chat.node`（keyed）/ `conversation.chat.turnTail` / `conversation.chat.assistant-actions` / `settings.models.provider-card`（keyed）/ `settings.general.item` / `settings.section`。
- ⚠️ **别猜 kind**：整份 Slot 目录（带 `kind` / `scope` / `occupants` / `replaceRisk` / `declaredBy` / `source`）就在部署里，查法见 §3.9。已知 `chain` 只有 `conversation.composer`、`shell.quota-notice`、`sidebar.right.tab.guide`——**其余都不是独木桥**。
- 输入区：composer 是 **contenteditable（Lexical）不是 textarea**。改草稿两条路：整段替换 `inputActions.setDraft(text)`；光标处插纯文本用 `inputActions.captureInsertion()` 拿带 `draftRev` 的 `TokenSpan`，再 `inputActions.insertText(text, span)`（字面 `\n` 就是换行；composer CSS 是 `white-space: pre-wrap`，官方粘贴路径也这么插）。键盘拦截配方（document 捕获相 + `[data-composer-card]` 限定作用域 + 避开 IME + 查 `phase === 'plain'` + preventDefault）见 `plugins/prompt-history/src/client/overlay.tsx`；**接管 Shift+Enter 还要 `stopPropagation`**（Lexical 的 `KEY_ENTER_COMMAND` 优先级 0 会再插软换行），见 `plugins/smart-list/src/client/overlay.tsx`。Chat 快照取 `useChat((s) => s.legacy.nodes)`，用户输入是 `kind === 'user' | 'steering'` 节点里的 text 块。
- ✅ **「本轮文件改动」那一行在 `conversation.chat.turnTail`——是 `list` 席位（`replaceRisk: 'none'`），不是 chain**：官方 `dsh-client-ui-deliverables` 只是其中一个条目（`id: '@deepseek-ai/dsh-client-ui-deliverables'`），同席还有 `client-ui-plan PlanCards`、`client-ui-schedule ScheduleTurnCard`。⇒ 加行直接 `slots.register({ name: 'conversation.chat.turnTail', id: '<自己的 id>', order }, …)`：新 `id` 即新条目，复用官方 `id` 才是替换。**不要**为此走 DOM 增补。
- **DOM 增补只在确实没有席位时用**：在 session 作用域 Slot 注册隐藏锚点拿 `sessionId`，再观察转写区把自有元素插到官方产物行之后。稳定判据（**别用哈希类名**）：`[data-turn-tail="<turn>"]`、`[data-chat-turn]`、`[data-actions-reveal]`（只在 `closing !== null` 分支写，值 `endsWithResponse ? "always" : "hover"`，可当「回合已收尾、动作条已渲染」判据）、`[data-changed-files]`、`[data-presented-files-row]`；⚠️ `[data-produced-files-row]` **不存在于任何官方产物**——选 DOM 判据前先在部署里 grep（§3.9）。
- DOM 增补纪律：自有元素带统一标记属性；`MutationObserver` 忽略自身写入、按判据**幂等重新定位**；先过滤「变更是否落在 turn-tail 子树内」以免流式输出每帧触发；停止时移除全部自有 DOM。

### 3.5 host ↔ client 数据通道

- ⚠️ **不要用 `ctx.connection.rpc.handle(...)`**：它内部拿 `owner = this.ctx`（**不是调用方 ctx**）去 `owner.webServer.register(route)`，真实插件必抛 `cannot get property "webServer" without inject`（声明 `webServer` 也没用；官方包零处用它）。
- ✅ **用 `/api` 下的精确 Fetch 路由**：宿主 `ctx.connection.fetch.register(route)`，`ConnectionFetchRoute` 形状 `{ path: string（/api 之下绝对路径）, methods: ('POST'|…)[] , requestBody: 'buffered' | 'streaming', fetch(request) }`，返回 disposer（官方有 7 处在用）；浏览器同源 `fetch('/api/<name>', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })`。信任栅栏与登录 cookie 由物理 `/api` 载体统一处理，不必自己鉴权。

### 3.6 宿主侧写文件（沙箱）与可观测性

- ⚠️ `ctx.fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` 的**第 5 参必须传**：`dsh-fs-sandbox/lib/index.js` 是 5 参、按位置透传（`super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal)`）——少传等于 `checkedTarget(target, undefined)`，退回「无会话」的部署兜底 workspace root，**连会话工作区内的写回都判越界**。（`dsh-fs-local` 同名方法只有 4 参，别照它写。）
- 策略口径（与官方 deliverables 同）：`ctx.sandboxPolicy.resolve({ session })`；workspace root 取 `session.cwd ?? ctx.sandboxPolicy.workspaceRoot`。⚠️ `session.cwd` 就是**不可变的** `session.header.cwd`（原始项目）：模型用 `working_directory` 工具切目录**不会扩大**沙箱授权范围。
- ⚠️ **命令 cwd 与沙箱 workspace root 是两回事**：跟随会话当前目录用 `ctx.workingDirectory.ensure(agent, signal)`（**async**，必须 await）——该服务 0.2.1 才有（`dsh-working-directory`），**最低支持版本上没有** → `ctx.get('workingDirectory')` 判空，缺了退回 `session.header.cwd`（`git-bash-terminal-tool` 的降级路径）。`sandboxPolicy.resolve()` 仍按 header cwd 算 workspace root，别拿它当命令 cwd。
- ⚠️ `read-only` 模式下 `rm` **不经过沙箱**：插件要自己判掉，否则会绕过只读策略删文件。
- 宿主是 Node ESM、改代码必须重启；浏览器侧失败只表现为静默，所以关键动作要**留文件日志**（`os.tmpdir()` 下一行一条）。参考 `plugins/git-bash-terminal-tool/src/host/diag.ts`。

### 3.7 设置面：entry Config + volatile

设置 = 插件自己那个 profile entry 的 Config，namespace 就是 **entry id**（bundle patch 里 insert 的 `id`）。可编辑字段必须在导出的 `Config` 里用 `.volatile()` 声明，例：`export const Config = z.object({ preference: z.union(['light', 'dark']).default('light').volatile() })`，`apply(ctx, config)` 里用 `config.preference.get()`。

- **`apply` 第二个参数是解析后的 config**，volatile 字段是**稳定引用**（`Volatile<T>`）：`config.x.get()` 永远最新，`settings.update/mutate` 落盘后由 Loader 就地更新（`loader/volatile-update`）→ **不需要 watch、不需要重启**；普通字段仍是启动配置（改了要重挂载）。
- ⚠️ **`Config` 必须是真 schemastery**：`volatileForm()` 读 `.meta` / `.dict`，`plainSchema()` 还会 `new z(schema.toJSON())`；手写「有 `toJSON` 的 schema」过不了这两步，表现是**设置行在、读不到值也写不进去且无报错**。
- ⚠️ **schema 表达不了跨字段约束**（如「A 选了 bash 则 B 必须是存在的文件」）：`update/mutate` 只跑 schemastery → 这类校验放在**使用点**（fail safe）。
- 宿主面是 `ctx.settings`：`describe / update(ns, patch, rev) / replace / mutate(ns, ops, rev) / configure`，**没有 `register`**——插件不注册 namespace，也别直接写 `$DSH_HOME/settings.yaml`；持久化落在**当前 profile 的 patch**（`configEditor.documentPath`，即 `profiles/<p>/cordis.patch.yml`）。
- 浏览器面是官方 `ctx.configForms.get(entryId)`（`dsh-client-ui-settings` 提供）：`ConfigForm` 有 `getSnapshot / subscribe / mutate(ops, rev) / set(field, value) / unset(field)`，均返回 `Promise<boolean>`（false = 宿主拒绝）。⚠️ 别把设置通道放进 `inject`：可选服务硬依赖会让条目永远 pending。家族兼容层 `webUiSettings`（`@linxin666/dsh-client-ui-web-ui-settings`）**不在官方部署里**，按 namespace bind、与旧的 `settingsScope` 同形；做法是「有就用、没有就退回官方 `configForms`」，两条都用 `ctx.get` 判空取。参考 `plugins/git-bash-terminal-tool/src/client/index.ts`。
- ⚠️ **`ConfigFormSnapshot` 字段会漂移**：0.2.1 起没有 `mode`（0.2.0 有 `mode: 'host' | 'memory'`）。判断可写只看 `snapshot.writable === true && snapshot.status === 'ready'`；家族兼容层会 promote 到官方原生表单，它带来的 `mode` 不可依赖。漏判的表现是**设置行照常渲染、控件全部 disabled、无报错**。
- 用 `settings.general.item` 槽自建一行时，服务通常晚于本插件激活：用 `ctx.inject([...], () => …)` 等它出现再登记席位（服务晚到时 `ctx.get` 只是 undefined）。
- 验证套路（免浏览器）：部署里 `dsh-settings/lib/types/schema.js` 的 `volatileForm(Config)` 必须返回 object 表单；自测用**部署里的真件**复核（参考 `plugins/git-bash-terminal-tool/scripts/selftest.mjs`）。

### 3.8 静默失效：名字写错、少 await 都不会报错

cordis 的事件名、服务名、Slot 键、DOM 判据全是裸字符串 / 属性：**写错不抛错、`tsc` 也过**，只是永远不生效。

| 契约 | 正确写法 | 写错的后果 |
|---|---|---|
| per-agent 初始化事件 | `ctx.on('agent/created', ({agent, source, signal}) => …)`；`@mode serial`，creation resolve 前被 **await**，工具与提示词在这里装完再返回 | 监听器永不触发：设置存了，工具没换 |
| `ctx.sandbox.confine` | **async**，必须 `await` | 拿到 Promise：`argv` / `runnerFailureRules` 全 undefined，真机报 `undefined is not iterable` |
| `ctx.tools.restrict` | 必须在 **agent scope** 调用；名字未知会**抛错**（插件靠这个判断 pwsh 是否已被隐藏） | 在根 ctx 调用直接抛；写错名字静默无效 |
| `ctx.systemPrompt.section` | 同名 section 会 shadow 外层，空文本被丢弃（用它压掉官方提示词） | 压不掉，模型仍看到旧方言 |
| 会话当前目录（`ctx.workingDirectory`） | `await ctx.workingDirectory.ensure(agent, signal)`（**async**）；`session.header.cwd` 是**不可变**的原始项目（0.2.1 起才有该服务，更低版本判空退回 header cwd） | 拿 header cwd 当命令 cwd：模型 `cd` 后命令还在旧目录，终端卡片与 `pwd` 对不上 |
| `jobs.start` 的调用归属 | `ctx.jobs.start({ …, toolCall: { callId, rootCallId } })`——PTC 子调用的 `callId` 不是根调用，必须同时给 `rootCallId` | 后台任务卡片归错调用 / 会话事件找不到所属根调用，`job_output` 关联不上 |

- `jobs.start` 的 `run()` 要求**同步**交回 hooks，而 `confine` 是 async → 要在 `jobs.start` **之前**把受限 argv 解析好（官方 `dsh-pwsh-sandbox` 也是「先 await 再 spawn」）。
- `ctx.jobs.start` 的 `owner` 必须是 **agent id（= session id）字符串**（`dsh-jobs-local` 用它 `agents.get()` 反查活着的 agent；传 agent 对象抛 `session "[object Object]" has no live agent`）；`job_output` 只读 `start({ output: [拉取源…] })` 泵出的输出环，hooks 上返回 `readOutput()` 不存在——少给 `output` 的表现是任务照常跑完但 `job_output` 永远为空。
- Windows 沙箱已知边界：ACL 沙箱给子进程的是「写受限令牌」，MSYS2 / Git Bash 创建信号管道（`\\\\.\\pipe\\`）会被拒（`couldn't create signal pipe, Win32 error 5`）——用官方 pwsh 工具跑 `bash.exe` 同样失败，**不是插件 bug**；Git Bash 要真能跑起来，会话沙箱得是 `danger-full-access`。

### 3.9 权威契约位置（`<dsh>/node_modules/@deepseek-ai/`）

下表路径都相对**完整安装**的 `node_modules/@deepseek-ai/`（真目录，`ls` / `rg` 可直接读）：

| 查什么 | 路径 |
|---|---|
| client 模块系统（boot wire、`__ModuleLoader__` 协议） | `dsh-client-modules/lib/types/client/manifest.d.ts` |
| conversation 系列 Slot / InputState / InputActions / ComposerBar | `dsh-client-ui-conversation/lib/types/client/contract/*.d.ts` |
| Chat 快照 / 键控节点渲染器 / UseChat | `dsh-client-ui-chat/lib/types/client/contract/*.d.ts` |
| 工具事件（`tools/pre-execute` / `post-execute`）、`ToolExecution.rootCallId`、`output.presentationMeta` | `dsh-tools/lib/types/index.d.ts` |
| 会话事件（`session/event`、`tool/call{turn,callId,name,arguments}`、`job/registered` / `job/settled`） | `dsh-session/lib/types/*.d.ts`、`dsh-jobs/lib/types/types.d.ts` |
| agent 事件（`agent/created` / `pre-step` / `disposed`） | `dsh-agent/lib/types/runtime-types.d.ts` |
| 会话当前目录（`workingDirectory.ensure/get/set`、`working-directory/change`；0.2.1 新增） | `dsh-working-directory/lib/types/index.d.ts`、`dsh-tool-working-directory/lib/types/index.d.ts` |
| 文件服务、沙箱策略、沙箱 provider | `dsh-fs/lib/types/index.d.ts`、`dsh-sandbox-policy/…`、`dsh-sandbox/lib/types/index.d.ts` |
| 设置面：entry Config / volatile / 表单投影 | `dsh-settings/lib/types/{index,schema}.d.ts`、`schemastery/lib/types/index.d.ts` |
| 客户端设置表单（原生 `configForms`） | `dsh-client-ui-settings/lib/types/client/config-form.d.ts`、`config-form-types.d.ts` |
| 终端卡片（读 `tool/result.meta.cwd`） | `dsh-client-ui-tool/lib/types/client/tool/models/terminal-card-model.d.ts` |
| 纯 UI 插件模板（空 host apply + dsh.client + overlay） | `dsh-client-ui-input-trigger/{package.json, lib/index.js, lib/client.js}` |
| Slot 目录与服务 / 事件 / 类型目录 | `dsh-cordis-client-runner/lib/client.js` 的 `api-catalog`（`SERVICE_API` / `EVENT_API` / `TYPE_API`）与 `slot-catalog` 两段——**生成物别手改**，会话内 Inspect 也能查；**查 Slot 真实 kind 就查这里，别猜**（§3.4） |

**d.ts 查不到的必须去客户端产物里核**：DOM 判据、服务是否真的被 provide、事件是否真的被派发都在 `lib/client.js` / `lib/index.js` 的字符串里——`dsh-client-ui-renderer` / `dsh-client-ui-chat` / `dsh-client-ui-conversation` 等包都有构建好的 `lib/client.js`，别当纯类型包。这类契约**没有任何类型保护**，写错只会静默失效。

⚠️ **解析官方产物按包 `exports` / glob 取，别写死文件名**（否则自测 / 脚本假红）：0.2.1 起 `dsh-api-gateway` 的 client 产物拆成 `lib/client.browser.js` + `lib/client.node.js`（`exports["./client"]` 按 browser / default / node 条件映射，浏览器启动图仍取 browser 产物；0.2.0 是单个 `lib/client.js`）；`dsh-client-ui-slots` 不再作为独立包随完整安装发布（`SlotCore` 内联进 `dsh-web-frontend/dist/assets/index-*.js`，`keyed slot "…" requires options.key` 语义仍在）。启动图另有 `WebBootRelease` / `readRelease` 门控（只应用与页面 boot release 相同的 graph）——升级 DSH 后旧页面刷新即换新启动图，不是插件问题。

**若部署是 asar 打包**（没有 `.d.ts`，`ls` / `rg` 读不到）：asar 格式简单，`node` 手写十几行即可（**别装 asar 依赖**）——偏移 12 起的 u32 = JSON 索引长度，索引 = 偏移 16 起该长度的 JSON（递归 files 树），文件内容起点 = 16 + 索引长度 + `Number(entry.offset)`，`entry.unpacked` 无 offset、跳过。抽到临时目录读，用完即删（**别提交解包产物**）。

**会话内 Inspect**：工具名 `cordis_inspect_list` / `cordis_inspect_query` / `cordis_inspect_self`（**不是** `cordis_inspect`）；`Slots` provider 只有 `listSubTree`（内部走 `slots.snapshot(root)`）。**已知缺陷**：带对象 `input` 的精确查询在 `inspect-registry` 的 `validateInput` 处被拒（形如 `"input" must be an object`），精确契约改读上表 d.ts。

## 4. 工具链与环境坑

语言 TypeScript（strict、禁 any 滥用），**ESM only**（`\"type\": \"module\"`）；Node ≥ 22 / **pnpm**（不要混用 npm、yarn）；主分支 `main`，一次 commit 一个主题。

**构建与检查一律直调，不要走 `pnpm run`**：pnpm 10+ 默认拦截依赖构建脚本（`ERR_PNPM_IGNORED_BUILDS: esbuild`），随后的 `pnpm run *` 会因依赖状态预检整体失败；esbuild 平台二进制经 optionalDependencies 分发，postinstall 并非必需。（pnpm 11 另：`pnpm` 字段已不再被读取，构建白名单写在 `pnpm-workspace.yaml` 的 `allowBuilds`（本仓库为 `esbuild: true`）；`package.json` 的 `pnpm` 字段只为 pnpm 10 保留。）

```powershell
node build.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs        # 宿主 + 纯逻辑自测
node scripts/clientsmoke.mjs     # 浏览器半区冒烟（有则写）
```

- Windows 下 `node_modules/.bin/*` 是 sh 脚本，**不能** `node .bin/xxx`；TypeScript 走 `node node_modules/typescript/bin/tsc`。
- ⚠️ **移动 / 改名仓库目录后必须重装依赖**：Windows + pnpm 用**绝对路径 junction**，目录一搬全悬空（`Test-Path` 仍为 True 但取不到内容，报 `Cannot find module ...`）。在每个插件目录重跑 `pnpm install --ignore-scripts --force`（CI 设 `CI=true`；PowerShell：`$env:CI='true'; pnpm install --ignore-scripts --force`；不加 `--force` pnpm 会认为「已是最新」不修链接），并改掉 DSH profile 里指向本仓库的 `link:` 路径后重装，否则重启 dsh 后 Loader 解析不到插件。

## 5. 开发流程与自测

- 写码前按 §3.9 读真实 d.ts **和客户端产物**核对契约，不要凭记忆猜名字。
- 改完至少跑 `tsc --noEmit` + `node scripts/selftest.mjs`（有 client 半区再加 clientsmoke，有宿主契约再加 compatcheck）；改契约代码时**顺带补一条能抓住本次回归的断言**。
- **让自测用真件**：`DSH_STABLE_HOME` 指向完整部署（`git-bash-terminal-tool` 的 selftest 用它复核事件契约 / 工具 schema / `volatileForm` 等真件）；没有完整部署时 `DSH_SETTINGS_ENTRY` / `DSH_SCHEMASTERY_ENTRY` 可直接指到单包产物；纯 UI 插件的官方产物段用 `DSH_CONTRACT_HOMES` 指向部署（可给多份）。文档与脚本里不要写作者机器的绝对路径或仓库里不存在的路径；CI 上没有部署就**跳过**官方产物段，**不要为了绿而弱化断言**。
- **防漂移**：有宿主的插件带 `scripts/compatcheck.mjs`（`--fetch <版本> …`；升级核对用 `--fetch <旧版本> <新版本>` 矩阵），拿官方产物逐条核对事件名 / 方法签名 / 服务形状；自测里**必须**对事件名等裸字符串有断言——裸字符串等于没测。`compatcheck` 的契约都是**硬契约**：**最低支持版本内必须全绿**；确需「仅低于最低支持版本才告警」的诊断条目时再引入可选机制。`git-bash-terminal-tool` 的 `jobs.wait/read/kill/remove`（超时转后台）是**硬契约**；运行期仍保留「缺失则退回超时即杀」的防御性降级，但不作为支持承诺。
- 纯 UI 插件同样要有 `scripts/selftest.mjs`：把官方产物原文 / 结构（Slot 声明、标准 props、locale 签名、运行时 DOM 邻接）钉成断言，无 DSH 部署时跳过官方产物段（CI 友好）。参考 `plugins/prompt-history/scripts/selftest.mjs`；**有键盘 / DOM 交互的纯 UI 插件**再加一层「假 DOM + vm 驱动组件」的行为断言（不装 react、不开浏览器就能测按键接管与放行），参考 `plugins/smart-list/scripts/selftest.mjs`。官方产物路径按包 `exports` 解析，别写死 `lib/client.js`（§3.9）。
- 快速预览交互可用会话内动态 Cordis 插件（`cordis_define` / `cordis_run` / `cordis_undefine`），但落地交付一律以本仓库 TS 包为准，**两者不要同时挂同一 Slot**。
- 核对 client 半区是否进了启动图（免浏览器）：用只含 Host 半区的动态插件注册工具返回 `ctx.get('clientModules').graph().entries` 与 `clientPath('<包名>')`；动态沙箱**不允许**读 `connection` 这类返回 cordis Context 的服务。

## 6. 发布：一律走 CI，为对应插件打 tag

维护中的插件各自独立发版，版本号在 `plugins/<name>/package.json`。⚠️ `scripts.prepack` 是 **`npm run build`**（`scripts.build` = `node build.mjs`，另有 `watch` / `check`），**不是** `prepack: node build.mjs`——`prepack` 会自动重建 `lib/`，发布前不用手动构建。

**规则（强制）**：新增插件或发布新版本时**不要**在本地 `npm publish`，改为打 tag 触发 `.github/workflows/publish.yml`（npm trusted publishing / GitHub OIDC，无需 token）。tag 形如 `<插件目录名>/v<版本>`，**版本必须与 `package.json` 逐字一致**；CI 跑 `tsc --noEmit` + `build.mjs` + selftest + clientsmoke（有哪个跑哪个；需要 DSH 部署的门控断言在 CI 上自行跳过）。首次发布某插件可先在 Actions 页 `publish` → Run workflow 选插件 + `dry_run` 验证。本地 `npm publish` 只在 CI 故障时应急，且没有 provenance。

**新增插件还要做**（漏第 2 项 CI 会直接报 `未知插件`）：

1. `plugins/<name>/package.json`：包名 `dsh-tweaks-<name>`、`version`、`prepack: npm run build`（+ `build: node build.mjs`）、`dsh.bundle.patch: ./cordis.patch.yml`、`files` 含 `lib` / `cordis.patch.yml` / `README.md` / **`src`**（`types` / `exports.types` 指向 `src/*.ts` 时缺 `src` 会让消费方类型悬空；照抄现有插件）。
2. `publish.yml` **两处**加插件**目录名**：`workflow_dispatch.inputs.plugin.options` 与 `jobs.publish` 里 `case "$plugin" in` 的白名单。
3. npmjs.com 上给**这个包**配一次 trusted publishing（npm 按包授权）：Provider `GitHub Actions` / Repository `converk/dsh-tweaks` / Workflow name `publish.yml` / Environment 留空 / Allowed actions `npm publish`；配好后可删旧的 npm token。
   ⚠️ **全新包名要先本地首发一次**：npm 不支持给「还不存在的包名」预先配 trusted publisher（`npm trust` 会因包不存在失败）。顺序：本地交互式 `npm publish --access public` → 完成 2FA（npm 默认 staged publishing，先生成占位 `0.0.0-stage`，再按提示 Approve 真实版本）→ `npm trust github <包名> --file publish.yml --repo converk/dsh-tweaks --allow-publish -y` → 之后新版本由 tag 触发 CI 自动发布。
