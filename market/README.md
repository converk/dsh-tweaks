# 上架 DSH 插件市场（awesome-dsh-plugin）

本目录是**投稿材料的本地副本**，用于提交到 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
（[站点](https://awesome-dsh-plugin.com)，规范见仓库里的 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)）。
`dshmarket` 插件每次打开都实时拉取 `plugins.json`，所以**条目合并后自动出现在市场里**，无需再操作。

## 1. 这次要提交的东西

三个插件 = 三个条目文件，路径固定为 `data/plugins/<owner>__<repo>--<子路径把 / 换成 ->.yml`：

| 本目录下的文件 | 拷贝到目标仓库的路径 |
|---|---|
| `data/plugins/converk__dsh-tweaks--plugins-prompt-history.yml` | `data/plugins/converk__dsh-tweaks--plugins-prompt-history.yml` |
| `data/plugins/converk__dsh-tweaks--plugins-model-capabilities.yml` | `data/plugins/converk__dsh-tweaks--plugins-model-capabilities.yml` |
| `data/plugins/converk__dsh-tweaks--plugins-turn-file-revert.yml` | `data/plugins/converk__dsh-tweaks--plugins-turn-file-revert.yml` |

一个 PR **最多 3 条**，这三个正好占满；规范也建议"只提你愿意留下的那几个"。

## 2. 前置条件（逐条核对）

| 条件 | 状态 |
|---|---|
| 每个 `package.json` 声明 `dsh.bundle` + 仓库根有 `cordis.patch.yml` | ✅ 三个都有 |
| 仓库有真实可用代码 | ✅ |
| 三个包声明 `files` / `repository` / `engines`，且不是 `private` | ✅ |
| npm 包名可用 | ✅ `dsh-tweaks-prompt-history`、`dsh-tweaks-model-capabilities`、`dsh-tweaks-turn-file-revert` 均未被占用 |
| 仓库加 `dsh-plugin` topic | ⬜ **待做**（GitHub 仓库页 → About 齿轮 → Topics） |
| 仓库创建满 1 天 | ⏳ 首个提交是 2026-09-10 18:34，**2026-09-11 18:34 之后**提 PR 才会过 CI |
| 描述与代码相符、无营销词 | ✅ 已按代码核对（描述里的能力/适配器都对得上） |

## 3. 提 PR 的步骤

先在 GitHub 上 **fork** `awesome-dsh-plugin/awesome-dsh-plugin`，然后：

```powershell
cd $env:TEMP
git clone https://github.com/converk/awesome-dsh-plugin.git awesome-dsh-plugin-fork
Copy-Item -Recurse -Force "<本仓库>\market\data" "awesome-dsh-plugin-fork\"
cd awesome-dsh-plugin-fork
git checkout -b add-converk-dsh-tweaks
git add data/plugins/converk__dsh-tweaks--plugins-*.yml
git commit -m "Add converk/dsh-tweaks plugins: prompt-history, model-capabilities, turn-file-revert"
git push -u origin add-converk-dsh-tweaks
```

然后在 GitHub 上开 PR。CI 会依次检查：条目数量（≤3）→ `dsh.bundle` → 仓库年龄 → `awesome-lint`/站点构建。
失败时按提示在同一分支补提交即可，不用重开 PR。

> 不要手工编辑仓库里的 README——那两个 README 由 `data/plugins/*.yml` 生成，改了会被 CI 打回。

## 4. 发布 npm 包（预构建路线）

三个包已经配置好 `prepack: npm run build`，所以**不用手动先构建**：

```powershell
npm login
foreach ($n in @("prompt-history","model-capabilities","turn-file-revert")) {
  Push-Location "<本仓库>\plugins\$n"
  npm publish
  Pop-Location
}
```

- 发布后市场会**自动关联**：`repository.url` + `repository.directory` 会被拼成
  `converk/dsh-tweaks#path:/plugins/<name>`，正好对上条目的 `/tree/` 地址，于是详情页显示 npm 名与下载量。
- **不要**在条目 YAML 里手写 `npm:` 字段——规范明确说会被校验拒绝。
- 装了预构建包的用户不需要 `allowBuilds` 构建授权（这正是发 npm 的意义）。
- 发布顺序建议：**先发 npm，再提 PR**（这样市场一收录就带下载量）。

## 5. 合并之后

- 网站自动重建，`dshmarket` 里出现三个条目；安装命令会长成
  `dsh plugin --profile web add dsh-tweaks-<name>`（npm 生效后）。
- 市场详情页会展示 `plugins/<name>/screenshots.json` 里声明的截图（已配好，指向 GitHub 托管的绝对 URL）。
  想换图：更新 `docs/images/` 里的同名 PNG 推上来即可，下一次构建生效，不用再提 PR。
- 条目数据要改（描述/分类），改的是**目标仓库**里你自己那个 yml，而不是生成出来的 README。

## 6. 后续发版

改完代码 → 提交推送 → 在对应插件目录 `npm publish`（`prepack` 会自动重建 `lib/`）→ 版本号记得先 `npm version patch|minor`。
