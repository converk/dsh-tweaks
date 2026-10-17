# AGENTS.md

本文件写**在这个仓库里开发 DSH 插件时的约定与坑**；项目介绍见 [README.md](./README.md)。

**契约基线：DSH 0.2.1**（2026-10 用桌面运行时 + 本地源码全量核对）。写码前按 §3.9 读真实 d.ts **与客户端产物**核对，**禁止凭记忆猜 Service / Slot / prop / 事件名**；换 DSH 版本后按 §5 重跑兼容检查。

⚠️ **`<dsh>` 有两个，别混**（2026-10 实测；下文凡说 `<dsh>` 都指这张表）：

| 部署 | 路径 | 实测版本 | 有 d.ts？ |
|---|---|---|---|
| **桌面 App 的运行时**（当前会话真正跑的就是它，`DSH_PROFILE=desktop`） | `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar\dsh\` | `0.2.1-rc.1` | ❌ 整个 asar 里 **0 个** `.d.ts`，只有运行时产物 |
| **npm 全局 CLI**（`npm i -g @deepseek-ai/dsh`） | `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\` | `0.1.7-rc.2` | ✅ `node_modules/@deepseek-ai/` 下齐全 |

- **要读 d.ts / 实现细节** → 首选 **DSH 源码 checkout**（本机为 `D:\GitHub\deepseek-harness`，`0.2.1-rc.2`）：`packages/<domain>/<pkg>/src/*.ts` 是权威实现，`packages/<domain>/<pkg>/lib/**` 是构建产物；它没有把全部 workspace 包链接进根 `node_modules`，所以单包验证要按 §5 指到具体文件。
- 没有源码时，用**完整 CLI 部署**（上表第二行）读 d.ts，或按 §5 用 `compatcheck.mjs --fetch <版本>` 把官方产物 `npm pack` 到 `.compat-cache/`。**桌面运行时读不到 d.ts**。
- **要核运行时字符串 / DOM 判据 / Slot kind** → 用**桌面运行时**（上表第一行），但它在 **asar 归档里**：`ls` / `cat` / `rg` 一律报「系统找不到指定的路径」，必须用 asar 读取（§3.9 给了读法）。
- 版本号以 `package.json` 的 `version` 为准；`0.2.1` 是基线口径，桌面实测是 `0.2.1-rc.1`，源码是 `0.2.1-rc.2`。

## 0. 文档同步（强制）

**只要 DSH 升版导致本仓库插件需要重新开发，就必须在同一次改动里同步更新本文档**：

1. 头部**契约基线**改成新版本。
2. §2 的维护状态与「支持的 DSH 版本」，并把需要重新开发的插件在各自 `package.json` 里 bump 版本（发布走 §6）。
3. §3 **按新版本重写**：契约、包名、服务名、Slot、事件名全部以新基线为准，**不要保留旧版本的写法或版本对比说明**——本文档只描述「在基线上怎么写」，不记录版本演进史。落笔前按 §3.9 读真实 d.ts 与客户端产物核对。

## 1. 仓库与目录结构

本仓库是一组**互相独立**的 DSH 插件：`plugins/<name>/` 各是一个独立 npm 包，包名 `dsh-tweaks-<name>`。

```text
plugins/<name>/
├── package.json     # 双面插件声明 dsh.client + dsh.bundle.patch；devDeps：esbuild / typescript / @types/react
├── cordis.patch.yml # bundle 自带 patch：insert 自己那一行（装插件时由 dsh 自动应用，写法见 §3.2）
├── build.mjs        # esbuild：lib/index.js（host ESM）+ lib/client.js（工厂外壳 + sourcemap）
├── tsconfig.json    # strict + jsx: react-jsx + DOM lib
├── README.md        # 面向用户：功能 / 怎么用 / 安装 / 效果图 / DSH 兼容性
├── LICENSE
├── screenshots.json # 交给插件市场的截图绝对 URL 列表（指向 docs/images/ 下的图）
├── pnpm-workspace.yaml + pnpm-lock.yaml
├── scripts/*.mjs    # selftest（宿主 + 纯逻辑）、clientsmoke（bundle 协议 + apply）、compatcheck（契约漂移）
│                    # ⚠️ 按需：不是每个插件都有 scripts/，也不是每个都有这三个
│                    #    实测 git-bash＝三个都有，model-capabilities＝只有 selftest，
│                    #    prompt-history＝只有 selftest，turn-file-revert＝clientsmoke + selftest（已冻结）
└── src/
    ├── index.ts     # host 半区（纯 UI 插件 = 空 apply；有设置则导出 Config + apply(ctx, config)）
    ├── host/        # 宿主侧：服务、事件监听、/api Fetch 路由、诊断日志
    ├── shared/      # host/client 共用纯逻辑（无 node / DOM / React 依赖）
    └── client/      # 浏览器半区：Slot 注册 + 组件 + 类型投影

仓库根：
├── README.md              # 面向用户的总入口（各插件功能 + 效果图 + 安装）
├── docs/images/           # 根 README 与各插件 README 引用的截图（索引见 docs/images/README.md）
├── market/                # 上架 awesome-dsh-plugin 的投稿材料本地副本（见下）
├── .github/workflows/publish.yml   # 唯一的发布通道（§6）
└── AGENTS.md
```

**`market/`（投给插件市场）**：`market/data/plugins/<owner>__<repo>--<路径把 / 换成 ->.yml` 是**已合并进上游**的条目副本；条目里没有版本字段，市场按 `repository.url` + `repository.directory` 自动关联 npm，所以**日常发版不用再开 PR**，只有改条目元数据或新增插件才要。

⚠️ `market/README.md` 的 §4/§6 仍写「本地 `npm login` + `npm publish`」循环（还停在 `git-bash-terminal-tool` 0.3.2），**已被 §6 的「打 tag 走 CI」取代**——读到那里以 §6 为准；那份文档只有「条目文件路径规则 / 改元数据要开 PR」部分仍然有效。

**包与依赖（强制）**：包名一律 `dsh-tweaks-<name>`，**禁止**用 `@deepseek-ai` 作为本仓库包 scope；引入第三方 npm 包必须先给出理由。

**插件独立性（强制）**：插件 A 不得 import / 依赖 / 探测插件 B 的任何代码、导出、服务名、配置键或文件，不允许「共享常量文件」「共享 utils」这类隐式耦合（已停维护的 `turn-file-revert` 也一样，不能当共享代码）。相似代码**先各自复制**，同一能力在 ≥ 2~3 个插件稳定复现后才考虑下沉到 `commons/`（依赖方向单向：插件 → 基座，基座不感知任何插件）。提交前自检：删掉/禁用本插件后，DSH 与其他插件是否照常工作？

## 2. 插件维护状态与 DSH 版本支持

| 插件 | 状态 | 支持的 DSH 版本 |
|---|---|---|
| `prompt-history` | 维护中 | 0.1.7 – 0.2.1（0.1.1 起按 0.2.1 核对） |
| `model-capabilities` | 维护中 | 0.1.7 – 0.2.1（0.1.1 起：官方原生多模态/推理控件不再重复注入；补 `llm-deepseek-account`） |
| `git-bash-terminal-tool` | 维护中 | 0.1.7 – 0.2.1，跟随最新（0.5.0 起对齐 0.2.1 的 `workingDirectory` / `presentationMeta` / `jobs.toolCall`） |
| `turn-file-revert` | **已停止维护（2026-09）** | **只到 0.2.0，不再跟进** |

**`turn-file-revert` 的例外规则（强制）**：该能力官方 DSH 0.2.x **已内置**（回合改动卡片 + 逐文件 diff 复核），所以本仓库从 2026-09 起停止维护。之后的 DSH 升级、契约审计、兼容性核对、CI、发布**一律忽略这个插件**——只保证到 **0.2.0**，在更新的 DSH 上不保证可用也不再修；版本号停在 `0.1.1`（已作为最后一次发布发出）：不要再 bump、不要打 tag / 发布、不要加进任何 profile 的 `dsh.profile.bundles`；源码与 README 保留只作参考（DOM 增补写法仍有教学价值），但**不要「顺手修一下」**，也不要为它改仓库其他部分。唯一例外：它**阻塞**了其他插件或 DSH 本身（如依赖冲突）时才允许最小处置，并在提交信息里写明原因。

## 3. DSH 契约与开发规范

### 3.1 运行时依赖与类型边界

- 插件运行时能指望的只有 DSH 官方运行时（`@deepseek-ai/dsh*`、`@deepseek-ai/cordis`、`cosmokit`、`schemastery`）、将来本仓库的 `commons/` 基座，以及页面种子模块；**纯 UI 插件可以做到运行时零依赖**（react 来自页面种子模块，构建期工具链 esbuild / typescript / @types/react 全在 devDependencies）。
- DSH 契约一律用**结构性窄化投影**（见各插件 `src/**/types.ts`），**不要 import 官方包**——投影只描述实际调用的那一小片形状。
- ⚠️ 「有可编辑设置的插件」必须把 `@deepseek-ai/schemastery` 写进 `dependencies`（发布后由使用方的 DSH 提供）：`Config` 不是真 schema 就过不了 `volatileForm()`（见 §3.7）。

### 3.2 cordis 组合层与挂载

- 一切皆插件；row = `{ id, name, config, inject, disabled }`，插件之间靠服务协作，不互相 import。
- 读**可选**服务用 `ctx.get('x')` 并判空；**确为硬依赖**才 `inject: ['x']` 并用 `ctx.x`（未声明就用会被 Guard 拒：`cannot get property "x" without inject`）。
- patch 层叠：bundle 自带 patch → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`。`- id: x` 形式**替换目标 row 的整个 config**（覆盖官方 row 要重述所有关心的键）；追加新 row 用 insert 形制。
- **装插件**：`dsh plugin --profile <p> add <pkg>`；这条命令会自动把包写进 `dsh.profile.bundles`，bundle 自带的 `cordis.patch.yml` 负责 insert 自己那一行。⚠️ 只有**手写** insert 才要注意：裸 `- name:` 会被跳过并 warn `patch: id is required for non-insert patches`。
- **平台闸门**：想让某个 row 只在 Windows 上挂载，在 bundle 自带 patch 的 insert 项上写 `disabled: !!js process.platform !== 'win32'`（`!!js` 表达式在 patch 层合法；官方 `bash-sandbox` / `tool-pwsh` 同一写法）。非 win32 时 host 半区 `apply` 不执行、client bundle 也不进启动图——等于没装。参考 `plugins/git-bash-terminal-tool/cordis.patch.yml`。
- ⚠️ **运行中插入的 row 只进组合树，宿主半区的 `apply` 不会执行**（client bundle 会进启动图并被浏览器加载）→ **双面插件首次挂载必须先重启一次 dsh**，再刷新浏览器。
- 判断宿主半区挂上没有（免浏览器）：未登录 `POST http://127.0.0.1:<port>/<channel>/<endpoint>`，**401 = 路由已注册**，405 = 没注册；注意 `/api` 前缀下**任何**路径都会被栅栏拦成 401，基准要拿**非 `/api`** 的未知路径对照。

### 3.3 双面插件与 client bundle 协议

- `package.json` 声明 `dsh.client.platform = 'web'`；**host 半区** = `main` 导出的 `apply(ctx, config)`（纯 UI 插件就是空 apply，只在宿主组合树里占位；要暴露可编辑设置就同时导出 `Config`，见 §3.7）；**client 半区** = `exports["./client"]` 指向的**已构建** bundle。
- bundle 必须是**经典脚本**（非 ESM），自注册工厂 `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {…} })`，工厂体为 CJS，只允许 `require` 页面种子模块（**`react` / `react/jsx-runtime`**），并**必须带 sourcemap trailer**（`//# sourceMappingURL=client.js.map`，合法 v3）。构建照抄 `plugins/prompt-history/build.mjs`。
- 页面 React 是 **18**（`@types/react ~18.3`，别引 React 19 类型）。
- ⚠️ client 半区**必须 `export const inject = [...]` 声明用到的服务**（如 `slots`、`locale`）：入口插件没有 inject 会立刻激活，此时 `slots` 可能还没被 ui-renderer 提供，插件会**静默什么都不注册**。
- ⚠️ 反面：硬 `inject` 的某个服务在目标 DSH 里**永远不出现**，条目会**永远 pending**（界面无反应、日志无异常）。可选服务一律 `ctx.get` 判空，不要图省事写进 `inject`。
- client 侧改动要构建监视才热重载；**宿主侧改代码必须重启 dsh**（Node ESM 缓存）。

### 3.4 Slot 与浏览器 UI 扩展点

- 四种 kind：`single`（整体替换，多数 `shadows-shipped-ui`，慎用）/ `list`（追加条目，**新 id 即新增**）/ `keyed`（按 key 替换，如 `conversation.chat.node` 按 ChatNodeKind）/ `chain`（**独木桥**：按优先级取第一个接受 owner 的注册项就 break，官方已占的 chain 抢不到）。
- 注册：`slots.inject(key, () => slots.register({ name, id, order }, (props) => el))`，keyed 席位用 `{ name, key }`；disposer 由注入回调原样交还。`slots` 服务由 `dsh-client-ui-renderer` 提供，注册语义（`SlotCore`）在 `dsh-client-ui-slots`；桌面 0.2.1-rc.1 的 asar 里没有这个独立包，`SlotCore` 被打进 `dsh-client-ui-renderer/lib/client.js`（完整 CLI 部署里才有独立包）。
- session 作用域 Slot 会注入标准 props（按需判空）：`sessionId`、`useChat`、`useSession`、`useInput`、`inputActions`、`useProjection`…；选择器要返回**引用稳定**的值，否则每次 store 变化都重渲染。
- 常用席位：`conversation.input.overlay`（composer 卡片内浮层，纯 UI 首选）/ `conversation.input.left|right` / `conversation.input.dock` / `conversation.chat.node`（keyed）/ `conversation.chat.turnTail` / `conversation.chat.assistant-actions` / `settings.models.provider-card`（keyed）/ `settings.general.item` / `settings.section`。
- ⚠️ **别猜 kind**：整份 Slot 目录（**100 个席位**，带 `kind` / `scope` / `occupants` / `replaceRisk` / `declaredBy` / `source`）就在部署里，读法见 §3.9。实测 `chain` 只有三个：`conversation.composer`、`shell.quota-notice`、`sidebar.right.tab.guide`——**其余都不是独木桥**，`list` 席位新 `id` 就能加条目、`keyed` 席位按 `key` 替换。
- 输入区：composer 是 **contenteditable（Lexical）不是 textarea**，改草稿只能走 `inputActions.setDraft(text)`；键盘拦截配方（document 捕获相 + `[data-composer-card]` 限定作用域 + 避开 IME + 查 `phase === 'plain'` + preventDefault）见 `plugins/prompt-history/src/client/overlay.tsx`。Chat 快照取 `useChat((s) => s.legacy.nodes)`，用户输入是 `kind === 'user' | 'steering'` 节点里的 text 块。
- ✅ **「本轮文件改动」那一行在 `conversation.chat.turnTail`——它是 `list` 席位，不是 chain**（0.2.1 的客户端 Slot 目录里仍是 `list` + `replaceRisk: 'none'`）：官方 `dsh-client-ui-deliverables` 只是**其中一个条目**（`id: '@deepseek-ai/dsh-client-ui-deliverables'`），同席还有 `client-ui-plan PlanCards`、`client-ui-schedule ScheduleTurnCard`。⇒ **想自己加一行，直接 `slots.register({ name: 'conversation.chat.turnTail', id: '<自己的 id>', order }, …)`**——新 `id` 就是新条目，与官方那行并列（复用官方 `id` 才是替换它）。**不要**再为此走 DOM 增补。
- **DOM 增补只在确实没有席位时用**（写法参考 `plugins/turn-file-revert/src/client/augment.ts`）：在 session 作用域 Slot 注册隐藏锚点拿 `sessionId`，再观察转写区把自有元素插到官方产物行之后。稳定判据（**别用哈希类名**）：`[data-turn-tail="<turn>"]`、`[data-chat-turn]`、`[data-actions-reveal]`（只在 `closing !== null` 分支写，值 `endsWithResponse ? "always" : "hover"` → 可当「回合已收尾、动作条已渲染」的判据）、`[data-changed-files]`（官方改动卡片）、`[data-presented-files-row]`（present 的交付文件行）；⚠️ `[data-produced-files-row]` **不存在于任何官方产物**——选任何 DOM 判据前先在部署里 grep 一遍（读法见 §3.9）。
- DOM 增补纪律：自有元素带统一标记属性（如 `data-dsh-tfr`）；`MutationObserver` 忽略自身写入、按判据**幂等重新定位**；先过滤「变更是否落在 turn-tail 子树内」以免流式输出每帧触发；停止时移除全部自有 DOM。

### 3.5 host ↔ client 数据通道

- ⚠️ **不要用 `ctx.connection.rpc.handle(...)`**：它内部拿 `owner = this.ctx`（**不是调用方 ctx**）去 `owner.webServer.register(route)`，真实插件里必抛 `cannot get property "webServer" without inject`（声明 `webServer` 也没用；官方包**零处**用它）。
- ✅ **用 `/api` 下的精确 Fetch 路由**：宿主 `ctx.connection.fetch.register(route)`，`ConnectionFetchRoute` 形状为 `{ path: string（/api 之下的绝对路径）, methods: ('POST'|…)[] , requestBody: 'buffered' | 'streaming', fetch(request) }`，返回 disposer（官方多处使用）；浏览器同源 `fetch('/api/<name>', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })`。信任栅栏与登录 cookie 由物理 `/api` 载体统一处理，插件不必自己鉴权。

### 3.6 宿主侧写文件（沙箱）与可观测性

- ⚠️ `ctx.fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` 的**第 5 参必须传**：`dsh-fs-sandbox/lib/index.js` 的签名就是 5 参，且**按位置**透传（`super.writeText(await this.checkedTarget(target, sandboxPolicy), content, expected, signal)`）——少传等于 `checkedTarget(target, undefined)`，退回「无会话」的部署兜底 workspace root，**连会话工作区内的写回都判越界**。（`dsh-fs-local` 的同名方法只有 4 参，别照它写。）
- 策略口径（与官方 deliverables 相同）：`ctx.sandboxPolicy.resolve({ session })`；它的 `workspaceRoot` 来自**不可变的** `session.header.cwd`（原始项目），不是模型用 `working_directory` 工具切到的当前目录——**沙箱授权不随 `cd` 扩大**。
- ⚠️ **命令的 cwd 与沙箱的 workspace root 是两回事**：终端/文件工具要跟随会话当前目录时用 `ctx.workingDirectory.ensure(agent, signal)`（async）；`session.header.cwd` 只是原始项目。0.2.1 里 `sandboxPolicy.resolve()` 仍按 header cwd 计算 workspace root，别拿它当命令 cwd。
- ⚠️ `read-only` 模式下 `rm` **不经过沙箱**：插件要自己判掉，否则会绕过只读策略删文件。
- 宿主是 Node ESM、改代码必须重启，浏览器侧失败只表现为静默，所以关键动作要**留文件日志**（`os.tmpdir()` 下一行一条），排查时直接读文件。参考 `plugins/git-bash-terminal-tool/src/host/diag.ts`。

### 3.7 设置面：entry Config + volatile

设置 = 插件自己那个 profile entry 的 Config，namespace 就是 **entry id**（bundle patch 里 insert 的 `id`）。可编辑字段必须在导出的 `Config` 里用 `.volatile()` 声明：

```ts
import z from '@deepseek-ai/schemastery'
export const Config = z.object({ preference: z.union(['light', 'dark']).default('light').volatile() })
export function apply(ctx, config) { const value = config.preference.get() }
```

- **`apply` 的第二个参数是解析后的 config**，volatile 字段是**稳定引用**（`Volatile<T>`）：`config.x.get()` 永远是最新值，`settings.update/mutate` 落盘后由 Loader 就地更新（`loader/volatile-update`）→ **不需要 watch、不需要重启**。普通字段仍是启动配置（改了要重挂载）。
- ⚠️ **`Config` 必须是真 schemastery**（依赖声明见 §3.1）：`volatileForm()` 读 `.meta` / `.dict`，`plainSchema()` 还会 `new z(schema.toJSON())`；手写「有 `toJSON` 的 schema」过不了这两步，表现是**设置行在、但读不到值也写不进去，且毫无报错**。
- ⚠️ **schema 表达不了跨字段约束**（如「A 选了 bash 则 B 必须是存在的文件」）：`update/mutate` 只跑 schemastery，不调自定义校验 → 这类校验放在**使用点**（fail safe）。
- **宿主面是 `ctx.settings`**：`describe / update(ns, patch, rev) / replace / mutate(ns, ops, rev) / configure`，**没有 `register`**——插件不注册 namespace，也不要直接写 `$DSH_HOME/settings.yaml`；持久化落在**当前 profile 的 patch**（`configEditor.documentPath`，即 `profiles/<p>/cordis.patch.yml`）。
- **浏览器面是官方的 `ctx.configForms.get(entryId)`**（`dsh-client-ui-settings` 提供）：`ConfigForm` 有 `getSnapshot / subscribe / mutate(ops, rev) / set(field, value) / unset(field)`，均返回 `Promise<boolean>`（false = 宿主拒绝）。⚠️ **不要把设置通道放进 `inject`**：它是可选服务，硬依赖会让条目永远 pending。
- ⚠️ **0.2.1 的 `ConfigFormSnapshot` 没有 `mode` 字段**（原先的 `'host' | 'memory'` 已删除）：可写判定只能用 `snapshot.writable && snapshot.status === 'ready'`；写成 `snapshot.mode === 'host'` 会让整行控件在 0.2.1 上**全部变灰**（本仓库 `git-bash-terminal-tool` 0.5.0 修的就是这个）。家族兼容层 `webUiSettings` 仍会给 `memory`，按可选字段处理（`snapshot.mode !== 'memory'`）。
- 家族兼容层 `webUiSettings`（`@linxin666/dsh-client-ui-web-ui-settings`）**不在官方部署里**，按 namespace bind、契约与旧的 `settingsScope` 同形；优雅做法是「有就用、没有就退回官方 `configForms`」，两条都用 `ctx.get` 判空取。参考 `plugins/git-bash-terminal-tool/src/client/index.ts`。
- 用 `settings.general.item` 槽自建一行时，服务通常晚于本插件激活：用 `ctx.inject([...], () => …)` 等它出现再登记席位（服务晚到时 `ctx.get` 只是 undefined）。
- 验证套路（免浏览器）：部署里 `dsh-settings/lib/types/schema.js` 的 `volatileForm(Config)` 必须返回 object 表单；自测里用**部署里的真件**复核（参考 `plugins/git-bash-terminal-tool/scripts/selftest.mjs`）。

### 3.8 静默失效：名字写错、少 await 都不会报错

cordis 的事件名、服务名、Slot 键、DOM 判据全是裸字符串/属性：**写错不抛错、`tsc` 也过**，只是永远不生效。

| 契约 | 正确写法 | 写错的后果 |
|---|---|---|
| per-agent 初始化事件 | `ctx.on('agent/created', ({agent, source, signal}) => …)`；`@mode serial`，creation resolve 前被 **await**，工具与提示词在这里装完再返回 | 监听器永不触发：设置存下来了，但工具没换 |
| 会话当前目录 | `ctx.workingDirectory.ensure(agent, signal)`（**async**；`get(session)` 只读）；`session.header.cwd` 只是原始项目 | 模型 `cd` 之后命令仍跑在旧目录，终端卡片也显示旧目录 |
| `ctx.sandbox.confine` | **async**，必须 `await` | 拿到 Promise：`argv`/`runnerFailureRules` 全 undefined，真机报 `undefined is not iterable` |
| `ctx.tools.restrict` | 必须在 **agent scope** 调用；名字未知会**抛错**（插件靠这个判断"pwsh 是否已被隐藏"） | 在根 ctx 调用直接抛；写错名字静默无效 |
| `ctx.systemPrompt.section` | 同名 section 会 shadow 外层，空文本被丢弃（用它压掉官方提示词） | 压不掉，模型仍看到旧方言 |
| `jobs.start({ toolCall })` | `{ callId, rootCallId }`；PTC 子调用的 `callId` 不是根调用 | `job/registered` / `job/settled` 无法归位到发起它的工具调用 |

- `jobs.start` 的 `run()` 要求**同步**交回 hooks，而 `confine` 是 async → 要在 `jobs.start` **之前**把受限 argv 解析好（官方 `dsh-pwsh-sandbox` 也是「先 await 再 spawn」）。
- Windows 沙箱已知边界：ACL 沙箱给子进程的是「写受限令牌」，MSYS2 / Git Bash 创建信号管道（`\\.\pipe\`）会被拒（`couldn't create signal pipe, Win32 error 5`）——用官方 pwsh 工具跑 `bash.exe` 同样失败，**不是插件 bug**；Git Bash 要真能跑起来，会话沙箱得是 `danger-full-access`。

### 3.9 权威契约位置（`<dsh>/node_modules/@deepseek-ai/`）

下表路径都相对**完整 CLI 部署**的 `node_modules/@deepseek-ai/`（即头部表里**有 d.ts 的那一行**；桌面运行时那份没有 `.d.ts`，只有运行时产物——核运行时字符串往下看）。有源码 checkout 时优先读 `packages/<domain>/<pkg>/src/*.ts`（权威实现）与 `lib/**`（构建产物），包目录名与下表同名。

| 查什么 | 路径 |
|---|---|
| client 模块系统（boot wire、`__ModuleLoader__` 协议） | `dsh-client-modules/lib/types/client/manifest.d.ts` |
| conversation 系列 Slot / InputState / InputActions / ComposerBar | `dsh-client-ui-conversation/lib/types/client/contract/*.d.ts` |
| Chat 快照 / 键控节点渲染器 / UseChat | `dsh-client-ui-chat/lib/types/client/contract/*.d.ts` |
| 工具事件（`tools/pre-execute` / `post-execute`）、`ToolExecution.rootCallId`、`output.presentationMeta` | `dsh-tools/lib/types/index.d.ts` |
| 会话事件（`session/event`、`tool/call{turn,callId,name,arguments}`、`job/registered` / `job/settled`） | `dsh-session/lib/types/*.d.ts`、`dsh-jobs/lib/types/types.d.ts` |
| agent 事件（`agent/created` / `pre-step` / `disposed`） | `dsh-agent/lib/types/runtime-types.d.ts` |
| **会话当前目录**（`workingDirectory.ensure/get/set`、`working-directory/change`） | `dsh-working-directory/lib/types/index.d.ts`、`dsh-tool-working-directory/lib/types/index.d.ts` |
| 文件服务、沙箱策略、沙箱 provider | `dsh-fs/lib/types/index.d.ts`、`dsh-sandbox-policy/…`、`dsh-sandbox/lib/types/index.d.ts` |
| **设置面**：entry Config / volatile / 表单投影 | `dsh-settings/lib/types/{index,schema}.d.ts`、`schemastery/lib/types/index.d.ts` |
| 客户端设置表单（原生 `configForms`；快照无 `mode`） | `dsh-client-ui-settings/lib/types/client/config-form-types.d.ts` |
| 终端卡片（读 `tool/result.meta.cwd`） | `dsh-client-ui-tool/lib/types/client/tool/models/terminal-card-model.d.ts` |
| 纯 UI 插件模板（空 host apply + dsh.client + overlay） | `dsh-client-ui-input-trigger/{package.json, lib/index.js, lib/client.js}` |
| **Slot 目录**（**100 条**，带 `kind` / `scope` / `occupants` / `replaceRisk` / `declaredBy` / `source`）、以及 Service / Event / Type 目录 | 桌面运行时 `dsh-cordis-client-runner/lib/client.js` 的 `api-catalog`（`SERVICE_API` / `EVENT_API` / `TYPE_API`）与 `slot-catalog` 两段——**生成物别手改**；同一份数据也由会话内 Inspect 与 `docs/cordis-catalog` 提供。**查 Slot 的真实 kind 就查这里，别猜**（§3.4） |

**d.ts 查不到的东西必须去客户端产物里核**：DOM 判据、服务是否真的被 provide、事件是否真的被派发（`lib/client.js` / `lib/client.node.js` 里的字符串）。桌面 0.2.1-rc.1 把 `SlotCore` 打包进 `dsh-client-ui-renderer/lib/client.js`，完整的 `dsh-client-ui-slots` 独立包只在 CLI 部署里；别把渲染层当纯类型包。这类契约**没有任何类型保护**，写错只会静默失效。

**会话内 Inspect**：工具名是 `cordis_inspect_list` / `cordis_inspect_query` / `cordis_inspect_self`（**不是** `cordis_inspect`；`cordis_inspect_*` 的 provider 名与工具名也不一样）。`Slots` provider 只有一个方法 `listSubTree`（内部走 `slots.snapshot(root)`，无参查询可用）；**已知缺陷**：带对象 `input` 的精确查询在 `inspect-registry` 的 `validateInput` 处被拒（`… rejected input: …`，形如 `"input" must be an object`），精确契约改读上表的 d.ts 或目录段。

⚠️ **读客户端产物＝读 asar**（桌面运行时不是真目录，`ls` / `cat` / `rg` 全报「找不到路径」）。asar 格式很简单，`node` 手写十几行即可（**别装 asar 依赖**）：

```js
// 1) 偏移 12 的 u32 = JSON 索引长度；偏移 4 的 u32 = 头部 pickle 的 payload 大小；
// 2) 索引 = 偏移 16 起、该长度的 JSON（递归 files 树）；
// 3) 文件内容起点 = 8 + 偏移 4 的 u32 + Number(entry.offset)；entry.unpacked 的条目没有 offset，跳过。
// ⚠️ 不要用「16 + 索引长度」：JSON 之后还有对齐 padding，照那个公式读会整体错 2 字节
//    （实测读到以 "}\n{" 开头的坏 JSON）。
const fd = require('node:fs').openSync(process.env.LOCALAPPDATA +
  '/Programs/DeepSeek Harness/resources/app.asar', 'r')
```

（本仓库一次性核对就是这么做的：把 `@deepseek-ai/<包>/lib/**` 抽到临时目录再 grep，用完即删——**别把抽出来的产物提交进仓库**。）

## 4. 工具链与环境坑

| 项 | 约定 |
|---|---|
| 语言 | TypeScript（strict、禁 any 滥用），**ESM only**（`"type": "module"`） |
| 运行时 / 包管理 | Node ≥ 22 / **pnpm**（不要混用 npm、yarn） |
| Git | 主分支 `main`；一次 commit 一个主题 |

**构建与检查一律直调，不要走 `pnpm run`**：pnpm 10+ 默认拦截依赖的构建脚本（`ERR_PNPM_IGNORED_BUILDS: esbuild`），随后的 `pnpm run *` 会因依赖状态预检整体失败；esbuild 平台二进制经 optionalDependencies 分发，postinstall 并非必需。（pnpm 11 另：`pnpm` 字段已不再被读取，保留只是兼容旧版。）

```powershell
node build.mjs
node node_modules/typescript/bin/tsc --noEmit
node scripts/selftest.mjs        # 宿主 + 纯逻辑自测
node scripts/clientsmoke.mjs     # 浏览器半区冒烟（有则写）
```

- Windows 下 `node_modules/.bin/*` 是 sh 脚本，**不能** `node .bin/xxx`；TypeScript 走 `node node_modules/typescript/bin/tsc`。
- ⚠️ **移动/改名仓库目录后必须重装依赖**：Windows + pnpm 用**绝对路径 junction**，目录一搬全悬空（`Test-Path` 仍为 True 但取不到内容，报 `Cannot find module ...`）。在每个插件目录重跑 `$env:CI='true'; pnpm install --ignore-scripts --force`（不加 `--force` pnpm 会认为"已是最新"而不修链接），并改掉 DSH profile 里指向本仓库的 `link:` 路径后重装，否则重启 dsh 后 Loader 解析不到插件。

## 5. 开发流程与自测

- 写码前按 §3.9 读真实 d.ts **和客户端产物**核对契约，不要凭记忆猜名字。
- 改完至少跑 `tsc --noEmit` + `node scripts/selftest.mjs`（有 client 半区再加 clientsmoke，有宿主契约再加 compatcheck）；改契约相关代码时**顺带补一条能抓住本次回归的断言**。
- **让自测用真件**：`DSH_STABLE_HOME` 指向完整部署；只有 DSH 源码 checkout 时，用 `DSH_TOOLS_ENTRY` / `DSH_SETTINGS_ENTRY` / `DSH_SCHEMASTERY_ENTRY` 直接指到单包构建产物（源码树里 `packages/core/tools/lib/index.js`、解包后的 `dsh-settings/lib/types/schema.js` 与 `schemastery/lib/index.mjs`）。0.2.1 上已用这套跑过真实的 `assertSupportedJsonSchema` / `validateJsonSchemaValue` / `volatileForm`。
- **防漂移**：有宿主的插件带 `scripts/compatcheck.mjs`（`node scripts/compatcheck.mjs --fetch <版本> …`），拿官方产物逐条核对事件名 / 方法签名 / 服务形状；自测里**必须**对事件名等裸字符串有断言——裸字符串等于没测。契约分**硬**与**可选**两类：插件对缺失有明确降级路径的写成 `optional: true`（只告警、不计 failed），否则「最低支持版本」上会整片红——例如 `git-bash-terminal-tool` 的 `jobs.wait/read/kill/remove` 是 0.2.x 才齐的「超时转后台」能力，缺了就退回「超时即杀」。
- 快速预览交互可用会话内动态 Cordis 插件（`cordis_define` / `cordis_run` / `cordis_undefine`），但落地交付一律以本仓库的 TS 包为准，**两者不要同时挂同一 Slot**。
- 核对 client 半区是否进了启动图（免浏览器）：用只含 Host 半区的动态插件注册工具返回 `ctx.get('clientModules').graph().entries` 与 `clientPath('<包名>')`；动态沙箱**不允许**读 `connection` 这类返回 cordis Context 的服务。

## 6. 发布：一律走 CI，为对应插件打 tag

维护中的插件各自独立发版，版本号在 `plugins/<name>/package.json`。⚠️ `scripts.prepack` 是 **`npm run build`**（`scripts.build` = `node build.mjs`，另有 `watch` / `check`），**不是** `prepack: node build.mjs`——`prepack` 会自动重建 `lib/`，所以发布前不用手动构建。

**规则（强制）**：新增插件或发布新版本时**不要**在本地 `npm publish`，改为打 tag 触发 `.github/workflows/publish.yml`（npm trusted publishing / GitHub OIDC，无需任何 token）。tag 形如 `<插件目录名>/v<版本>`，**版本必须与 `package.json` 逐字一致**；CI 跑 `tsc --noEmit` + `build.mjs` + selftest + clientsmoke（有哪个跑哪个；需要 DSH 部署的门控断言在 CI 上自行跳过）。首次发布某插件可先在 Actions 页 `publish` → Run workflow 选插件 + `dry_run` 验证。`turn-file-revert` 不在此列（见 §2）；本地 `npm publish` 只在 CI 故障时应急，且没有 provenance。

**新增插件还要做**（漏第 2 项 CI 会直接报 `未知插件`）：

1. `plugins/<name>/package.json`：包名 `dsh-tweaks-<name>`、`version`、`prepack: npm run build`（+ `build: node build.mjs`）、`dsh.bundle.patch: ./cordis.patch.yml`、`files` 含 `lib` / `cordis.patch.yml` / `README.md`（照抄现有插件）。
2. `publish.yml` **两处**加插件**目录名**：`workflow_dispatch.inputs.plugin.options` 与 `jobs.publish` 里 `case "$plugin" in` 的白名单。
3. npmjs.com 上给**这个包**配一次 trusted publishing（npm 按包授权，每个包各配一次）：Provider `GitHub Actions` / Repository `converk/dsh-tweaks` / Workflow name `publish.yml` / Environment 留空 / Allowed actions `npm publish`；配好后可删掉旧的 npm token。
