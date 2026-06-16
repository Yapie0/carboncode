/**
 * Carbon Code Teams — Slash command handler。
 *
 * 支持 /teams 子命令:
 *   /teams                           — 列出所有团队
 *   /teams create <name> [goal]      — 创建团队
 *   /teams status [id]               — 查看团队状态
 *   /teams inbox <agent> [--unread]  — 查看 agent inbox
 *   /teams resume <id>               — 恢复团队
 *   /teams archive <id>              — 归档团队
 *   /teams agents <id>               — 列出团队 agents
 *   /teams dispatch <id> <task>      — 创建并分配任务
 *   /teams mark-read <agent> [id]     — 标记消息已读
 *   /teams task-status <id> <status>  — 更新任务状态
 *   /teams decide <id> <title> <...>  — 记录架构决策
 *   /teams verify <id>                — 验证审计链完整性
 */

import { readFileSync, writeFileSync } from "node:fs";
import { verifyAuditIntegrity } from "../../../../teams/audit.js";
import { updateTaskStatus } from "../../../../teams/dispatcher.js";
import { createAndAssignTask } from "../../../../teams/dispatcher.js";
import { logEvent } from "../../../../teams/events.js";
import { markAllRead, markRead, readInbox, unreadCount } from "../../../../teams/mailbox.js";
import { decisionsPath, suggestTeamId } from "../../../../teams/paths.js";
import {
  renderAgentInbox,
  renderAgentTable,
  renderDispatchResult,
  renderTeamSummary,
} from "../../../../teams/render.js";
import { generateSnapshot, loadSnapshot } from "../../../../teams/snapshot.js";
import { createTeam, listTeams, loadTeam } from "../../../../teams/store.js";
import { archiveTeam } from "../../../../teams/store.js";
import { getDefaultAgentList, getLeanAgentList } from "../../../../teams/templates.js";
import type { SlashHandler } from "../dispatch.js";

const teams: SlashHandler = (args, _loop, ctx) => {
  const workspaceRoot = ctx.codeRoot ?? process.cwd();
  const sub = (args[0] ?? "").toLowerCase();

  // ── /teams help ──
  if (sub === "help") {
    return { info: teamsHelpText() };
  }

  // ── /teams (bare) / list ──
  if (!sub || sub === "list") {
    const teams = listTeams(workspaceRoot);
    if (teams.length === 0) {
      return {
        info: `## Carbon Code Teams\n\n没有活跃团队。\n\n${teamsHelpText()}`,
      };
    }
    const lines = ["## 活跃团队", ""];
    for (const t of teams) {
      lines.push(`- \`${t.id}\` — ${t.name} (${t.agents.length} agents, ${t.tasks.length} tasks)`);
    }
    return { info: lines.join("\n") };
  }

  // ── /teams create <name> [goal] ──
  if (sub === "create") {
    const name = args[1];
    if (!name) {
      return {
        info:
          "用法: /teams create <名称> [目标]\n\n" + '示例: /teams create my-app "构建全栈聊天应用"',
      };
    }
    const goal = args.slice(2).join(" ") || "（待定义）";
    const teamId = suggestTeamId(name);

    // 默认使用完整 agent 列表
    const agents = getDefaultAgentList();

    const result = createTeam({
      workspaceRoot,
      teamId,
      name,
      goal,
      agents,
    });

    if (!result.ok) {
      return { info: `创建失败: ${result.error}` };
    }

    // 生成快照
    generateSnapshot(result.team, workspaceRoot);

    return {
      info: [
        `团队已创建: ${result.team.name} (\`${result.team.id}\`)`,
        `目录: .carboncode/teams/${result.team.id}/`,
        `Agents: ${result.team.agents.length} 个`,
        "",
        renderAgentTable(result.team.agents),
        "",
        "下一步:",
        "  /teams status  — 查看团队状态",
        "  /teams dispatch <id> <任务> — 创建并分配任务",
        "  /teams inbox  <agent> — 查看 agent 消息",
      ].join("\n"),
    };
  }

  // ── /teams status [id] ──
  if (sub === "status") {
    // 如果只有一个团队，自动选择
    const allTeams = listTeams(workspaceRoot);
    const targetId = args[1] ?? allTeams[0]?.id;

    if (!targetId) {
      return { info: "没有活跃团队。使用 /teams create 创建。或 /teams resume <id> 恢复已归档。" };
    }

    const team = loadTeam(workspaceRoot, targetId);
    if (!team) {
      return { info: `团队 "${targetId}" 不存在。` };
    }

    return { info: renderTeamSummary(team) };
  }

  // ── /teams inbox <agent> [--unread] ──
  if (sub === "inbox") {
    const agentName = args[1];
    if (!agentName) {
      return {
        info:
          "用法: /teams inbox <agent> [--unread]\n\n" +
          "必须先有团队。使用 /teams status 查看可用 agents。",
      };
    }

    // agentName 可能是 "team-id/agent-id" 格式，或需要从活跃团队中查找
    const allTeams = listTeams(workspaceRoot);
    const team = allTeams[0];
    if (!team) {
      return { info: "没有活跃团队。使用 /teams create 创建。" };
    }

    const unreadOnly = args.includes("--unread");
    const messages = readInbox(workspaceRoot, team.id, agentName, { unreadOnly });
    const agent = team.agents.find((a) => a.id === agentName);
    const displayAgent =
      agent ??
      ({
        id: agentName,
        displayName: agentName,
        role: "unknown",
      } as unknown as (typeof team.agents)[0]);

    return { info: renderAgentInbox(displayAgent, messages) };
  }

  // ── /teams resume <id> ──
  if (sub === "resume") {
    const teamId = args[1];
    if (!teamId) {
      return {
        info: "用法: /teams resume <团队 ID>\n\n" + "从 team-snapshot.md 恢复团队状态。",
      };
    }

    const snapshot = loadSnapshot(workspaceRoot, teamId);
    if (!snapshot) {
      return { info: `无法加载团队 "${teamId}" 的快照。团队可能不存在或未生成快照。` };
    }

    const team = loadTeam(workspaceRoot, teamId);
    const teamInfo = team ? renderTeamSummary(team) : "（team.json 未找到，仅快照可用）";

    return {
      info: [
        `已恢复团队快照: ${snapshot.teamName}`,
        `快照时间: ${snapshot.createdAt}`,
        `Agent 数量: ${snapshot.agents.length}`,
        "",
        teamInfo,
      ].join("\n"),
    };
  }

  // ── /teams archive <id> ──
  if (sub === "archive") {
    const teamId = args[1];
    if (!teamId) {
      return {
        info: "用法: /teams archive <团队 ID>\n\n" + "归档团队（不删除数据）。",
      };
    }

    const result = archiveTeam(workspaceRoot, teamId);
    if (!result.ok) {
      return { info: `归档失败: ${result.error}` };
    }

    return { info: `团队 "${teamId}" 已归档。使用 /teams resume 恢复。` };
  }

  // ── /teams agents <id> ──
  if (sub === "agents") {
    const allTeams = listTeams(workspaceRoot);
    const targetId = args[1] ?? allTeams[0]?.id;

    if (!targetId) {
      return { info: "没有活跃团队。" };
    }

    const team = loadTeam(workspaceRoot, targetId);
    if (!team) {
      return { info: `团队 "${targetId}" 不存在。` };
    }

    const lines = [`团队: ${team.name} (\`${team.id}\`)`, "", renderAgentTable(team.agents)];

    return { info: lines.join("\n") };
  }

  // ── /teams dispatch <id> <task> [--cap <c1,c2>] ──
  if (sub === "dispatch") {
    const teamId = args[1];
    const taskTitle = args[2];
    if (!teamId || !taskTitle) {
      return {
        info:
          "用法: /teams dispatch <团队 ID> <任务标题> [--cap <能力1,能力2>] [--agent <agent-id>]\n\n" +
          "示例:\n" +
          '  /teams dispatch my-app "实现用户认证模块" --cap api-design,typescript\n' +
          '  /teams dispatch my-app "审查代码" --agent reviewer',
      };
    }

    const team = loadTeam(workspaceRoot, teamId);
    if (!team) {
      return { info: `团队 "${teamId}" 不存在。` };
    }

    const taskDesc =
      args
        .slice(3)
        .filter((a) => !a.startsWith("--"))
        .join(" ") || "（无描述）";
    const capArg = extractFlag(args, "--cap");
    const agentArg = extractFlag(args, "--agent");
    const capabilities = capArg ? capArg.split(",").map((c) => c.trim()) : [];
    const targetAgent = agentArg ?? undefined;

    const result = createAndAssignTask({
      team,
      workspaceRoot,
      title: taskTitle,
      description: taskDesc,
      requestedCapabilities: capabilities.length > 0 ? capabilities : undefined,
      targetAgentId: targetAgent,
      priority: "medium",
    });

    if (!result.ok) {
      return { info: `任务分配失败: ${result.error}` };
    }

    return {
      info: renderDispatchResult(result.task.id, result.assignedAgentId, result.matchReason),
    };
  }

  // ── /teams mark-read <agent> [message-id] ──
  if (sub === "mark-read") {
    const agentName = args[1];
    if (!agentName) {
      return {
        info: "用法: /teams mark-read <agent> [message-id]\n\n不指定消息 ID 则标记全部未读。",
      };
    }

    const allTeams = listTeams(workspaceRoot);
    const team = allTeams[0];
    if (!team) return { info: "没有活跃团队。" };

    const messageId = args[2];
    if (messageId) {
      try {
        const marked = markRead(workspaceRoot, team.id, agentName, messageId);
        return {
          info: `消息已标记为已读: ${marked.id} (${new Date(marked.readAtMs!).toISOString()})`,
        };
      } catch (err) {
        return { info: `标记失败: ${(err as Error).message}` };
      }
    }

    const count = markAllRead(workspaceRoot, team.id, agentName);
    return { info: `已标记 ${count} 条消息为已读。` };
  }

  // ── /teams task-status <task-id> <status> ──
  if (sub === "task-status") {
    const taskId = args[1];
    const status = args[2];
    if (!taskId || !status) {
      return {
        info:
          "用法: /teams task-status <task-id> <status>\n\n" +
          "status: queued | assigned | in_progress | blocked | submitted | accepted | rejected",
      };
    }

    const validStatuses = [
      "queued",
      "assigned",
      "in_progress",
      "blocked",
      "submitted",
      "accepted",
      "rejected",
    ];
    if (!validStatuses.includes(status)) {
      return { info: `无效状态: ${status}。可选: ${validStatuses.join(" | ")}` };
    }

    const allTeams = listTeams(workspaceRoot);
    const team = allTeams[0];
    if (!team) return { info: "没有活跃团队。" };

    const updated = updateTaskStatus(
      team,
      workspaceRoot,
      taskId,
      status as Parameters<typeof updateTaskStatus>[3],
    );
    if (!updated) {
      return { info: `任务 "${taskId}" 不存在。` };
    }

    return { info: `任务 "${taskId}" 状态已更新为: ${status}` };
  }

  // ── /teams decide <team-id> <title> <decision...> ──
  if (sub === "decide") {
    const teamId = args[1];
    const title = args[2];
    const decision = args.slice(3).join(" ");
    if (!teamId || !title || !decision) {
      return {
        info:
          "用法: /teams decide <团队 ID> <标题> <决策内容>\n\n" +
          '示例: /teams decide my-app "使用 JWT" "选择 HS256 签名，有效期 24h"',
      };
    }

    const team = loadTeam(workspaceRoot, teamId);
    if (!team) return { info: `团队 "${teamId}" 不存在。` };

    const path = decisionsPath(workspaceRoot, teamId);

    const now = new Date().toISOString();
    const entry = `\n## ${now.slice(0, 10)} — ${title}\n\n${decision}\n\n- 决策者: team-lead\n- 时间: ${now}\n`;

    const existing = readFileSync(path, "utf-8");
    writeFileSync(path, existing + entry, "utf-8");

    return { info: `决策已记录: "${title}" → ${decisionsPath(workspaceRoot, teamId)}` };
  }

  // ── /teams run <agent-id> [team-id] ──
  if (sub === "run") {
    const agentId = args[1];
    if (!agentId) {
      return {
        info:
          "用法: /teams run <agent-id> [team-id]\n\n" +
          "启动指定 agent 执行其 inbox 中的待处理任务。\n" +
          "示例: /teams run backend-dev\n" +
          "      /teams run researcher my-app",
      };
    }

    const allTeams = listTeams(workspaceRoot);
    const targetTeamId = args[2] ?? allTeams[0]?.id;
    if (!targetTeamId) return { info: "没有活跃团队。" };

    const team = loadTeam(workspaceRoot, targetTeamId);
    if (!team) return { info: `团队 "${targetTeamId}" 不存在。` };

    const agent = team.agents.find((a) => a.id === agentId);
    if (!agent) {
      return {
        info: `Agent "${agentId}" 不存在。可用的 agents:\n${team.agents.map((a) => `  - ${a.id} (${a.displayName})`).join("\n")}`,
      };
    }

    // 检查是否有 spawnTeamsAgent 回调
    if (!ctx.spawnTeamsAgent) {
      return {
        info: "当前环境不支持 spawn 子代理。\n" + "请在 `carboncode code` 会话中使用 /teams run。",
      };
    }

    // 读 agent 的未读任务
    const tasks = readInbox(workspaceRoot, team.id, agentId, { unreadOnly: true });
    const taskMessages = tasks.filter((m) => m.type === "task_assigned");

    if (taskMessages.length === 0) {
      return {
        info: `Agent "${agent.displayName}" (\`${agent.id}\`) 没有待处理任务。\n使用 /teams dispatch 分配任务，然后再次运行。`,
      };
    }

    // 从 snapshot 获取 onboarding prompt
    const snapshot = loadSnapshot(workspaceRoot, team.id);
    const snapshotAgent = snapshot?.agents.find((a) => a.id === agentId);
    const systemPrompt =
      snapshotAgent?.onboardingPrompt ??
      `你是 ${agent.displayName}，角色: ${agent.role}。\n能力: ${agent.capabilities.join(", ")}`;

    // 组装任务描述
    const taskLines = taskMessages.map(
      (m, i) =>
        `${i + 1}. ${(m.body as Record<string, unknown>).title ?? "未命名任务"}\n` +
        `   taskId: ${m.taskId}\n` +
        `   ${(m.body as Record<string, unknown>).description ?? ""}`,
    );
    const taskText = [
      `你在 "${team.name}" 团队中有 ${taskMessages.length} 个待处理任务:\n`,
      ...taskLines,
      "",
      "请依次执行这些任务，完成后将结果写入 agent 目录下的 findings.md 并通过 outbox 汇报。",
    ].join("\n");

    // 先标记任务消息为已读
    for (const m of taskMessages) {
      try {
        markRead(workspaceRoot, team.id, agentId, m.id);
      } catch {
        // ignore read marking failures
      }
    }

    // 写入事件日志
    for (const m of taskMessages) {
      logEvent(workspaceRoot, team.id, {
        type: "task_assigned",
        agentId,
        taskId: m.taskId,
        body: { action: "agent_spawned" },
      });
    }

    ctx.spawnTeamsAgent(agentId, systemPrompt, taskText);

    return {
      info: [
        `Agent "${agent.displayName}" (\`${agent.id}\`) 已启动。`,
        `待处理任务: ${taskMessages.length} 个`,
        `模型: ${agent.modelPreference}`,
        "",
        "子代理正在执行任务 — 查看 live activity 行获取进度。",
      ].join("\n"),
    };
  }

  // ── /teams verify <team-id> ──
  if (sub === "verify") {
    const teamId = args[1];
    if (!teamId) {
      return { info: "用法: /teams verify <团队 ID>\n\n验证审计日志的 hash chain 完整性。" };
    }

    const result = verifyAuditIntegrity(workspaceRoot, teamId);
    if (result.valid) {
      return { info: "✅ 审计链完整 — 所有条目 hash 验证通过。" };
    }

    return {
      info: `❌ 审计链不完整\n位置: sequence ${result.invalidAtSequence}\n原因: ${result.reason}`,
    };
  }

  // ── unknown sub ──
  return { info: `未知命令: /teams ${sub}\n\n${teamsHelpText()}` };
};

function teamsHelpText(): string {
  return [
    "## Carbon Code Teams — 命令参考",
    "",
    "| 命令 | 说明 |",
    "|------|------|",
    "| `/teams` | 列出所有活跃团队 |",
    "| `/teams help` | 显示此帮助 |",
    "| `/teams create <名称> [目标]` | 创建新团队（含 6 个默认 agent） |",
    "| `/teams status [id]` | 查看团队概览、agent 表格、任务统计 |",
    "| `/teams agents <id>` | 列出团队 agents 和能力 |",
    "| `/teams dispatch <id> <任务> [--cap c1,c2] [--agent id]` | 创建任务并分配给最匹配的 agent |",
    "| `/teams inbox <agent> [--unread]` | 查看 agent 的收件箱 |",
    "| `/teams mark-read <agent> [msg-id]` | 标记消息已读（无 id = 全部） |",
    "| `/teams run <agent> [team-id]` | 启动 agent 子代理执行 inbox 中待处理任务 |",
    "| `/teams task-status <task-id> <status>` | 更新任务状态 |",
    "| `/teams decide <id> <标题> <决策>` | 记录架构决策到 decisions.md |",
    "| `/teams verify <id>` | 验证审计链 hash 完整性 |",
    "| `/teams resume <id>` | 从 team-snapshot.md 恢复团队 |",
    "| `/teams archive <id>` | 归档团队（不删除数据） |",
    "",
    "### CLI 入口",
    "```bash",
    "carboncode teams create <name> [goal]",
    "carboncode teams status [id]",
    "carboncode teams inbox <agent> [--unread]",
    "carboncode teams resume <id>",
    "carboncode teams archive <id>",
    "```",
    "",
    "### 工作流示例",
    "```",
    "# 1. 创建团队",
    '/teams create my-app "构建全栈聊天应用"',
    "",
    "# 2. 创建任务（自动匹配能力）",
    '/teams dispatch my-app "实现用户认证模块" --cap api-design,typescript',
    "",
    "# 3. 查看 agent inbox",
    "/teams inbox backend-dev",
    "",
    "# 4. 启动 agent 干活",
    "/teams run backend-dev",
    "",
    "# 5. 检查审计链",
    "/teams verify my-app",
    "```",
  ].join("\n");
}

/** 提取 --flag <value> 的值 */
function extractFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1]!;
  }
  return null;
}

export const handlers: Record<string, SlashHandler> = { teams };
