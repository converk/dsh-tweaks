# AGENTS.md

本文件写**在这个仓库里开发 DSH 插件时的注意事项与踩坑经验**；项目介绍见 [README.md](./README.md)。

下面的 DSH 事实基于 **0.1.5-rc.1** 实测，换 DSH 版本后请按 §2.7 重新核对，
**禁止凭记忆猜 Service / Slot / prop 名字**。

> **文中 `<dsh>` 指 DSH 的部署目录**，也就是 `node_modules/@deepseek-ai/` 所在的那一层。
> 不确定在哪，可以看 `$DSH_HOME`（默认 `~/.dsh`）下的启动脚本，或从正在运行的 `dsh` 进程命令行反查。

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

## 2. DSH 契约与坑

### 2.1 cordis 组合层与挂载

- 一切皆插件；row = `{ id, name, config, inject, disabled }`，插件之间靠服务协作，不互相 import。
- 读**可选**服务用 `ctx.get('x')` 并判空；**确为硬依赖**才 `inject: ['x']` 并用 `ctx.x`——
  未声明就用 `ctx.x` 会被 Guard 拒：`cannot get property "x" without inject`。
- patch 层叠顺序：bundle 自带 patch → profile 的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`。
  `- id: x` 形式**替换目标 row 的整个 config**（覆盖官方 row 要重述所有关心的键）；追加新 row 用 insert 形制。
- 装/挂插件：`dsh plugin --profile <p> add <pkg>`，再在 profile patch 里加 insert 列表
  （**裸 `- name:` 会被跳过**并 warn `patch: id is required for non-insert patches`）：
  ```yaml
  - insert:
      - id: <短 id>
        name: dsh-tweaks-<name>
  ```
- ⚠️ **运行中插入的 row 只进组合树，宿主半区的 `apply` 不会执行**（client bundle 会进启动图、
  浏览器也会真的加载它）。→ **双面插件首次挂载必须先重启一次 dsh**，再刷新浏览器。
- 判断宿主半区到底挂上没有（不用浏览器）：未登录 `POST http://127.0.0.1:<port>/<channel>/<endpoint>`
  → **401 = 路由已注册**（被信任栅栏拦下），405 = 没注册。注意 `/api` 前缀下**任何**路径都会被栅栏拦成 401，
  所以基准要拿一个非 `/api` 的未知路径（405）来对照。

### 2.2 双面插件与 client bundle 协议

- `package.json` 声明 `dsh.client.platform = 'web'`；**host 半区** = `main` 导出的 `apply(ctx)`
  （纯 UI 插件就是空 apply，只用于在宿主组合树里占位）；**client 半区** = `exports["./client"]`
  指向的**已构建** bundle。
- bundle 必须是**经典脚本**（非 ESM），自注册工厂：
  `window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {…} })`，工厂体为 CJS，
  只允许 `require` 页面种子模块（**`react` / `react/jsx-runtime`**），并**必须带 sourcemap trailer**
  （`//# sourceMappingURL=client.js.map`，合法 v3）。构建照抄本仓库 `plugins/prompt-history/build.mjs`。
- 页面 React 是 **18**（`@types/react ~18.3`，别引 React 19 类型）。
- ⚠️ client 半区**必须 `export const inject = [...]` 声明用到的服务**（如 `slots`、`locale`）：
  入口插件没有 inject 会立刻激活，此时 `slots` 可能还没被 ui-renderer 提供，插件会**静默什么都不注册**。
  （这个坑真踩过：`prompt-history` 最初漏了 `inject`，表现就是"装上了但按 ↑ 没反应"，日志无任何报错。）
- client 侧改动要构建监视才热重载；**宿主侧改代码必须重启 dsh**（Node ESM 缓存，Loader 用同一条说明符 `import()`）。

### 2.3 Slot 与浏览器 UI 扩展点

- 四种 kind：`single`（整体替换，多数 `shadows-shipped-ui`，慎用）/ `list`（追加条目，**新 id 即新增**）/
  `keyed`（按 key 替换，如 `conversation.chat.node` 按 ChatNodeKind）/ `chain`
  （**独木桥**：按优先级取第一个接受 owner 的注册项就 break，官方已占的 chain 抢不到）。
- 注册：`slots.inject(key, () => slots.register({ name, id, order }, (props) => el))`；
  `inject` 等 Slot 声明方挂载后再注册，disposer 由注入回调原样交还，停止/更新自动移除。
- session 作用域 Slot 会注入标准 props（按需判空）：`sessionId`、`useChat`、`useSession`、`useInput`、
  `inputActions`、`useProjection`…；选择器要返回**引用稳定**的值，否则每次 store 变化都重渲染。
- 常用席位：`conversation.input.overlay`（composer 卡片内浮层，纯 UI 首选）/ `conversation.input.left|right` /
  `conversation.input.dock` / `conversation.chat.node`（keyed）/ `settings.general.item` / `settings.section`。
- 输入区契约：composer 是 **contenteditable（Lexical）不是 textarea**，改草稿只能走 `inputActions.setDraft(text)`；
  键盘拦截配方（document 捕获相 + `[data-composer-card]` 限定作用域 + 避开 IME + 查 `phase === 'plain'` +
  preventDefault）见 `plugins/prompt-history/src/client/overlay.tsx`。Chat 快照取 `useChat((s) => s.legacy.nodes)`，
  用户输入是 `kind === 'user' | 'steering'` 节点里的 text 块。
- ⚠️ 「本轮文件改动」那一行在 **chain 席位 `conversation.chat.turnTail`**（官方 `dsh-client-ui-deliverables` 占据），
  插件抢不到；想在它之后加内容只能走 **DOM 增补**（参考 `plugins/turn-file-revert/src/client/augment.ts`）：
  在 session 作用域 Slot 注册隐藏锚点拿 `sessionId`，再观察转写区把自有元素插到官方产物行之后。
  稳定判据（**别用哈希类名**）：`[data-turn-tail="<turn>"]`（值 = 回合号）、`[data-produced-files-row]`、
  `[data-chat-turn]`。纪律：自有元素带统一标记属性（如 `data-dsh-tfr`）；`MutationObserver` 忽略自身写入、
  按判据**幂等重新定位**；先过滤「变更是否落在 turn-tail 子树内」以免流式输出每帧触发；停止时移除全部自有 DOM。

### 2.4 host ↔ client 数据通道

- ⚠️ **不要用 `ctx.connection.rpc.handle(...)`**：它内部拿 `owner = this.ctx`（**不是调用方 ctx**）去
  `owner.webServer.register(route)`，真实插件里必抛
  `cannot get property "webServer" without inject`（声明 `webServer` 也没用；官方包无一处用它）。
- ✅ **用 `/api` 下的精确 Fetch 路由**：
  宿主 `ctx.connection.fetch.register({ path: '/api/<name>', methods: ['POST'], requestBody: 'buffered', fetch })`
  （只往 connection 自己的路由表塞一条记录，**完全不碰 webServer**）；
  浏览器同源 `fetch('/api/<name>', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload) })`。信任栅栏与登录 cookie 由物理 `/api` 载体统一处理，插件不必自己鉴权。
- 若同时注册了 RPC 通道，客户端应「先试 RPC、传输失败静默回落 fetch」（两条都可用即可用）。

### 2.5 宿主侧写文件（沙箱）

- ⚠️ `ctx.fs.writeText(target, content, expected?, signal?, sandboxPolicy?)` 的**第 5 参必须传**：
  不传时 `dsh-fs-sandbox` 会退回「无会话」的部署兜底 workspace root，**连会话工作区内的写回都判越界**：
  `cannot write "…": file access denied under workspace-write mode`。
- 策略口径（与官方 deliverables 相同）：`ctx.sandboxPolicy.resolve({ session })`；
  workspace root 取 `session.cwd ?? ctx.sandboxPolicy.workspaceRoot`（拿不到 session 时用记录下来的会话 cwd）。
- ⚠️ `read-only` 模式下 `rm` **不经过沙箱**：插件要自己判掉，否则会绕过只读策略删文件。

### 2.6 宿主半区的可观测性

宿主是 Node ESM、改代码必须重启，而浏览器侧失败只表现为静默（界面毫无反应）。所以关键动作要**留文件日志**
（`os.tmpdir()` 下一行一条），排查时直接读文件、不用让用户抄终端。参考 `plugins/turn-file-revert/src/host/diag.ts`。

### 2.7 权威契约位置（`<dsh>/node_modules/@deepseek-ai/`）

下表路径都是相对上面那个目录：

| 查什么 | 路径 |
|---|---|
| client 模块系统（boot wire、`__ModuleLoader__` 协议） | `dsh-client-modules/lib/types/client/manifest.d.ts` |
| conversation 系列 Slot / InputState / InputActions / ComposerBar | `dsh-client-ui-conversation/lib/types/client/contract/*.d.ts` |
| Chat 快照 / 键控节点渲染器 / UseChat | `dsh-client-ui-chat/lib/types/client/contract/*.d.ts` |
| 工具事件（`tools/pre-execute` / `post-execute`）、ToolExecution | `dsh-tools/lib/types/index.d.ts` |
| 会话事件（`session/event`、`tool/call{turn,callId,name,arguments}`） | `dsh-session/lib/types/*.d.ts` |
| 文件服务、沙箱策略 | `dsh-fs/lib/types/index.d.ts`、`dsh-sandbox-policy/lib/types/index.d.ts` |
| 纯 UI 插件模板（空 host apply + dsh.client + overlay） | `dsh-client-ui-input-trigger/{package.json, lib/index.js, lib/client.js}` |

类型-only 的包（`dsh-client-ui-slots` 等）在部署里**没有运行时目录**：对契约做**结构性窄化投影**
（见各插件 `src/**/types.ts`），不要 import 它们。
会话内 Inspect（`Slots.listSubTree` 等）无参查询可用；**已知缺陷**：带对象 `input` 的精确查询报
`"input" must be an object`，精确契约改读上表的 d.ts。

### 2.8 依赖白名单

只允许 DSH 官方运行时（`@deepseek-ai/dsh*`、`@deepseek-ai/cordis`、`cosmokit`、`schemastery` 等）
与将来本仓库的 `commons/` 基座；引入其他第三方 npm 包必须先给出理由。包名一律 `dsh-tweaks-<name>`，
禁止使用 `@deepseek-ai` 作为本仓库包 scope。
实践基准：**纯 UI 插件可以做到运行时零依赖**——react 来自页面种子模块，DSH 契约用类型投影，
构建期工具链（esbuild、typescript、@types/react）全部放 devDependencies。

## 3. 插件独立性（强制）

- 插件 A **不得** import / 依赖 / 探测插件 B 的任何代码、导出、服务名、配置键或文件；
  不允许「共享常量文件」「共享 utils」这类隐式耦合。
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
├── README.md        # 面向用户：功能 / 怎么用 / 安装 / 效果图
├── scripts/*.mjs    # selftest（宿主 + 纯逻辑）、clientsmoke（bundle 协议 + apply）
└── src/
    ├── index.ts     # host 半区（纯 UI 插件 = 空 apply）
    ├── host/        # 宿主侧：服务、事件监听、RPC/Fetch 路由、诊断日志
    ├── shared/      # host/client 共用纯逻辑（无 node / DOM / React 依赖）
    └── client/      # 浏览器半区：Slot 注册 + 组件 + 类型投影
```

契约细节与踩坑记在**源码注释**和本文档里，不再单独拆开发文档。

## 6. 开发流程

- 写码前先按 §2.7 读真实 d.ts 核对契约；不要凭记忆猜名字。
- 每个插件自带自测脚本，改完至少跑：`tsc --noEmit` + `node scripts/selftest.mjs`（有 client 半区再加 clientsmoke）。
- 快速预览交互可用会话内动态 Cordis 插件（`cordis_define` + `cordis_run`），
  但落地交付一律以本仓库的 TS 包为准，**两者不要同时挂同一 Slot**。
- 核对 client 半区是否进了启动图（不开浏览器）：用只含 Host 半区的动态插件注册工具，返回
  `ctx.get('clientModules').graph().entries` 与 `clientPath('<包名>')`；
  注意动态沙箱**不允许**读 `connection` 这类返回 cordis Context 的服务。
