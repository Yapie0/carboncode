# Carbon Code

中文优先、DeepSeek 驱动的个人开发者终端代码智能体。

Carbon Code 面向个人开发者工作流：进入一个仓库，让智能体读取和搜索代码、规划
修改、展示 diff、在执行 shell 命令前请求确认、按需运行验证，并输出简洁结果。

English documentation: [README.md](README.md)

## 安装

要求 Node.js 22 或更新版本。

```bash
npm install -g @carboncode/cli
cd path/to/project
carboncode
```

短命令：

```bash
ccode
```

不全局安装也可以临时运行：

```bash
npx @carboncode/cli
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `carboncode` / `carboncode code [dir]` | 以当前项目为根目录的编码智能体。 |
| `carboncode chat` | 不带文件系统和 shell 工具的纯聊天。 |
| `carboncode run "task"` | 非交互式执行一次任务。 |
| `carboncode doctor` | 本地环境健康检查。 |
| `carboncode update` | 检查并安装最新 CLI 包。 |

Carbon Code 也安装 `ccode`。默认不会安装 `cc`，因为这个名字通常是系统 C 编译器。

## 配置

用户配置文件位置：

```text
~/.carboncode/config.json
```

可以通过首次运行向导配置 DeepSeek API Key，也可以直接导出环境变量：

```bash
export DEEPSEEK_API_KEY=sk-...
```

项目规则建议写在仓库里的 `AGENTS.md` 或 `CARBON.md`。

模型预设使用当前 DeepSeek V4 API ID：`flash` 对应 `deepseek-v4-flash`，
`pro` 对应 `deepseek-v4-pro`，`auto` 默认从 Flash 开始，并在困难回合一次性升级
到 Pro。

## 发布

npm 发布由 GitHub Actions 的 tag 流程触发。需要先在 npmjs.com 的 package
settings 里配置 Trusted Publishing：选择 GitHub Actions，仓库填
`Yapie0/carboncode`，workflow 文件填 `publish.yml`，environment 填 `npm`。

发布时先更新 `package.json`，提交发布版本，再推送匹配的 semver tag：

```bash
git tag v0.1.0
git push origin main --tags
```

`Publish npm package` workflow 会先验证包、检查 tag 是否与 `package.json` 版本一致，
然后执行 `npm publish --access public --provenance`。

## 当前范围

Carbon Code 目前处于早期阶段，重点是个人开发者 CLI 工作流。当前产品化覆盖包名、
命令名、Carbon 配置目录、更新/安装命令、中文优先 CLI 文案、npm 发布流程和开源
许可合规。

## 许可与归因

Carbon Code 使用 MIT 许可证。

第三方 MIT 声明保留在：

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

不要移除派生源码中的 copyright 或 MIT notice。
