# 上架 DSH 插件市场（awesome-dsh-plugin）

本目录是**投稿材料的本地副本**，用于提交到 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
（[站点](https://awesome-dsh-plugin.com)，规范见仓库里的 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）。
`dshmarket` 插件每次打开都实时拉取 `plugins.json`，所以**条目合并后自动出现在市场里**，无需再操作。

## 1. 这次要提交的东西

**状态**：插件市场当前收录本仓库 **2 个插件**（prompt-history / git-bash-terminal-tool）——
`prompt-history` 于 2026-09-11 经 PR [#4862](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4862)；
`git-bash-terminal-tool` 于 2026-09-18 经独立 PR
[#5040](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5040)（已 merge，见上游
`data/plugins/converk__dsh-tweaks--plugins-git-bash-terminal-tool.yml`）。
`turn-file-revert`（2026-09 停维护，能力被 DSH 0.2.x 内置）与
`model-capabilities`（2026-10 停维护，DSH 0.2.1 官方已原生提供同类控件）的市场条目都已于 2026-10 下架移除。
**smart-list** 于 2026-10-17 提交 PR [#7740](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7740)（单条目的独立 PR，待维护者合并；npm 已发布 0.1.0）。
**因此日常发版（改代码 → 打 tag 走 CI，见 `AGENTS.md` §6）不需要再提 PR**：条目里没有版本字段，市场按
`repository.url` + `repository.directory` 关联 npm，自动展示最新版本与下载量。
只有**改条目元数据**（描述 / 分类）或**新增插件**才需要新开 PR。
条目文件路径固定为 `data/plugins/<owner>__<repo>--<子路径把 / 换成 ->.yml`：

| 本目录下的文件 | 拷贝到目标仓库的路径 |
|---|---|
| `data/plugins/converk__dsh-tweaks--plugins-prompt-history.yml` | `data/plugins/converk__dsh-tweaks--plugins-prompt-history.yml` |
| `data/plugins/converk__dsh-tweaks--plugins-git-bash-terminal-tool.yml` | `data/plugins/converk__dsh-tweaks--plugins-git-bash-terminal-tool.yml`（已合并；npm 现为 0.5.0） |
| `data/plugins/converk__dsh-tweaks--plugins-smart-list.yml` | `data/plugins/converk__dsh-tweaks--plugins-smart-list.yml`（PR #7740 待合并；npm 现为 0.1.0） |

一个 PR **最多 3 条**：现存 3 个条目（2 个已合并 + smart-list 待合并）；以后若再新增插件导致超过 3 条，需拆成多个 PR（规范也建议"只提你愿意留下的那几个"）。已停维护的 `model-capabilities` / `turn-file-revert` 不再出现在本目录。

## 2. 前置条件（逐条核对）

| 条件 | 状态 |
|---|---|
| 每个 `package.json` 声明 `dsh.bundle` + 仓库根有 `cordis.patch.yml` | ✅ 上架的三个都有（prompt-history / git-bash-terminal-tool / smart-list） |
| 仓库有真实可用代码 | ✅ |
| 三个包声明 `files` / `repository` / `engines`，且不是 `private` | ✅ |
| npm 包已发布 | ✅ 五个 npm 包均已上线（`dsh-tweaks-prompt-history` 0.1.1 / `-git-bash-terminal-tool` 0.5.0 / `-smart-list` 0.1.0；`-model-capabilities` 0.1.1 与 `-turn-file-revert` 0.1.1 均已停维护、从市场移除）；上架的三个均需 DSH ≥ 0.2.0 |
| 仓库加 `dsh-plugin` topic | ✅ 已加（2026-10 核对 GitHub topics 里有 `dsh-plugin`） |
| 仓库创建满 1 天 | ✅ 首个提交 2026-09-10，2026-10 提交时早已满足 |
| 描述与代码相符、无营销词 | ✅ 已按代码核对（smart-list 的描述只讲 Shift+Enter 续号行为） |

## 3. 提 PR 的步骤

先在 GitHub 上 **fork** `awesome-dsh-plugin/awesome-dsh-plugin`，然后：

```powershell
cd $env:TEMP
git clone https://github.com/converk/awesome-dsh-plugin.git awesome-dsh-plugin-fork
Copy-Item -Recurse -Force "<本仓库>\market\data" "awesome-dsh-plugin-fork\"
cd awesome-dsh-plugin-fork
git checkout -b add-converk-dsh-tweaks
git add data/plugins/converk__dsh-tweaks--plugins-*.yml
git commit -m "Add converk/dsh-tweaks plugins: prompt-history, git-bash-terminal-tool, smart-list"
git push -u origin add-converk-dsh-tweaks
```

然后在 GitHub 上开 PR。CI 会依次检查：条目数量（≤3）→ `dsh.bundle` → 仓库年龄 → `awesome-lint`/站点构建。
失败时按提示在同一分支补提交即可，不用重开 PR。

> 不要手工编辑仓库里的 README——那两个 README 由 `data/plugins/*.yml` 生成，改了会被 CI 打回。

### 删除条目（下架）

已停维护 / 能力被官方内置的插件按下架处理（本仓库 `turn-file-revert` 于 2026-09 停维护、`model-capabilities` 于 2026-10 停维护，条目均在 2026-10 这样移除）：

```powershell
cd awesome-dsh-plugin-fork
git fetch upstream main
git checkout -B remove-<插件名> upstream/main
git rm data/plugins/converk__dsh-tweaks--plugins-<插件名>.yml
git commit -m "Remove retired <插件名> plugin from converk/dsh-tweaks"
git push -u origin remove-<插件名>
```

然后在 GitHub 开 PR，说明停维护原因（能力已被官方内置）。下架**只删市场条目**：本仓库源码与 npm 包保留，已安装的用户不受影响。

> ⚠️ 本目录只是投稿材料副本：**删除本目录下的 yml 不会让市场下架**，必须按上面的步骤向上游 awesome-dsh-plugin 提删除条目的 PR。

## 4. 发布 npm 包（打 tag 走 CI，trusted publishing）

**当前状态：五个 npm 包均已发布上线**（`git-bash-terminal-tool` 0.5.0、`prompt-history` 0.1.1、`smart-list` 0.1.0；`model-capabilities` 0.1.1 与 `turn-file-revert` 0.1.1 均已停维护最后版本、从市场移除）；市场条目已合并两个（prompt-history / git-bash-terminal-tool）、smart-list 在 PR #7740 待合并，本仓库的 `repository` 字段（含 `directory`）也已进入 registry 元数据，市场会自动关联。

发布**不要本地 `npm publish`**，一律走 `.github/workflows/publish.yml`（npm trusted publishing / GitHub OIDC，无需 token，带 provenance）。每个包需在 npmjs.com 各配一次 trusted publisher（Provider GitHub Actions / Repository `converk/dsh-tweaks` / Workflow name `publish.yml` / Environment 留空 / Allowed actions npm publish）。发版步骤：

```powershell
# tag 形如 <插件目录名>/v<版本>，版本必须与 package.json 逐字一致
git tag -a <插件目录名>/v<版本> -m "dsh-tweaks-<name> <版本>"
git push origin <插件目录名>/v<版本>
```

- 推 tag 后 CI 会跑 `tsc --noEmit` + `build.mjs` + selftest/clientsmoke，再 `npm publish --provenance`；tag 与 package.json 版本不一致会直接失败。
- 首次发布某插件可先在 Actions 页 `publish` → Run workflow 选插件 + `dry_run` 验证。
- ⚠️ **全新 npm 包名的首次发布**：npm 不支持给「还没发布过的包名」预先配置 trusted publisher。先用本地交互式 `npm publish --access public` 完成首次发布（带 2FA；2026-10 起 npm 默认走 staged publishing：会先生成 `0.0.0-stage` 占位，再按提示 Approve 真实版本），然后 `npm trust github <包名> --file publish.yml --repo converk/dsh-tweaks --allow-publish -y` 配置 OIDC，之后新版本才能靠 tag 触发 CI 自动发布。smart-list 的 0.1.0 就是这样发出去的。

- 发布后市场会**自动关联**：`repository.url` + `repository.directory` 会被拼成
  `converk/dsh-tweaks#path:/plugins/<name>`，正好对上条目的 `/tree/` 地址，于是详情页显示 npm 名与下载量。
- **不要**在条目 YAML 里手写 `npm:` 字段——规范明确说会被校验拒绝。
- 装了预构建包的用户不需要 `allowBuilds` 构建授权（这正是发 npm 的意义）。
- 发布顺序建议：**先发 npm，再提 PR**（这样市场一收录就带下载量）。

## 5. 合并之后

- 网站自动重建，`dshmarket` 里出现已合并的条目（当前 prompt-history / git-bash-terminal-tool 两个，smart-list 合并后再加一个）；安装命令会长成
  `dsh plugin --profile web add dsh-tweaks-<name>`（npm 生效后）。
- 市场详情页会展示 `plugins/<name>/screenshots.json` 里声明的截图（已配好，指向 GitHub 托管的绝对 URL）。
  想换图：更新 `docs/images/` 里的同名 PNG 推上来即可，下一次构建生效，不用再提 PR。
- 条目数据要改（描述/分类），改的是**目标仓库**里你自己那个 yml，而不是生成出来的 README。

## 6. 后续发版

改完代码 → 提交推送 → 按 `AGENTS.md` §6 打 `<插件目录名>/v<版本>` tag 并推 origin（CI trusted publishing 自动发布，`prepack` 会重建 `lib/`）；版本号与 tag 必须逐字一致。
