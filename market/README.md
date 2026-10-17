# 上架 DSH 插件市场（awesome-dsh-plugin）

本目录是**投稿材料的本地副本**（上游 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) `data/plugins/` 下同名条目的副本）
（[站点](https://awesome-dsh-plugin.com)，规范见仓库里的 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）。
`dshmarket` 插件每次打开都实时拉取 `plugins.json`，所以**条目合并后自动出现在市场里**，无需再操作。

条目文件路径固定为 `data/plugins/<owner>__<repo>--<子路径把 / 换成 ->.yml`。**日常发版不需要再开 PR**：
条目里没有版本字段，市场按 `repository.url` + `repository.directory` 自动关联 npm，自动展示最新版本与下载量；
只有**改条目元数据**（描述 / 分类）或**新增插件**才需要新开 PR。正式发版流程见 [AGENTS.md](../AGENTS.md) §6。

## 条目路径规则

本目录下维护中的插件各一条，拷贝到目标仓库的路径与本地文件名相同：

| 本目录文件 | 目标仓库路径 |
|---|---|
| `data/plugins/converk__dsh-tweaks--plugins-prompt-history.yml` | 同名 |
| `data/plugins/converk__dsh-tweaks--plugins-git-bash-terminal-tool.yml` | 同名 |
| `data/plugins/converk__dsh-tweaks--plugins-smart-list.yml` | 同名 |

已停维护的插件不再出现在本目录，也不要再加回。

## 新增 / 修改元数据：开 PR

一个 PR **最多 3 条**条目（规范也建议「只提你愿意留下的那几个」）；条目数超过 3 时拆成多个 PR。
提交前逐条自检：

- 每个 `package.json` 声明 `dsh.bundle`，且 bundle 自带 `cordis.patch.yml`；
- 仓库有真实可用代码；包声明 `files` / `repository` / `engines`，且不是 `private`；
- npm 包可用（`npm view dsh-tweaks-<name> version` 有输出；上架条目需 DSH ≥ 0.2.0）；
- 仓库加了 `dsh-plugin` topic；仓库创建满足市场要求（≥ 1 天）；
- 描述与代码相符、无营销词。

步骤（先在 GitHub 上 fork 上游仓库）：

```powershell
git clone https://github.com/<你的账号>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
Copy-Item -Recurse -Force "<仓库目录>\market\data" "."
git checkout -b add-converk-dsh-tweaks
git add data/plugins/converk__dsh-tweaks--plugins-*.yml
git commit -m "Add converk/dsh-tweaks plugins"
git push -u origin add-converk-dsh-tweaks
```

然后在 GitHub 上开 PR。CI 会依次检查条目数量（≤3）→ `dsh.bundle` → 仓库年龄 →
`awesome-lint` / 站点构建；失败时按提示在同一分支补提交即可，不用重开 PR。

> - **不要**手工编辑上游仓库里的 README——它由 `data/plugins/*.yml` 生成，改了会被 CI 打回；
> - **不要**在条目 YAML 里手写 `npm:` 字段——规范明确说会被校验拒绝；
> - 市场详情页展示 `plugins/<name>/screenshots.json` 声明的截图（指向 GitHub 托管的绝对 URL）；
>   换图只需更新 `docs/images/` 里的同名 PNG，下一次构建生效，不用再提 PR。

## 删除条目（下架）

已停维护 / 能力被官方内置的插件按下架处理（只删市场条目：本仓库源码与 npm 包保留，已安装用户不受影响）：

```powershell
git fetch upstream main
git checkout -B remove-<插件名> upstream/main
git rm data/plugins/converk__dsh-tweaks--plugins-<插件名>.yml
git commit -m "Remove retired <插件名> plugin from converk/dsh-tweaks"
git push -u origin remove-<插件名>
```

然后在 GitHub 开 PR，说明停维护原因（例如能力已被官方内置）。

> ⚠️ 本目录只是投稿材料副本：**删除本目录下的 yml 不会让市场下架**，必须按上面的步骤向上游 awesome-dsh-plugin 提删除条目的 PR。
