# OpenAI 兼容模型提供方：自动发现与运行时适配

Carbon Code 除了内置 DeepSeek 配置，也支持提供 OpenAI 兼容 API 的官方服务、
网关和中转站。桌面端的目标流程是：用户只需填写 API Base URL 和 API Key，
Carbon Code 自动读取模型目录、推荐一个适合 Agent 的模型并选择请求协议；高级选项
仅用于覆盖少数不标准服务。

## 桌面端配置流程

1. 打开“设置 -> 模型”。
2. 选择“添加模型提供方”。
3. 先填写 API Base URL，例如 `https://relay.example/v1`。
4. 填写 API Key。输入停止 650 ms 后会自动探测，也可点击“刷新模型”。
5. 探测成功后，从服务端实际返回的模型列表中选择模型。Carbon Code 会预选一个
   稳定的 Agent 模型，并过滤 embedding、image、audio、rerank 等非对话模型。
6. 保存。新提供方立即成为活动提供方；主会话、ACP、`run`、`commit`、`doctor`
   和技能子 Agent 使用同一份配置。

已有提供方可以独立保存和切换。修改同一提供方的 URL、密钥、模型、协议或推理档位
后，运行时按完整配置重新创建连接，不会继续复用旧客户端。

## 自动发现

发现阶段只发送带 Bearer 鉴权的 `GET` 请求，不调用生成接口，不发送对话、文件或
工具定义，也不会产生模型 Token 消耗。

Carbon Code 会规范化用户粘贴的地址，并依次识别以下常见模型目录：

- `<base>/models`
- `<base>/v1/models`

因此下列输入都可以被修正为可用 API 根地址：

- `https://relay.example`
- `https://relay.example/v1`
- `https://relay.example/v1/models`
- `https://relay.example/v1/responses`
- `https://relay.example/v1/chat/completions`

探测失败时只返回有界错误分类，不把上游响应正文或 API Key 写入诊断日志。
API Key 被视为提供方定义的不透明凭证，不要求 `sk-` 前缀或固定长度；只要模型目录
鉴权成功即可保存，避免客户端臆测格式而拒绝合法中转站。

## 请求协议自动选择

`wireApi: "auto"` 是自定义提供方的默认值：

- GPT-5、OpenAI o 系列和 Codex 风格模型优先使用 Responses API。
- 其他模型优先使用 Chat Completions API。
- 仅当服务明确返回路由不存在或不支持（例如 HTTP 404、405、501）时，才尝试
  另一个标准协议或 `/v1` 根路径。
- HTTP 401/403、429、模型错误和 5xx 不会触发协议切换，避免认证失败或服务端故障
  导致一次用户请求被重复提交。

Responses API 路径支持：

- 非流式文本与推理摘要；
- SSE 文本、推理和函数参数增量；
- 输入、输出和缓存 Token 统计；
- 函数调用；
- 保留 provider-native response items，将工具结果正确续接到下一轮；
- `store: false`，不要求提供方保存响应状态。

Chat Completions 路径保留 DeepSeek 和传统 OpenAI 兼容服务的现有能力。

## 推理档位自适应

自定义提供方默认使用 `reasoningEffortMax: "auto"`。对于支持高级推理的模型，
Carbon Code 会优先尝试模型族常用档位。只有收到明确的 400/422 推理参数校验错误时，
才按 `xhigh -> high -> 省略参数` 降级，并记住该模型当前进程内成功的档位。

这解决了不同模型枚举不一致的问题，例如一个服务只接受 `low/medium/high`，另一个
接受 `xhigh`。认证、配额、网络和普通模型错误不会被误判为推理档位错误。

高级设置可固定：

- 协议：`auto`、`responses`、`chat_completions`
- 推理上限：`auto`、`none`、`high`、`xhigh`、`max`

## 未登记模型

服务端 `/models` 返回的模型可以直接使用，不要求先写入 Carbon Code 内置能力表。
未知模型使用保守的默认上下文窗口，价格按未知处理（显示为 0，而不是猜测成本），
但不会阻断对话或要求普通用户先填写 override。

需要精确的本地上下文压缩阈值和费用统计时，高级用户仍可在
`~/.carboncode/config.json` 中配置 `contextWindowOverride` 和 `pricingOverride`。
这两个字段是统计精度增强项，不是使用前置条件。

## 安全边界

- API Key 保存在用户本机的 Carbon Code 配置中，并直接用于请求所选提供方。
- 自动发现和运行时不会把 Key 发送给 Carbon Code 日志收集服务。
- UI 和设置事件只回传掩码前缀，不向渲染层返回完整的已保存 Key。
- 诊断事件不保留请求正文、提示词、模型输出、完整 URL 查询参数或凭证。

## 可重复验收

仓库提供了环境变量驱动的端到端验收脚本，密钥不会写入命令参数、配置或源码：

```powershell
$env:CARBONCODE_PROVIDER_BASE_URL = "https://relay.example/v1"
$env:CARBONCODE_PROVIDER_API_KEY = "<temporary-key>"
$env:CARBONCODE_PROVIDER_MODEL = "gpt-5"
npm run test:provider-e2e
Remove-Item Env:CARBONCODE_PROVIDER_API_KEY
```

脚本依次验证：模型目录、非流式回复、SSE 流式回复、函数调用、工具结果续轮。成功时
只输出提供方域名、模型数量、模型 ID、推断协议和检查项，不输出密钥。

## 标准参考

- OpenAI Models: <https://developers.openai.com/api/reference/resources/models/methods/list>
- OpenAI Responses: <https://developers.openai.com/api/reference/resources/responses/methods/create>
- OpenAI Chat Completions: <https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create>
