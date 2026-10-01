# dsh-tweaks-turn-file-revert

每轮对话改完文件后，在回合末尾多给一行统计，并提供「一键撤回 / 重新应用」。

> **⚠️ 已停止维护（2026-09）**：该能力官方 DSH 0.2.x 已内置（回合改动卡片 + 逐文件 diff 复核），
> 本插件不再随 DSH 版本迭代。**最后一个支持的 DSH 版本是 `0.2.0`** —— 之后的版本更迭、
> 契约审计、CI 与发布都**忽略本插件**（规则见 [AGENTS.md §2](../../AGENTS.md)）。
> 版本号停在 `0.1.1`，不再发版；源码保留只作参考。

## 它能做什么

- 这一轮总共 **加了多少行、删了多少行**，改了 **几个文件**；
- 一个 **「撤回全部修改」** 按钮：把这一轮改过的文件一次性还原成改动前的内容；
- 撤回之后按钮会变成 **「重新应用修改」**，再点一下就把改动原样写回去——反悔了不用重新让模型改一遍。

补出来的一行长这样：

    本轮改动情况：+52 行 −7 行    3 个文件    [撤回全部修改]

> 只要这一轮有文件改动就会出现，**不要求官方那行「本轮文件改动」也在**：模型在 `run_code` 里改文件时官方不会列，本插件照样统计。

## 怎么用

1. 等一轮"改过文件"的对话结束。
2. 在回合末尾找到插件补的那一行。
3. 点 **「撤回全部修改」** → 文件回到这一轮开始前的内容，按钮变成「重新应用修改」，并提示「已撤回本回合修改」。
4. 想反悔，就再点 **「重新应用修改」**。

> **只有本会话最后一次对话能撤回 / 重新应用。** 更早回合的按钮是灰的，鼠标移上去提示「该轮对话改动现在不支持撤回/恢复」，点了也不会执行——免得把后面几轮已经改好的结果覆盖回去。发出新一轮对话后，上一轮的按钮会自动变灰。

**① 本轮有改动 —— 统计 + 可点的「撤回全部修改」**

![本轮有改动：本轮改动情况 +52 行 −7 行、3 个文件，「撤回全部修改」可点](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/turn-file-revert-modified.png)

**② 点了「撤回全部修改」—— 按钮变成「重新应用修改」**

![撤回后：按钮变为「重新应用修改」，右侧提示「已撤回本回合修改」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/turn-file-revert-reverted.png)

**③ 更早的回合 —— 按钮置灰，鼠标移上去给提示**

![非最后一次对话：按钮置灰不可点，hover 提示「该轮对话改动现在不支持撤回/恢复」](https://raw.githubusercontent.com/converk/dsh-tweaks/main/docs/images/turn-file-revert-latest-only.png)

## 说明

- 只统计 / 撤回**模型通过文件工具改的内容**（`write` / `edit` / `str_replace_editor`，新建、修改都算）——直接调的、在 `run_code` 里调的都算；你自己在终端或编辑器里改的文件不在这一行里。
- 撤回是**整轮一起撤**，不能只撤其中某个文件。
- 撤回以插件记录的**「改动前内容」**为准直接写回；磁盘上如果已经和记录不一致（比如你手动改过），它**仍然会覆盖**，并在结果里标出「覆盖了 N 个已被改动的文件」。
- 鼠标停在那一行上，可以看到这一轮每个文件的 +/− 明细。
- **重启 DSH 之后**，之前回合的记录会丢：那些回合不会再显示这一行，也撤不了。
- 只读模式（read-only 沙箱）下拒绝写回，也不会删除本回合新建的文件。

## DSH 兼容性（本次审计）

> 本插件已弃用并**停止维护**（功能由官方回合改动卡片 + 逐文件 diff 接管），且**不在任何 profile 的
> bundles 里**；下面的结论是「若仍有人安装，它在 0.1.7 / 0.2.0 上是否还能用」。
> **支持到 0.2.0 为止**，之后的 DSH 版本不再核对、不再修。

**最低支持 DSH 0.1.7。** 本次审计实际对照的官方产物：

| 版本 | 部署路径（`@deepseek-ai` 所在层） | 结论 |
|---|---|---|
| 0.1.7-rc.2 | `D:\env\node-global\dsh-017-rc2\node_modules\@deepseek-ai` | 下面每条契约逐个核对，全部未变 |
| 0.2.0-rc.2 | `D:\env\node-global\dsh-stable\node_modules\@deepseek-ai` | 同上（任务书写的 0.2.0-rc.1，实测本机部署是 **-rc.2**，以实际产物为准） |

核对方式：对两份完整安装按文件做 SHA-256 比对 + 逐条读 d.ts 原文 + 全文扫描官方客户端产物
（`*.js`/`*.mjs`/`*.css`，各约 43 MB / 1050 个文件）。下面每条都注明官方文件与行号；
**两份部署里这些行号完全相同**（同名文件的 hash 也相同，`dsh-session/lib/index.js` 除外——
差异只在 crash/fork 修复逻辑，不在事件通道）。

| 契约（本插件用到的） | 官方声明原文位置 | 结论 |
|---|---|---|
| `session/event (session, event)`，`@mode emit` | `dsh-session/lib/types/index.d.ts:64` | 逐字未变 |
| `agent/pre-step (payload, next)`，payload 带 `turn`，`@mode waterfall`，必须自己 `return next()` | `dsh-agent/lib/types/runtime-types.d.ts:304-310` | 逐字未变（文件 hash 相同） |
| `tools/pre-execute (exec, next)` / `tools/post-execute (exec, result, next)`，waterfall | `dsh-tools/lib/types/index.d.ts:47,70` | 文件 hash 相同 |
| `ToolExecution` 的 `callId/name/arguments/agent/signal`；结果用 `isError` 判失败 | `dsh-tools/lib/types/index.d.ts:216,425` | 未变 |
| `tool/call` 事件载荷带 `turn` + `callId`（回合归属的权威来源） | `dsh-session/lib/types/types.d.ts:354` | 未变（文件 hash 相同） |
| `ctx.fs.resolve/stat/readText/processPath/contains`；`writeText(target, content, expected, signal, sandboxPolicy)` | `dsh-fs/lib/types/index.d.ts:221` | 文件 hash 相同；第 5 参仍可选，但 `workspace-write` 下必须传（否则退回部署兜底 root） |
| `ctx.sandboxPolicy.resolve({ session })` → `mode` / `workspaceRoot` / `sessionId` | `dsh-sandbox-policy/lib/types/index.d.ts:88`、`dsh-sandbox/lib/types/index.d.ts:27` | 未变 |
| `ctx.connection.rpc.handle` / `ctx.connection.fetch.register`（宿主） | `dsh-client-connection/lib/types/rpc.d.ts:122,131` | 文件 hash 相同；`handle()` 仍拿**服务自己的 ctx** 去 `webServer.register`（`lib/index.js`），所以插件保留 `/api` 精确 Fetch 兜底，两条路都注册 |
| 浏览器 `connection.rpc.call(channel, endpoint, payload)` | `dsh-client-connection`（整个包只有 `package.json` 有版本号差异） | 未变 |
| `conversation.input.overlay`（`list` / `session`）+ session 槽注入 `sessionId` | `dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts:220`、`dsh-client-ui-slots/lib/types/index.d.ts:483` | 未变 |
| `locale.register(ns, lang, dict)` / `locale.bind(ns)` | `dsh-client-locale/lib/types/client/index.d.ts:209` | 未变（整个包只有版本号差异） |
| DOM 判据 `[data-turn-tail]`、`[data-actions-reveal]` | `dsh-client-ui-chat/lib/client.js` | 两份产物都有；两版本之间的 diff 没有碰到这两行 |
| DOM 判据 `[data-changed-files]`（本次修复） | `dsh-client-ui-deliverables/lib/client.js` | 两份产物都有 |

### 0.1.1 —— 「紧跟官方产物行」从来没生效过（0.1.7 起就存在，不是 0.2.0 的回归）

- **症状**：补出来的那一行照样显示，但位置总是回落到「回合末尾、动作条之前」，而不是紧跟在官方
  「已编辑 N 个文件」卡片之后；官方同时渲染「交付文件」行时会显得夹在官方两块内容之间。
- **根因**：`src/client/augment.ts` 的产物行选择器写成 `[data-produced-files-row]`。该属性名在
  0.1.7-rc.2 与 0.2.0-rc.2 **所有**官方 js/css 里都不存在（全量扫描 0 命中）：官方这一行是
  `data-changed-files`；另有 `data-presented-files-row`，那是 `present` 工具的「交付文件」行。
  于是「插到官方产物行之后」整条分支是死代码，每次都走兜底插入点（当时的兜底只在已收尾回合
  成立，流式中的回合还会把自有行插到官方改动卡片**上方**）。
  > 仓库 `AGENTS.md` §3.4 已收录该结论：`[data-produced-files-row]` **不存在于任何官方产物**，
  > 官方那一行是 `[data-changed-files]`。
- **修法**（`src/client/augment.ts`）：① 选择器改为 `[data-changed-files]`；② 插入点优先级改为
  「已收尾（尾部带 `data-actions-reveal`）→ 动作条之前 = 官方全部内容之后；流式中 → 官方改动行
  之后，其次最后一个非自有元素之后」，避免把自有行插到官方改动卡片与交付文件行**之间**；
  ③ 插入点暂时算不出时只跳过重定位，不再把已在屏幕上的自有行当「回合消失」删掉。
- **影响范围**：该插件未装进任何 profile，本次改动不影响正在运行的 DSH；若要重新启用，请先跑
  下面的自测。

### 未受类型保护的脆弱点（重要）

- 事件名 / 服务名 / 方法签名 / Slot 键都在官方 d.ts 里，写错至少能靠契约复核发现；但
  DOM 判据（`data-turn-tail` / `data-actions-reveal` / `data-changed-files`）**只存在于官方
  客户端产物里**，`tsc` 永远查不出来，官方改一个属性名就会静默失效（这一行不显示或位置错）。
- 缓解：`scripts/clientsmoke.mjs` 现在会在提供 `DSH_STABLE_HOME` / `DSH_017_HOME` 时，全量扫描
  官方产物复核这组判据（含「旧写法 `data-produced-files-row` 必须 0 命中」的反向断言）；
  `scripts/selftest.mjs` 同样在提供这两个环境变量时逐条复核上表的宿主契约。

```powershell
# 带官方产物复核地跑自测（两个变量可只给一个）
$env:DSH_STABLE_HOME = "D:\env\node-global\dsh-stable"
$env:DSH_017_HOME = "D:\env\node-global\dsh-017-rc2"
node scripts/selftest.mjs
node scripts/clientsmoke.mjs
```

## 安装

```powershell
npx @deepseek-ai/dsh plugin --profile web add "D:\你的目录\dsh-tweaks\plugins\turn-file-revert"
```

重启 DSH，并在浏览器中强制刷新（`Ctrl + Shift + R`）。

> 本插件含宿主半区，必须重启 DSH 后生效。
> `web` 为 DSH 的 profile 名称，可在 `C:\Users\你的用户名\.dsh\profiles\` 下确认。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
