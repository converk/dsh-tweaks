# dsh-tweaks-model-capabilities

在 DSH 的模型编辑界面里，补上官方没有的「思考强度 / 多模态 / 容量」设置。

## 它能做什么

在「设置 → 模型」里编辑模型时，官方界面只能改名字和上下文长度，没法告诉 DSH「这个模型支不支持思考」「支不支持看图」。这个插件把这些开关补进模型行：

- **思考强度** —— 5 档：关 / low / medium / high / max。一个都不勾 = 这个模型不支持思考。（只有第三方网关 `llm-pi-ai` 有这一项）
- **多模态** —— 选「文本」或「文本+图片」。（`llm-pi-ai` 和 `llm-deepseek` 都有）
- **容量快捷填入** —— 「上下文窗口 / 最大输出」各有一个 `1M` / `128K` 按钮；新建模型行展开容量时自动填好 1000000 / 131072。

## 怎么用

1. 打开 **设置 → 模型**，选一个提供方 → **编辑** → **自定义设置**。
2. 找到要改的那个模型，点那一行的 **「容量」** 展开。
3. 展开后顶部会显示这个模型当前的配置摘要，下面是思考强度、多模态和容量按钮：
   - **思考强度**：勾上这个模型支持的档位；右边方括号里是该档的"过线拼写"，不同网关叫法不一样（比如 `max` 在你那边叫 `ultra`），可以改。
   - 一个档都不勾 = 这个模型不支持思考。
4. 改完点官方那个 **「保存」** 才真正写进去（改过之后行内会提示"已改，点官方『保存』后写入"）；点官方「取消」则丢弃这次改动。

**第三方网关（`llm-pi-ai`）** —— 思考强度 + 多模态 + 容量快捷填入：

![llm-pi-ai 模型行展开后的思考强度 / 多模态 / 1M·128K 快捷填入](../../docs/images/model-capabilities-third-party.png)

**官方 DeepSeek（`llm-deepseek`）** —— 只有多模态（DeepSeek 的思考档位是提供方级设置，这里只读显示当前值）：

![llm-deepseek 模型行展开后的多模态 / 1M·128K 快捷填入](../../docs/images/model-capabilities-official.png)

## 说明

- 上下文窗口、最大输出仍然由官方输入框管，插件只是帮你少敲几个 0。
- 「添加提供方」时的新卡片里不注入控件（还没保存过，这时写入会出问题）；保存进编辑页之后就能配置了。
- 内置目录里的 `minimal` / `xhigh` 两档不显示、也不管理。
- 保存失败（比如设置冲突）会原样显示 DSH 报的错，改动会保留，可以再点一次「保存」重试。

## 安装

```powershell
dsh plugin --profile web add "D:\你的目录\dsh-tweaks\plugins\model-capabilities"
```

然后打开 `C:\Users\你的用户名\.dsh\profiles\web\cordis.patch.yml`，拉到**最下面**粘进去：

```yaml
- insert:
    - id: model-capabilities
      name: dsh-tweaks-model-capabilities
```

重启 DSH，再到浏览器按 `Ctrl + Shift + R` 刷新。

> `web` 是你的 profile 名；不确定就打开 `C:\Users\你的用户名\.dsh\profiles\` 看一眼，里面那个文件夹叫什么就填什么。

## 开发者

本仓库的开发约定、DSH 契约与通用坑见 [AGENTS.md](../../AGENTS.md)。
