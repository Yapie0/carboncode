# Carbon Code

Carbon Code 是一款类似 Claude Code 的代码开发工具，也是中国第一个基于 DeepSeek 的代码开发工具，Token 成本节省 90% 以上。它可以实现自动任务拆分、自动开发、MCP 测试，以及与 Claude、Codex 等多 Agent 协作，能力接近 Claude Sonnet 4.6。

在项目目录中启动后，它会读取并搜索你的代码、提出修改方案并以 diff 展示、在运行 shell 命令前征求你的确认、按需运行测试验证，并为每次会话留下简洁的记录。

English: [README.en.md](README.en.md)

## 安装

要求 Node.js 22 或更新版本。

```bash
npm install -g @carboncode/cli
cd path/to/project
carboncode
```

Windows PowerShell 运行 `npm` 命令时，如果提示 `npm.ps1` 被禁止执行，请改用 `npm.cmd`，例如：

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run verify
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
| `carboncode` | 在当前项目目录启动编码智能体（等同 `carboncode code`）。 |
| `carboncode code [dir]` | 在指定目录 `[dir]` 启动编码智能体；省略 `[dir]` 即为当前目录。 |
| `carboncode chat` | 不带文件系统和 shell 工具的纯聊天。 |
| `carboncode run "task"` | 非交互式执行一次任务。 |
| `carboncode init [dir]` | 分析项目并生成 `CARBON.md` 项目指南。 |
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

初始化已有项目的规则文件：

```bash
carboncode init
carboncode init --dry-run
carboncode init --force --yes
```

该命令只读取仓库中的 manifest、目录和工具配置，不调用模型。已有规则文件默认
不会被覆盖；可先使用 `--dry-run` 查看差异，再显式传入 `--force`。

## 许可与归因

Carbon Code 使用 MIT 许可证。

第三方 MIT 声明保留在：

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

不要移除派生源码中的 copyright 或 MIT notice。
