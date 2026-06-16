/**
 * Carbon Code Teams — TUI 渲染工具。
 *
 * 将 Team 数据渲染为可展示的文本行，供 slash handler 或 CLI 使用。
 */

import type { Team, TeamAgent, TeamMessage, TeamTaskSummary } from "./types.js";

// ─── 团队概览 ──────────────────────────────────────────────────────

export function renderTeamSummary(team: Team): string {
  const lines: string[] = [
    `团队: ${team.id}`,
    `名称: ${team.name}`,
    `状态: ${team.status === "active" ? "活跃" : "已归档"}`,
    `目标: ${team.goal}`,
    `创建: ${team.createdAt}`,
    `更新: ${team.updatedAt}`,
    "",
    `Agent 数量: ${team.agents.length}`,
    `任务数量: ${team.tasks.length}`,
    "",
    renderAgentTable(team.agents),
    "",
    renderTaskSummary(team.tasks),
  ];
  return lines.join("\n");
}

export function renderAgentTable(agents: readonly TeamAgent[]): string {
  if (agents.length === 0) return "（无 agent）";

  const lines = ["## Agent 列表", ""];
  lines.push("| 角色 | ID | 状态 | 能力 |");
  lines.push("|------|-----|------|------|");

  for (const a of agents) {
    const caps = a.capabilities.slice(0, 3).join(", ") + (a.capabilities.length > 3 ? "..." : "");
    const statusLabel =
      a.status === "idle"
        ? "空闲"
        : a.status === "busy"
          ? "忙碌"
          : a.status === "blocked"
            ? "阻塞"
            : "离线";
    lines.push(`| ${a.displayName} | \`${a.id}\` | ${statusLabel} | ${caps || "无"} |`);
  }

  return lines.join("\n");
}

export function renderTaskSummary(tasks: readonly TeamTaskSummary[]): string {
  if (tasks.length === 0) return "（无任务）";

  const lines = ["## 任务列表", ""];

  // 按状态分组统计
  const statusCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
  }

  lines.push("状态统计:");
  for (const [status, count] of Object.entries(statusCounts)) {
    const label = statusLabel(status);
    lines.push(`  ${label}: ${count}`);
  }
  lines.push("");

  for (const t of tasks) {
    const status = statusLabel(t.status);
    const agents = t.assignedAgentIds.map((id) => `\`${id}\``).join(", ");
    lines.push(`- [${status}] ${t.title} → ${agents || "未分配"}`);
  }

  return lines.join("\n");
}

export function renderAgentInbox(agent: TeamAgent, messages: TeamMessage[]): string {
  if (messages.length === 0) {
    return `Agent \`${agent.id}\` (${agent.displayName}) 的 inbox 为空。`;
  }

  const unreadCount = messages.filter((m) => m.readAtMs == null).length;
  const lines = [
    `Agent: ${agent.displayName} (\`${agent.id}\`)`,
    `消息总数: ${messages.length} | 未读: ${unreadCount}`,
    "",
  ];

  for (const msg of messages) {
    const readMark = msg.readAtMs != null ? " " : "●";
    const bodyPreview = JSON.stringify(msg.body).slice(0, 60);
    lines.push(`  ${readMark} [${msg.type}] 来自 ${msg.from} — ${msg.createdAt}`);
    if (bodyPreview) lines.push(`    ${bodyPreview}`);
  }

  return lines.join("\n");
}

export function renderDispatchResult(taskId: string, agentId: string, reason: string): string {
  return [`任务已创建: \`${taskId}\``, `分配给: \`${agentId}\``, `原因: ${reason}`].join("\n");
}

// ─── helper ───────────────────────────────────────────────────────

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    queued: "排队中",
    assigned: "已分配",
    in_progress: "进行中",
    blocked: "已阻塞",
    submitted: "已提交",
    accepted: "已通过",
    rejected: "已拒绝",
  };
  return labels[status] ?? status;
}
