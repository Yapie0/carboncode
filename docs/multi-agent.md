# 实验性多提供商 Multi-Agent

Carbon Code 可以按真实小型 benchmark，把设计、实施、测试、验收四个阶段分配给不同提供商和模型。该功能默认关闭。

## 安全边界

- API Key 只从环境变量或现有 DeepSeek 用户配置读取，不写入项目或 benchmark 文件。
- benchmark 保存在 `~/.carboncode/multi-agent/benchmarks.json`。
- 四个角色顺序执行，避免多个写代理同时修改一个 worktree。
- 设计和验收代理只获得明确标记为只读的工具。
- 实施或测试失败时立即停止，不继续生成虚假的验收结论。
- OpenAI Responses 的 reasoning item 会作为不透明 provider 状态续传，以支持多轮工具调用。

## 默认候选

| ID | Provider | Model | Key |
| --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek | `deepseek-v4-flash` | `DEEPSEEK_API_KEY` 或现有配置 |
| `deepseek-pro` | DeepSeek | `deepseek-v4-pro` | `DEEPSEEK_API_KEY` 或现有配置 |
| `openai-sol` | OpenAI | `gpt-5.6-sol` | `OPENAI_API_KEY` |
| `openai-terra` | OpenAI | `gpt-5.6-terra` | `OPENAI_API_KEY` |
| `openai-luna` | OpenAI | `gpt-5.6-luna` | `OPENAI_API_KEY` |

自定义模型由 `/model add` 写入顶层 `modelProfiles`，单智能体与 Multi-Agent 共用。
Multi-Agent 只保存所选档案 ID：

```json
{
  "modelProfiles": [
    {
      "id": "openai-coding",
      "provider": "openai",
      "model": "gpt-5.5",
      "baseUrl": "https://relay.example.com/v1",
      "apiKeyEnv": "CARBONCODE_MODEL_OPENAI_CODING_API_KEY"
    }
  ],
  "experimental": {
    "multiAgent": {
      "enabled": true,
      "candidateIds": ["deepseek-pro", "openai-coding"],
      "reusePenalty": 2
    }
  }
}
```

不要在 `apiKeyEnv` 中填写密钥值；这里应当只是环境变量名。

## TUI 使用流程

继续按原来的方式启动 Carbon Code：

```powershell
npm run dev
```

进入 TUI 后完成全部配置和执行：

```text
/model add
/multi-agent models
/multi-agent enable deepseek-pro openai-coding
/multi-agent benchmark deepseek-pro openai-coding
/multi-agent assignments
/multi-agent run 实现一个带测试的功能
```

`/model add`（以及兼容入口 `/multi-agent setup`）提供两种连接方式：

1. **OpenAI 官方**：填写模型 ID、档案名称和遮罩 Platform API Key。
2. **Responses 兼容中转站**：依次输入 Base URL、模型 ID、档案名称和遮罩 API Key。向导优先调用 `<Base URL>/models` 验证连接；Codex 类网关若未实现模型列表，则自动用所填模型发起一次最小 Responses 调用。

中转站示例配置：

```text
Base URL: https://relay.example.com/v1
Model: gpt-5.5
Profile ID: company-gpt
```

Carbon Code 使用 Node.js 直接连接填写的 Base URL，不要求额外开启系统代理。Base URL 和模型保存在 `~/.carboncode/config.json`；验证通过的 Key 单独保存在用户级 `~/.carboncode/credentials.json`，启动时自动恢复，不会出现在普通配置、命令历史、会话记录或项目文件中。显式环境变量具有更高优先级；同一 Base URL 的多个模型档案复用一个 Key 引用；现有 DeepSeek Key 继续沿用 Carbon Code 的普通配置。

配置中转站后，可将它与 DeepSeek 一起启用：

```text
/model company-gpt
/multi-agent enable deepseek-pro company-gpt
/multi-agent benchmark deepseek-pro company-gpt
```

建议首次测试只选择两个候选。一次完整 benchmark 会对每个候选执行四次真实 API 调用；上面的组合共执行八次。

## 外部 CLI

自动化脚本也可通过非交互子命令使用同一套配置和 benchmark：

```powershell
$env:OPENAI_API_KEY = "<OpenAI Platform API key>"

carboncode multi-agent models
carboncode multi-agent enable deepseek-pro openai-terra openai-luna
carboncode multi-agent benchmark deepseek-pro openai-terra openai-luna
carboncode multi-agent assignments
carboncode multi-agent run "实现一个带测试的功能"
```

benchmark 会产生真实 API 调用和费用。每个候选默认运行四次调用，分别评测：

1. 架构拆解、风险和验收设计。
2. TypeScript 实施与测试能力。
3. 边界与安全测试覆盖。
4. 发布阻塞问题识别。

评分来自固定结构和确定性 rubric，不使用厂商宣传分数。延迟用于同分决胜；`reusePenalty` 让分数接近时避免所有角色都挤到同一个模型。

## 手动覆盖

```powershell
carboncode multi-agent role design openai-sol
carboncode multi-agent role acceptance deepseek-pro
carboncode multi-agent role design auto
```

手动覆盖在分配结果中标记为 `override`，不会伪装为 benchmark 结论。

## 自定义中转站的凭据与模型复用

使用自定义 OpenAI 兼容中转站时，向导会先请求 `<Base URL>/models`。如果返回的模型 ID 与现有、尚未绑定地址或 Key 的模型档案一致，Carbon Code 会自动把这些档案接到该中转站；其他模型仍可通过 `/model add` 按需添加，并复用同一 Base URL 和凭据环境变量，不会把整个模型目录全部塞进选择器。配置会在重启后继续生效：Base URL、模型和配置引用保存在 `~/.carboncode/config.json`，原始 API Key 仅保存在用户级 `~/.carboncode/credentials.json`，不会写入项目配置。

如果同时设置了显式环境变量，显式环境变量优先于凭据文件中的值。
