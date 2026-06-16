# Carbon Code Teams — Phase 3 实施计划

> 状态：待执行
> 依赖：Phase 2 全部完成（58 tests 通过，MWH 对齐度 mailbox 85% / audit 92%）

---

## 目标

补全 Teams 剩余的 6 个缺口，实现 user → slash → API → disk 的完整闭环。

---

## Phase 3a：用户界面补全（P1，4 个 slash 命令）

所有底层 API 已就绪，只需加 handler 入口。

### 1. `/teams mark-read <agent> [message-id]`

| 项目 | 说明 |
|------|------|
| API | `markRead(ws, team, agent, msgId)` / `markAllRead(ws, team, agent)` |
| 无 id | 标记该 agent 全部未读消息为已读 |
| 有 id | 只标记指定消息 |
| handler 文件 | `src/cli/ui/slash/handlers/teams.ts` |
| 渲染 | 返回 `renderAgentInbox` 或计数摘要 |
| 改动量 | ~15 行 |

### 2. `/teams task-status <task-id> <status>`

| 项目 | 说明 |
|------|------|
| API | `updateTaskStatus(team, ws, taskId, status)` |
| status 可选值 | queued / assigned / in_progress / blocked / submitted / accepted / rejected |
| 完成时 | 释放 agent 为 idle，发送 `task_completed` 事件 |
| 渲染 | `renderDispatchResult` 显示变更 |
| 改动量 | ~25 行 |

### 3. `/teams decide <team-id> <title> <decision>`

| 项目 | 说明 |
|------|------|
| 存储 | 追加到 `decisions.md`（Markdown 格式） |
| 格式 | `## [date] title\n\ndecision\n\n- 理由: rationale\n` |
| 改动量 | ~15 行 |

### 4. `/teams verify <team-id>`

| 项目 | 说明 |
|------|------|
| API | `verifyAuditIntegrity(ws, teamId)` |
| 输出 | `valid: true/false` + `reason` + `invalidAtSequence` |
| 改动量 | ~10 行 |

---

## Phase 3b：agent 执行闭环（P0，1 个核心能力）

### `/teams run <agent-id> [team-id]`

这是 Teams 从"数据管理"到"真正干活"的关键一步。

#### 技术方案

```
用户输入: /teams run backend-dev
         ↓
1. slash handler 接收 agent-id
2. 从活跃 team 找到 agent 的 TeamAgent + onboarding prompt
3. 读 agent inbox → 找未读的 task_assigned 消息
4. 组装 system prompt: onboarding prompt + "你收到了以下任务:"
5. 通过 ctx.spawnTeamsAgent(agentId, system, task) 调用 spawnSubagent
6. TUI 显示子代理 live activity row
```

#### 需要的架构改动

| 文件 | 改动 |
|------|------|
| `src/cli/ui/slash/types.ts` | `SlashContext` 加 `spawnTeamsAgent?: (agentId: string, system: string, task: string) => void` |
| `src/cli/ui/App.tsx` | 在 `registerTools` 闭包中注入 `spawnTeamsAgent`（复用已有的 `client` + `registry` + `sink`） |
| `src/cli/ui/slash/handlers/teams.ts` | 新增 `spawn` 子命令 |

#### spawnSubagent 调用参数

```ts
spawnSubagent({
  client,                    // 复用主 session 的 DeepSeekClient
  parentRegistry,            // 继承父级工具（只读或受限）
  system: onboardingPrompt,  // 角色的 onboarding prompt
  task: "请检查你的 inbox 并执行待处理任务。...",
  model: agent.modelPreference, // roles 中定义
  sink,                      // 主 session 的 subagent sink（显示 activity row）
  skillName: `teams/${agent.id}`, // 用于 /stats 统计
})
```

#### 风险

- `spawnSubagent` 需要 `DeepSeekClient` + `ToolRegistry`，这些只在 session 内部可用
- 如果 slack handler 在非 session 环境被调用（测试），`spawnTeamsAgent` 为 `null`，需要 degrade 提示
- agent 执行完后的结果回传：子代理的 `output` 需要写回 agent 的 `outbox` 或 `findings.md`

#### 改动量

| 文件 | 行数 |
|------|------|
| `types.ts`（SlashContext） | +3 |
| `App.tsx` | +12 |
| `handlers/teams.ts` | +40 |
| **合计** | ~55 行 |

---

## Phase 3c：测试和验证

| 测试 | 覆盖 |
|------|------|
| `tests/teams-cli.test.ts` | CLI 命令参数解析 |
| `tests/slash-teams.test.ts` | slash 命令错误提示 |
| 补充现有测试 | mark-read / task-status / decide / verify / run |

---

## 改动汇总

| Phase | 文件数 | 新增行数 | 新增测试 |
|-------|--------|---------|---------|
| 3a | 2 | ~65 | ~30 |
| 3b | 3 | ~55 | ~20 |
| 3c | 2 | ~80 | ~50 |
| **合计** | **7** | **~200** | **~100** |

---

## 不在此阶段的内容

- agent 增减（等真实使用反馈）
- dispatcher 并发上限（没有长期运行的 agent 前不需要）
- snapshot staleness 自动检查（源文件稳定）
- multi-session 实时协作（Phase 4+）
- golden_rules CI（需要 Carbon Code 自身 CI 基础设施）
- review dimensions（需要真实项目使用后校准）

---

## 验证命令

```bash
npx tsc --noEmit
npx biome check --fix src/teams/ src/cli/ui/slash/handlers/teams.ts src/cli/commands/teams.ts
npx vitest run tests/teams-*.test.ts tests/slash-teams.test.ts
npx vitest run tests/slash.test.ts        # 确认无回归
```
