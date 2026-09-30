# AGENTS.md

本文件写**在这个仓库里开发 DSH 插件时的注意事项与踩坑经验**；项目介绍见 [README.md](./README.md)。

**契约基线：DSH 0.2.0-rc.2**（2026-09 用完整部署全量核对；同一次核对也覆盖了 0.1.7-rc.2）。
本仓库插件**最低支持 DSH 0.1.7**。写码前按 §2.7 读真实 d.ts **与客户端产物**核对，
**禁止凭记忆猜 Service / Slot / prop / 事件名**；换 DSH 版本后按 §6 重跑兼容检查。

> **文中 `<dsh>` 指 DSH 的部署目录**，也就是 `node_modules/@deepseek-ai/` 所在的那一层。
> 不确定在哪，可以看 `$DSH_HOME`（默认 `~/.dsh`）下的启动脚本，或从正在运行的 `dsh` 进程命令行反查。

## 0. 插件维护状态

| 插件 | 状态 | DSH 契约支持到 |
|---|---|---|
| `prompt-history` | 维护中 | 跟随最新（当前核对到 0.2.0-rc.2） |
| `model-capabilities` | 维护中 | 同上 |
| `git-bash-terminal-tool` | 维护中 | 同上（最低 0.1.7） |
| `turn-file-revert` | **已停止维护（2026-09）** | **0.2.0-rc.2 —— 最后一版，不再跟进** |

### turn-file-revert 的例外规则（强制）

该能力官方 DSH 0.2.x **已内置**（回合改动卡片 + 逐文件 diff 复核），所以本仓库从 2026-09 起**停止维护**：

- **不再随 DSH 版本迭代**：之后的 DSH 版本升级、契约审计、兼容性核对、CI、发布**一律忽略这个插件**。
  它只保证到 **0.2.0-rc.2**；在更新的 DSH 上不保证可用，**也不再修**。
- 版本号停在 `0.1.1`：不要再 bump、不要为它发 tag/发布、不要把它加进任何 profile 的 `dsh.profile.bundles`。
- 源码与 README 保留只作参考（它的 DOM 增补写法仍有教学价值），但**不要"顺手修一下"**，
  更不要为了它去改仓库其他部分或公共文档的其余章节。
- 唯一例外：如果它**阻塞**了其他插件或 DSH 本身（例如依赖冲突），才允许做最小处置，并在提交信息里写明原因。

## 1. 工具链与构建

| 项 | 约定 |
|---|---|
| 语言 | TypeScript（strict、禁 any 滥用），**ESM only**（`"type": "module"`） |
| 运行时 / 包管理 | Node ≥ 22 / **pnpm**（不要混用 npm、yarn） |
| Git | 主分支 `main`；一次 commit 一个主题 |

**构建与检查一律直调，不要走 `pnpm run`**（原因见 §4.1）：

```powershell
node build.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs        # 宿主 + 纯逻辑自测
node scripts/clientsmoke.mjs     # 浏览器半区冒烟（有则写）
```

## 2. DSH 契约与坑（0.2.0 基线）

### 2.1 cordis 组合层与挂载

- 一切皆插件；row = `{ id, name, config, inject, disabled }`，插件之间靠服务协作，不互相 import。
- 读**可选**服务用 `ctx.get('x')` 并判空；**确为硬依赖**才 `inject: ['x']` 并用 `ctx.x`——
  未声明就用 `ctx.x` 会被 Guard 拒：`cannot get property "x" without inject`。
- patch 层叠顺序：bundle 自带 patch → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`。
  `- id: x` 形式**替换目标 row 的整个 config**（覆盖官方 row 要重述所有关心的键）；追加新 row 用 insert 形制。
- **装插件**：`dsh plugin --profile <p> add <pkg>`。0.2.0 起这条命令**会自动**把包写进
  `dsh.profile.bundles`（2026-09 在 0.2.0-rc.2 上实测：已有 profile 与新建 profile 都自动加），
  不需要再手工补一遍；bundle 自带的 `cordis.patch.yml` 负责 insert 自己那一行。
  ⚠️ 只有**手写** insert 时才要注意：裸 `- name:` 会被跳过并 warn
  `patch: id is required for non-insert patches`。
- ⚠️ **运行中插入的 row 只进组合树，宿主半区的 `apply` 不会执行**（client bundle 会进启动图、
  浏览器也会真的加载它）。→ **双面插件首次挂载必须先重启一次 dsh**，再刷新浏览器。
- 判断宿主半区到底挂上没有（不用浏览器）：未登录 `POST http://127.0.0.1:<port>/<channel>/<endpoint>`
  → **401 = 路由已注册**（被信任栅栏拦下），405 = 没注册。注意 `/api` 前缀下**任何**路径都会被栅栏拦成 401，
  所以基准要拿一个**非 `/api`** 的未知路径（405）来对照。（0.2.0-rc.2 实测仍如此。）

### 2.2 双面插件与 client bundle 协议

- `package.json` 声明 `dsh.client.platform = 'web'`；**host 半区** = `main` 导出的 `apply(ctx, config)`
  （纯 UI 插件就是空 apply，只用于在宿主组合树里占位；要暴露可编辑设置就同时导出 `Config`，见 §2.9）；
  **client 半区** = `exports["./client"]` 指向的**已构建** bundle。
- bundle 必须是**经典脚本**（非 ESM），自注册工厂：
  `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {…} })`，工厂体为 CJS，
  只允许 `require` 页面种子模块（**`react` / `react/jsx-runtime`**），并**必须带 sourcemap trailer**
  （`//# sourceMappingURL=client.js.map`，合法 v3）。构建照抄本仓库 `plugins/prompt-history/build.mjs`。
  （0.2.0 的 `dsh-client-modules` 协议与 0.1.7 一致，未变。）
- 页面 React 是 **18**（`@types/react ~18.3`，别引 React 19 类型）。
- ⚠️ client 半区**必须 `export const inject = [...]` 声明用到的服务**（如 `slots`、`locale`）：
  入口插件没有 inject 会立刻激活，此时 `slots` 可能还没被 ui-renderer 提供，插件会**静默什么都不注册**。
  （这个坑真踩过：`prompt-history` 最初漏了 `inject`，表现就是"装上了但按 ↑ 没反应"，日志无任何报错。）
- ⚠️ **硬 `inject` 的另一面**：声明了但目标 DSH 里那个服务永远不出现，条目会**永远 pending**
  （界面无反应、日志无异常）。可选服务一律 `ctx.get` 判空，不要图省事写进 `inject`。
- client 侧改动要构建监视才热重载；**宿主侧改代码必须重启 dsh**（Node ESM 缓存，Loader 用同一条说明符 `import()`）。

### 2.3 Slot 与浏览器 UI 扩展点

- 四种 kind：`single`（整体替换，多数 `shadows-shipped-ui`，慎用）/ `list`（追加条目，**新 id 即新增**）/
  `keyed`（按 key 替换，如 `conversation.chat.node` 按 ChatNodeKind）/ `chain`
  （**独木桥**：按优先级取第一个接受 owner 的注册项就 break，官方已占的 chain 抢不到）。
- 注册（0.2.0 签名未变）：`slots.inject(key, () => slots.register({ name, id, order }, (props) => el))`；
  keyed 席位用 `{ name, key }`。`inject` 等 Slot 声明方挂载后再注册，disposer 由注入回调原样交还，
  停止/更新自动移除。
- **`slots` 服务由 `dsh-client-ui-renderer` 提供**（`lib/client.js` 里 `super(ctx, "slots")`），
  注册语义（`SlotCore`）在 `dsh-client-ui-slots`——后者在部署里**有**运行时目录，别当成纯类型包。
- session 作用域 Slot 会注入标准 props（按需判空）：`sessionId`、`useChat`、`useSession`、`useInput`、
  `inputActions`、`useProjection`…；选择器要返回**引用稳定**的值，否则每次 store 变化都重渲染。
- 常用席位：`conversation.input.overlay`（composer 卡片内浮层，纯 UI 首选）/ `conversation.input.left|right` /
  `conversation.input.dock` / `conversation.chat.node`（keyed）/ `settings.models.provider-card`（keyed）/
  `settings.general.item` / `settings.section`。
- 输入区契约：composer 是 **contenteditable（Lexical）不是 textarea**，改草稿只能走 `inputActions.setDraft(text)`；
  键盘拦截配方（document 捕获相 + `[data-composer-card]` 限定作用域 + 避开 IME + 查 `phase === 'plain'` +
  preventDefault）见 `plugins/prompt-history/src/client/overlay.tsx`。Chat 快照取 `useChat((s) => s.legacy.nodes)`，
  用户输入是 `kind === 'user' | 'steering'` 节点里的 text 块。
- ⚠️ 「本轮文件改动」那一行在 **chain 席位 `conversation.chat.turnTail`**（官方 `dsh-client-ui-deliverables` 占据），
  插件抢不到；想在它之后加内容只能走 **DOM 增补**（参考 `plugins/turn-file-revert/src/client/augment.ts`，
  该插件已停止维护，只当写法参考）：
  在 session 作用域 Slot 注册隐藏锚点拿 `sessionId`，再观察转写区把自有元素插到官方产物行之后。
  稳定判据（**别用哈希类名，也别照抄文档**——下面这几条都在两份完整部署里全量扫过）：
  `[data-turn-tail="<turn>"]`（值 = 回合号，`dsh-client-ui-chat`）、`[data-chat-turn]`（同包）、
  `[data-actions-reveal]`（同包，只在**回合收尾**后写上 → 可当「动作条已渲染」的判据）、
  `[data-changed-files]`（官方「本轮文件改动」卡片，`dsh-client-ui-deliverables`）、
  `[data-presented-files-row]`（present 工具的**交付文件行**，同包，别与上一条混为一谈）。
  ⚠️ `[data-produced-files-row]` **不存在于任何官方产物**（曾经把它当稳定判据，结果是死选择器 + 静默降级）。
  选任何 DOM 判据前，先在部署里 grep 一遍再写进代码。
  纪律：自有元素带统一标记属性（如 `data-dsh-tfr`）；`MutationObserver` 忽略自身写入、
  按判据**幂等重新定位**；先过滤「变更是否落在 turn-tail 子树内」以免流式输出每帧触发；停止时移除全部自有 DOM。

### 2.4 host ↔ client 数据通道

- ⚠️ **不要用 `ctx.connection.rpc.handle(...)`**：它内部拿 `owner = this.ctx`（**不是调用方 ctx**）去
  `owner.webServer.register(route)`，真实插件里必抛
  `cannot get property "webServer" without inject`（声明 `webServer` 也没用；0.2.0 官方包**零处**用它，
  唯一的 rpc 消费者 `dsh-api-gateway` 走的是 `intercept('/api')`）。
- ✅ **用 `/api` 下的精确 Fetch 路由**：
  宿主 `ctx.connection.fetch.register(route)`，0.2.0 的 `ConnectionFetchRoute` 形状为
  `{ path: string（/api 之下的绝对路径）, methods: ('POST'|…)[] , requestBody: 'buffered' | 'streaming', fetch(request) }`，
  返回 disposer（`() => Promise<void>`，官方有 7 处在用 → 这条路确定可用）；
  浏览器同源 `fetch('/api/<name>', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload) })`。信任栅栏与登录 cookie 由物理 `/api` 载体统一处理，插件不必自己鉴权。

### 2.5 宿主侧写文件（沙箱）

- ⚠️ `ctx.fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` 的**第 5 参必须传**：
  不传时 `dsh-fs-sandbox` 会退回「无会话」的部署兜底 workspace root，**连会话工作区内的写回都判越界**：
  `cannot write "…": file access denied under workspace-write mode`。
- 策略口径（与官方 deliverables 相同）：`ctx.sandboxPolicy.resolve({ session })`；
  workspace root 取 `session.cwd ?? ctx.sandboxPolicy.workspaceRoot`（拿不到 session 时用记录下来的会话 cwd）。
- ⚠️ `read-only` 模式下 `rm` **不经过沙箱**：插件要自己判掉，否则会绕过只读策略删文件。

### 2.6 宿主半区的可观测性

宿主是 Node ESM、改代码必须重启，而浏览器侧失败只表现为静默（界面毫无反应）。所以关键动作要**留文件日志**
（`os.tmpdir()` 下一行一条），排查时直接读文件、不用让用户抄终端。参考 `plugins/git-bash-terminal-tool/src/host/diag.ts`。

### 2.7 权威契约位置（`<dsh>/node_modules/@deepseek-ai/`）

下表路径都是相对上面那个目录（0.2.0-rc.2 实测全部存在）：

| 查什么 | 路径 |
|---|---|
| client 模块系统（boot wire、`__ModuleLoader__` 协议） | `dsh-client-modules/lib/types/client/manifest.d.ts` |
| conversation 系列 Slot / InputState / InputActions / ComposerBar | `dsh-client-ui-conversation/lib/types/client/contract/*.d.ts` |
| Chat 快照 / 键控节点渲染器 / UseChat | `dsh-client-ui-chat/lib/types/client/contract/*.d.ts` |
| 工具事件（`tools/pre-execute` / `post-execute`）、ToolExecution | `dsh-tools/lib/types/index.d.ts` |
| 会话事件（`session/event`、`tool/call{turn,callId,name,arguments}`） | `dsh-session/lib/types/*.d.ts` |
| agent 事件（`agent/created` / `pre-step` / `disposed`） | `dsh-agent/lib/types/runtime-types.d.ts` |
| 文件服务、沙箱策略、沙箱 provider | `dsh-fs/lib/types/index.d.ts`、`dsh-sandbox-policy/…`、`dsh-sandbox/lib/types/index.d.ts` |
| **设置面**：entry Config / volatile / 表单投影 | `dsh-settings/lib/types/{index,schema}.d.ts`、`schemastery/lib/types/index.d.ts` |
| 客户端设置表单（原生 `configForms`） | `dsh-client-ui-settings/lib/types/client/config-form*.d.ts` |
| 纯 UI 插件模板（空 host apply + dsh.client + overlay） | `dsh-client-ui-input-trigger/{package.json, lib/index.js, lib/client.js}` |

插件的类型投影是**结构性窄化**（见各插件 `src/**/types.ts`），**不要 import 官方包**——但别据此以为
那些包在部署里不存在：`dsh-client-ui-slots` 部署里**有** `lib/index.js`（导出 `SlotCore`）。
查服务名/方法签名直接读 d.ts 与客户端产物，不要凭「类型-only」猜。

**d.ts 查不到的东西必须去客户端产物里核**：DOM 判据、服务是否真的被 provide、事件是否真的被派发
（`lib/client.js` / `lib/index.js` 里的字符串）。这类契约**没有任何类型保护**，写错只会静默失效。

会话内 Inspect（`Slots.listSubTree` 等）无参查询可用；**已知缺陷**：带对象 `input` 的精确查询报
`"input" must be an object`，精确契约改读上表的 d.ts。

### 2.8 依赖白名单

只允许 DSH 官方运行时（`@deepseek-ai/dsh*`、`@deepseek-ai/cordis`、`cosmokit`、`schemastery` 等）
与将来本仓库的 `commons/` 基座；引入其他第三方 npm 包必须先给出理由。包名一律 `dsh-tweaks-<name>`，
禁止使用 `@deepseek-ai` 作为本仓库包 scope。
实践基准：**纯 UI 插件可以做到运行时零依赖**——react 来自页面种子模块，DSH 契约用类型投影，
构建期工具链（esbuild、typescript、@types/react）全部放 devDependencies。

⚠️ 0.1.7 起，「有可编辑设置的插件」**必须**依赖 `@deepseek-ai/schemastery`：`Config` 得是真的
schemastery schema，手写对象过不了 `volatileForm()`（见 §2.9）。它属白名单内的官方运行时，
但必须写进 `dependencies` 而不是 devDependencies（发布后由使用方的 DSH 提供）。

### 2.9 设置面：entry Config + volatile

设置 = 插件自己那个 profile entry 的 Config，namespace 就是 **entry id**（bundle patch 里 insert 的 `id`）。
可编辑字段必须在导出的 `Config` 里用 `.volatile()` 声明：

```ts
import z from '@deepseek-ai/schemastery'
export const Config = z.object({ preference: z.union(['light', 'dark']).default('light').volatile() })
export function apply(ctx, config) { const value = config.preference.get() }
```

- **`apply` 的第二个参数是解析后的 config**，volatile 字段是**稳定引用**（`Volatile<T>`）：
  `config.x.get()` 永远是最新值，`settings.update/mutate` 落盘后由 Loader 就地更新
  （`loader/volatile-update`）→ **不需要 watch、不需要重启**。普通字段仍是启动配置（改了要重挂载）。
- ⚠️ **`Config` 必须是真 schemastery**（`@deepseek-ai/schemastery`，部署里就有）。
  `dsh-settings` 的 `volatileForm()` 读 `.meta` / `.dict`，`plainSchema()` 还会
  `new z(schema.toJSON())`；手写一个「有 `toJSON` 的 schema」过不了这两步，表现是
  **设置行在、但读不到值也写不进去，且毫无报错**。依赖声明见 §2.8。
- ⚠️ **schema 表达不了跨字段约束**（如「A 选了 bash 则 B 必须是存在的文件」）：
  `update/mutate` 只跑 schemastery，不会调你的自定义校验 → 把这类校验放在**使用点**（fail safe）。
- **宿主面是 `ctx.settings`**（0.2.0 实测）：`describe / update(ns, patch, rev) / replace / mutate(ns, ops, rev) /
  configure`，**没有 `register`** —— 插件不再自己注册 namespace，也不要直接写 `$DSH_HOME/settings.yaml`；
  持久化落在**当前 profile 的 patch**（`configEditor.documentPath`，即 `profiles/<p>/cordis.patch.yml`）。
- **浏览器面是官方的 `ctx.configForms.get(entryId)`**（`dsh-client-ui-settings` 提供）：
  `ConfigForm` 有 `getSnapshot / subscribe / mutate(ops, rev) / set(field, value) / unset(field)`，
  这几个方法返回 `Promise<boolean>`（false = 宿主拒绝）。
  ⚠️ **不要把设置通道放进 `inject`**：它是可选服务，硬依赖会让条目永远 pending。
- 家族兼容层 `webUiSettings`（`@linxin666/dsh-client-ui-web-ui-settings` 提供的第三方服务）**不在官方部署里**
  （0.2.0 官方产物 0 命中）：只有在用户装了那套插件时才有，按 namespace bind，契约与旧的 `settingsScope` 同形。
  优雅做法是「有就用、没有就退回官方 `configForms`」，两条都用 `ctx.get` 判空取。
  参考 `plugins/git-bash-terminal-tool/src/client/index.ts`。
- 用 `settings.general.item` 槽自建一行时，服务通常晚于本插件激活：用
  `ctx.inject([...], () => …)` 等它出现再登记席位（服务晚到时 `ctx.get` 只是 undefined）。
- 验证套路（不开浏览器）：`dsh-settings/lib/types/schema.js` 的 `volatileForm(Config)` 必须返回一个
  object 表单；自测里用**部署里的真件**复核（参考
  `plugins/git-bash-terminal-tool/scripts/selftest.mjs` 的「用部署里的 dsh-settings 复核 volatileForm」）。

### 2.10 静默失效：名字写错、少 await 都不会报错

cordis 的事件名、服务名、Slot 键、DOM 判据全是裸字符串/属性：**写错不抛错、`tsc` 也过**，
只是永远不生效。历史上已经栽过两次（issue #1），所以按下面这套写：

| 契约 | 正确写法（0.1.7 起，0.2.0 同样） | 写错的后果 |
|---|---|---|
| per-agent 初始化事件 | `ctx.on('agent/created', ({agent, source, signal}) => …)`；`@mode serial`，creation resolve 前被 **await**，工具与提示词在这里装完再返回 | 监听器永不触发：设置存下来了，但工具没换 |
| `ctx.sandbox.confine` | **async**，必须 `await` | 拿到 Promise：`argv`/`runnerFailureRules` 全 undefined，真机报 `undefined is not iterable` |
| `ctx.tools.restrict` | 必须在 **agent scope** 调用；名字未知会**抛错**（插件靠这个判断"pwsh 是否已被隐藏"） | 在根 ctx 调用直接抛；写错名字静默无效 |
| `ctx.systemPrompt.section` | 同名 section 会 shadow 外层，空文本被丢弃（用它压掉官方提示词） | 压不掉，模型仍看到旧方言 |

- `jobs.start` 的 `run()` 要求**同步**交回 hooks，而 `confine` 是 async → 要在 `jobs.start` **之前**
  把受限 argv 解析好（官方 `dsh-pwsh-sandbox` 也是「先 await 再 spawn」）。
- **防漂移**：有宿主的插件带 `scripts/compatcheck.mjs`（`node scripts/compatcheck.mjs --fetch <版本> …`），
  拿官方产物逐条核对事件名 / 方法签名 / 服务形状；自测里**必须**对事件名等裸字符串有断言——
  裸字符串等于没测。参考 `plugins/git-bash-terminal-tool/scripts/{compatcheck,selftest}.mjs`。
- Windows 沙箱的已知边界：ACL 沙箱给子进程的是「写受限令牌」，MSYS2 / Git Bash 创建信号管道
  （`\\.\pipe\`）会被拒（`couldn't create signal pipe, Win32 error 5`）—— 用官方 pwsh 工具跑
  `bash.exe` 同样失败，**不是插件 bug**；Git Bash 要真能跑起来，会话沙箱得是 `danger-full-access`。

## 3. 插件独立性（强制）

- 插件 A **不得** import / 依赖 / 探测插件 B 的任何代码、导出、服务名、配置键或文件；
  不允许「共享常量文件」「共享 utils」这类隐式耦合。已停止维护的 `turn-file-revert` 也一样：
  不要拿它当共享代码。
- 每个插件是 `plugins/<name>/` 下的**独立 npm 包**（独立 `package.json` 与依赖声明）。
- 相似代码**先各自复制**，不要为 DRY 提前抽象；同一能力在 ≥ 2~3 个插件稳定复现后才考虑下沉到 `commons/`
  （依赖方向单向：插件 → 基座，基座永远不感知任何插件）。
- 提交前自检：删掉/禁用本插件后，DSH 与其他插件是否照常工作？

## 4. 已知坑

### 4.1 不要走 `pnpm run`

pnpm 10+ 默认拦截依赖的构建脚本（`ERR_PNPM_IGNORED_BUILDS: esbuild`），随后的 `pnpm run *` 会因依赖状态预检整体失败。
esbuild 的平台二进制经 optionalDependencies 分发，postinstall 并非必需 → **直接 `node build.mjs` /
`node node_modules/typescript/bin/tsc --noEmit`**。pnpm 11 另：`pnpm` 字段（含 `onlyBuiltDependencies`）
已不再被读取，保留只是兼容旧版。

### 4.2 Windows 下的 .bin shim

`node_modules/.bin/*` 是 sh 脚本，不能用 `node .bin/xxx`；TypeScript 用 `node node_modules/typescript/bin/tsc`。

### 4.3 移动仓库目录后必须重装依赖（Windows + pnpm）

pnpm 在 Windows 上用**绝对路径 junction** 把 `node_modules/<pkg>` 链到 `node_modules/.pnpm/...`，
**仓库目录一改名/搬动，这些 junction 全部悬空**（`Test-Path` 仍返回 True，但取不到内容：
`Cannot find module .../node_modules/typescript/bin/tsc`）。修法：在每个插件目录重跑

```powershell
$env:CI='true'; pnpm install --ignore-scripts --force   # 不加 --force 时 pnpm 会认为"已是最新"而不修链接
```

同一原因：搬动仓库后还要把 DSH profile 里指向本仓库的 `link:` 依赖路径改掉并重装
（`$DSH_HOME/profiles/<p>/package.json` + 重跑 `pnpm install`，或重新 `dsh plugin add <新路径>`），
否则重启 dsh 后 Loader 解析不到插件。
> pnpm 的 hoisted 链接器**不会**自动清理已经改名/移除的旧 junction，要手动删。

## 5. 目录约定

```text
plugins/<name>/
├── package.json     # 双面插件声明 dsh.client；devDeps：esbuild / typescript / @types/react
├── build.mjs        # esbuild：lib/index.js（host ESM）+ lib/client.js（工厂外壳 + sourcemap）
├── tsconfig.json    # strict + jsx: react-jsx + DOM lib
├── README.md        # 面向用户：功能 / 怎么用 / 安装 / 效果图 / DSH 兼容性
├── scripts/*.mjs    # selftest（宿主 + 纯逻辑）、clientsmoke（bundle 协议 + apply）、compatcheck（契约漂移）
└── src/
    ├── index.ts     # host 半区（纯 UI 插件 = 空 apply；有设置则导出 Config + apply(ctx, config)）
    ├── host/        # 宿主侧：服务、事件监听、/api Fetch 路由、诊断日志
    ├── shared/      # host/client 共用纯逻辑（无 node / DOM / React 依赖）
    └── client/      # 浏览器半区：Slot 注册 + 组件 + 类型投影
```

契约细节与踩坑记在**源码注释**和本文档里，不再单独拆开发文档。

## 6. 开发流程

- 写码前先按 §2.7 读真实 d.ts **和客户端产物**核对契约；不要凭记忆猜名字。
- 每个插件自带自测脚本，改完至少跑：`tsc --noEmit` + `node scripts/selftest.mjs`（有 client 半区再加 clientsmoke；
  有宿主契约再加 compatcheck）。改契约相关代码时，**顺带补一条能抓住本次回归的断言**。
- 快速预览交互可用会话内动态 Cordis 插件（`cordis_define` / `cordis_run` / `cordis_undefine`，0.2.0 仍在），
  但落地交付一律以本仓库的 TS 包为准，**两者不要同时挂同一 Slot**。
- 核对 client 半区是否进了启动图（不开浏览器）：用只含 Host 半区的动态插件注册工具，返回
  `ctx.get('clientModules').graph().entries` 与 `clientPath('<包名>')`；
  注意动态沙箱**不允许**读 `connection` 这类返回 cordis Context 的服务。
- 改动仓库根文档时别忘 §0：`turn-file-revert` 的要求**不跟随**新版本，也不用写进兼容性核对。

## 7. 发布（npm）

每个**维护中**的插件是独立 npm 包，版本号在各自 `package.json` 里（`prepack` 会自动 `node build.mjs`）。
⚠️ `turn-file-revert` 已停止维护，**不发布、不打 tag**（见 §0）。

**发布一律走 CI，见 §8**；本地 `npm publish` 只作应急（§8.6）。

## 8. 发布方式：新插件 / 新版本一律走本仓库 CI，为对应插件打 tag

**规则（强制）**：只要**新增插件**或**发布某个插件的新版本**，就不要在本地 `npm publish` ——
改为在 `.github/workflows/publish.yml`（npm trusted publishing / GitHub OIDC，无需任何 token）
里按**单个插件**打 tag 触发。tag 形如 `<插件目录名>/v<版本>`。

### 8.1 打 tag（推荐路径）

```powershell
# 1) 先改好 plugins/<name>/package.json 的 version（例：0.3.4），提交并推到 main
git add plugins/<name> && git commit -m "feat(<name>): ..."
git push origin main

# 2) 打 tag：<插件目录名>/v<版本> —— 版本必须与 package.json 逐字一致
git tag git-bash-terminal-tool/v0.3.4
git push origin git-bash-terminal-tool/v0.3.4
```

推上去后 CI 自动跑（`push: tags: '*/v*'`）。**先本地验证再打 tag**：CI 只跑
`tsc --noEmit` + `build.mjs` + `selftest.mjs` + `clientsmoke.mjs`（有哪个跑哪个），
不跑需要 DSH 部署的门控检查（CI 上没有 `DSH_*_HOME`，那些断言会自行跳过）。

### 8.2 或在 Actions 页手动 dispatch（可选 dry-run）

Actions → `publish` → Run workflow：选插件 + `dry_run`（只 `npm publish --dry-run`，不真发布）。
**第一次发布某个插件时先用 dry-run 跑一遍**，确认构建/自测/打包都对，再打 tag 或再 dispatch 一次。

### 8.3 新增插件要做的三件事（缺一不可）

新插件不是"写好代码就能发"，三项都要做，漏了第 2 项 CI 会直接报 `未知插件`：

1. `plugins/<name>/package.json`：包名 `dsh-tweaks-<name>`、`version`、`prepack: node build.mjs`、
   `files` 里含 `lib`/`cordis.patch.yml`/`README.md`（照抄现有插件）。
2. `.github/workflows/publish.yml` **两处**都要加这个插件的**目录名**：
   - `workflow_dispatch.inputs.plugin.options`（下拉选项）
   - `jobs.publish.steps["解析插件与版本"]` 里的 `case "$plugin" in` 白名单
   （tag 触发时用的是 `${GITHUB_REF_NAME%%/v*}`，也同样过这个白名单。）
3. npmjs.com 上给**这个包**配一次 trusted publishing（npm 是按包授权的，**每个包各配一次**）：
   `npmjs.com → 包 → Settings → Trusted publishing → Add a trusted publisher`
   Provider `GitHub Actions` / Repository `converk/dsh-tweaks` / Workflow name `publish.yml`（逐字一致）/
   Environment 留空 / Allowed actions `npm publish`。配好后可删掉旧的 npm token。

### 8.4 CI 里发生了什么

`checkout` → 解析插件与版本（tag 触发时**校验 tag 版本 == package.json 版本**，不一致直接失败）→
pnpm 11 + Node 22 → 升级 npm（trusted publishing 要求 ≥ 11.5.1）→
`pnpm install --frozen-lockfile --ignore-scripts` → `tsc --noEmit` + `node build.mjs` + selftest + clientsmoke →
`npm publish --provenance --access public`（**不设 NODE_AUTH_TOKEN**，用 Actions 的 OIDC 换一次性凭证）。

### 8.5 常见失败

| 现象 | 原因 |
|---|---|
| `未知插件 'xxx'` | 忘了把目录名加进 §8.3 第 2 项的两处白名单 |
| `tag 版本 'x' 与 package.json 的 'y' 不一致` | tag 里的版本和 `package.json` 不一致（改了版本没改 tag，或反之） |
| `403` / `ENEEDAUTH` | 该包的 trusted publishing 没配（§8.3 第 3 项），或 workflow 名/仓库名写错 |
| provenance 报错 | 仓库必须 public，且 workflow 有 `id-token: write`（默认已有） |
| CI 里自测变少/跳过 | 正常：CI 没有 DSH 部署，`DSH_*_HOME` 门控的契约断言会跳过；别把这当成"检查过了" |

### 8.6 应急：本地手动发布（不是常规路径）

只有在 CI 不可用（Actions 故障、急需补发）时才用，且要说明原因：
`cd plugins/<name> && npm publish`。用 granular token 时 **scope 必须覆盖该包** ——
无 scope 的包（`dsh-tweaks-*`）要在 token 里选 **All packages**，只选 `@<user>` 会被 403 挡下。
本地发布会**没有 provenance**，与 CI 产物不同；能走 CI 就走 CI。
