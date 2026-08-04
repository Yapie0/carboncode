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

## 多模型与提供商

`/model` 不再只切换 DeepSeek 模型 ID。它同时管理当前单智能体会话可用的模型档案，
支持 OpenAI 官方服务和任意兼容 OpenAI Responses API 的自建或公司内部中转站：

```text
/model                         # 打开模型选择器
/model add                     # 引导添加提供商、模型、Base URL 和 Key
/model list                    # 查看档案、Key 状态和当前模型
/model update company-gpt      # 更新并重新验证档案
/model remove company-gpt      # 删除未在使用的自定义档案
/model company-gpt             # 当前会话立即切换 provider + model
```

添加中转站时依次填写 Base URL、模型 ID、模型档案名称和遮罩 API Key。Carbon Code
直接连接所填地址，无需额外开启代理；优先使用 `/models` 验证，未实现模型列表的
Responses 网关会退回一次最小 `/responses` 调用。档案元数据写入
`~/.carboncode/config.json`；验证通过的原始 Key 单独写入用户级
`~/.carboncode/credentials.json`，不进入普通配置、会话历史或项目文件。支持的平台会将
凭据文件权限收紧为仅当前用户可读写，显式环境变量仍具有最高优先级。

同一提供商或中转站可登记多个模型。DeepSeek 模型共享现有 DeepSeek Key；OpenAI
官方档案共享 `OPENAI_API_KEY`；同一中转站 Base URL 的多个档案会复用同一个 Key
引用。因此一个 Key 可以切换多个模型，Carbon Code 重启后会自动从用户凭据库恢复。

## 实验性 Multi-Agent

Multi-Agent 是共享模型档案的一种使用方式，不是另一套模型配置。Carbon Code 可以
根据真实小型
benchmark，把设计、实施、测试、验收四个阶段分配给不同模型顺序执行。

源码开发时仍按原方式启动：

```powershell
npm run dev
```

进入 TUI 后配置和运行：

```text
/model add
/multi-agent models
/multi-agent enable deepseek-pro company-gpt
/multi-agent benchmark deepseek-pro company-gpt
/multi-agent assignments
/multi-agent run 实现一个带测试的功能
```

`/multi-agent setup` 是 `/model add` 的兼容入口，打开同一个模型设置向导。新增和
更新的模型档案既可直接通过 `/model <档案名>` 使用，也会出现在 Multi-Agent 候选中。
benchmark 会产生真实 API 调用和费用；每个
候选模型完整评测四个角色，即四次调用。

完整架构、安全边界、自定义候选和非交互 CLI 用法见
[多提供商 Multi-Agent 文档](docs/multi-agent.md)。

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
