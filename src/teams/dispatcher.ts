import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { appendAudit } from "./audit.js";
import { logEvent } from "./events.js";
import { sendMessage } from "./mailbox.js";
import {
  taskDir,
  taskFindingsPath,
  taskPlanMdPath,
  taskProgressPath,
  taskReviewPath,
} from "./paths.js";
import { saveTeam } from "./store.js";
import type {
  Team,
  TeamAgent,
  TeamTask,
  TeamTaskPriority,
  TeamTaskStatus,
  TeamTaskSummary,
} from "./types.js";

export interface CapabilityMatchResult {
  agentId: string;
  score: number;
  reason: string;
}

/** 根据 requestedCapabilities 匹配 team 中最合适的 agent。 */
export function matchBestAgent(
  team: Team,
  requiredCapabilities: string[],
  excludeAgentIds: string[] = [],
): CapabilityMatchResult | null {
  let best: CapabilityMatchResult | null = null;

  for (const agent of team.agents) {
    if (excludeAgentIds.includes(agent.id)) continue;
    if (agent.status === "offline") continue;

    // 计算匹配分数：命中 capability 数 / 总要求数
    const hits = requiredCapabilities.filter((cap) =>
      agent.capabilities.some((ac) => ac.toLowerCase().includes(cap.toLowerCase())),
    );

    if (hits.length === 0) continue;

    const score = hits.length / requiredCapabilities.length;

    if (!best || score > best.score) {
      best = {
        agentId: agent.id,
        score,
        reason: `匹配 ${hits.length}/${requiredCapabilities.length} 项能力: ${hits.join(", ")}`,
      };
    }
  }

  return best;
}

export interface CreateTaskInput {
  team: Team;
  workspaceRoot: string;
  title: string;
  description: string;
  priority?: TeamTaskPriority;
  requestedCapabilities?: string[];
  /** 不指定则自动匹配 */
  targetAgentId?: string;
}

export interface CreateTaskResult {
  ok: true;
  task: TeamTask;
  assignedAgentId: string;
  matchReason: string;
}

export type CreateTaskError = {
  ok: false;
  error: string;
};

export function createAndAssignTask(input: CreateTaskInput): CreateTaskResult | CreateTaskError {
  const now = new Date().toISOString();
  const taskId = `task-${randomUUID().slice(0, 8)}`;
  const requestedCapabilities = input.requestedCapabilities ?? [];
  let assignedAgentId: string;
  let matchReason: string;

  // 确定目标 agent
  if (input.targetAgentId) {
    const agent = input.team.agents.find((a) => a.id === input.targetAgentId);
    if (!agent) {
      return { ok: false, error: `Agent "${input.targetAgentId}" 不存在。` };
    }
    assignedAgentId = agent.id;
    matchReason = `手动指定 agent: ${agent.displayName}`;
  } else if (requestedCapabilities.length > 0) {
    const match = matchBestAgent(input.team, requestedCapabilities);
    if (!match) {
      return {
        ok: false,
        error: `没有 agent 能匹配能力要求: ${requestedCapabilities.join(", ")}。使用 --agent 手动指定。`,
      };
    }
    assignedAgentId = match.agentId;
    matchReason = match.reason;
  } else {
    // 无 capability 要求且无指定 agent → 分配给 team-lead
    const lead = input.team.agents.find((a) => a.role === "team-lead");
    assignedAgentId = lead?.id ?? input.team.agents[0]?.id ?? "";
    if (!assignedAgentId) {
      return { ok: false, error: "团队没有可用 agent。" };
    }
    matchReason = `默认分配给 team-lead: ${lead?.displayName ?? assignedAgentId}`;
  }

  // 构建 task
  const task: TeamTask = {
    id: taskId,
    title: input.title,
    description: input.description,
    status: "assigned",
    priority: input.priority ?? "medium",
    requestedCapabilities,
    assignedAgentIds: [assignedAgentId],
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    taskDir: taskDir(input.workspaceRoot, input.team.id, taskId),
  };

  // 创建任务目录和文件
  try {
    const td = taskDir(input.workspaceRoot, input.team.id, taskId);
    mkdirSync(td, { recursive: true });
    writeFileSync(
      taskPlanMdPath(input.workspaceRoot, input.team.id, taskId),
      `# ${input.title}\n\n${input.description}\n`,
      "utf-8",
    );
    writeFileSync(
      taskFindingsPath(input.workspaceRoot, input.team.id, taskId),
      `# ${input.title} — 发现\n\n`,
      "utf-8",
    );
    writeFileSync(
      taskProgressPath(input.workspaceRoot, input.team.id, taskId),
      `# ${input.title} — 进度\n\n`,
      "utf-8",
    );
    writeFileSync(taskReviewPath(input.workspaceRoot, input.team.id, taskId), "", "utf-8");
  } catch (err) {
    return { ok: false, error: `创建任务目录失败: ${(err as Error).message}` };
  }

  // 更新 team 中的任务摘要
  const summary: TeamTaskSummary = {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    requestedCapabilities: task.requestedCapabilities,
    assignedAgentIds: task.assignedAgentIds,
    dependencies: task.dependencies,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  input.team.tasks.push(summary);
  input.team.updatedAt = now;

  // 更新对应 agent 状态为 busy
  const agent = input.team.agents.find((a) => a.id === assignedAgentId);
  if (agent) {
    agent.status = "busy";
  }

  saveTeam(input.team, input.workspaceRoot);

  // 发送 inbox 消息给被分配的 agent
  sendMessage(input.workspaceRoot, input.team.id, {
    from: "team-lead",
    to: assignedAgentId,
    type: "task_assigned",
    taskId,
    body: {
      title: input.title,
      description: input.description,
      priority: input.priority ?? "medium",
      capabilities: requestedCapabilities,
    },
  });

  // 事件日志
  logEvent(input.workspaceRoot, input.team.id, {
    type: "task_assigned",
    agentId: assignedAgentId,
    taskId,
    body: { title: input.title, matchReason },
  });

  // 审计日志
  appendAudit(input.workspaceRoot, input.team.id, {
    actor: "team-lead",
    action: "task_assigned",
    resourceType: "task",
    resourceId: taskId,
    outcome: "success",
    metadata: { assignedTo: assignedAgentId, title: input.title },
  });

  return {
    ok: true,
    task,
    assignedAgentId,
    matchReason,
  };
}

export function updateTaskStatus(
  team: Team,
  workspaceRoot: string,
  taskId: string,
  status: TeamTaskStatus,
): boolean {
  const summary = team.tasks.find((t) => t.id === taskId);
  if (!summary) return false;

  summary.status = status;
  summary.updatedAt = new Date().toISOString();

  // 如果任务完成或拒绝，释放 agent
  if (status === "accepted" || status === "rejected") {
    for (const agentId of summary.assignedAgentIds) {
      const agent = team.agents.find((a) => a.id === agentId);
      if (agent) {
        // 检查该 agent 是否还有其它未完成任务
        const hasOtherTasks = team.tasks.some(
          (t) =>
            t.id !== taskId &&
            t.assignedAgentIds.includes(agentId) &&
            t.status !== "accepted" &&
            t.status !== "rejected",
        );
        if (!hasOtherTasks) {
          agent.status = "idle";
        }
      }
    }
  }

  team.updatedAt = new Date().toISOString();
  return saveTeam(team, workspaceRoot);
}

export function getAgentTasks(team: Team, agentId: string): TeamTaskSummary[] {
  return team.tasks.filter((t) => t.assignedAgentIds.includes(agentId));
}
