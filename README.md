# Carbon Code

Carbon Code 是一个中文优先、基于 DeepSeek 的终端编码智能体，面向个人开发者的日常开发。

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
