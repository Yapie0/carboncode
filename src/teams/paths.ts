import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Carbon Code 项目目录（相对于工作区根） */
const CARBONCODE_DIR = ".carboncode";

/** Teams 子目录名 */
const TEAMS_DIR = "teams";

/** archive 子目录名 */
const ARCHIVE_DIR = "archive";

/** agents 子目录名 */
const AGENTS_DIR = "agents";

/** tasks 子目录名 */
const TASKS_DIR = "tasks";

/** docs 子目录名 */
const DOCS_DIR = "docs";

/** `.carboncode/teams/` 绝对路径 */
export function teamsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, CARBONCODE_DIR, TEAMS_DIR);
}

/** `.carboncode/teams/<teamId>/` 绝对路径 */
export function teamDir(workspaceRoot: string, teamId: string): string {
  return join(teamsRoot(workspaceRoot), teamId);
}

/** `.carboncode/teams/archive/<teamId>/` 绝对路径 */
export function archivedTeamDir(workspaceRoot: string, teamId: string): string {
  return join(teamsRoot(workspaceRoot), ARCHIVE_DIR, teamId);
}

export function teamJsonPath(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), "team.json");
}

export function taskPlanPath(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), "task_plan.md");
}

export function decisionsPath(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), "decisions.md");
}

export function teamSnapshotPath(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), "team-snapshot.md");
}

export function eventsJsonlPath(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), "events.jsonl");
}

export function auditJsonlPath(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), "audit.jsonl");
}

export function agentsRoot(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), AGENTS_DIR);
}

export function agentDir(workspaceRoot: string, teamId: string, agentId: string): string {
  return join(agentsRoot(workspaceRoot, teamId), agentId);
}

export function agentJsonPath(workspaceRoot: string, teamId: string, agentId: string): string {
  return join(agentDir(workspaceRoot, teamId, agentId), "agent.json");
}

export function inboxJsonlPath(workspaceRoot: string, teamId: string, agentId: string): string {
  return join(agentDir(workspaceRoot, teamId, agentId), "inbox.jsonl");
}

export function outboxJsonlPath(workspaceRoot: string, teamId: string, agentId: string): string {
  return join(agentDir(workspaceRoot, teamId, agentId), "outbox.jsonl");
}

export function progressPath(workspaceRoot: string, teamId: string, agentId: string): string {
  return join(agentDir(workspaceRoot, teamId, agentId), "progress.md");
}

export function findingsPath(workspaceRoot: string, teamId: string, agentId: string): string {
  return join(agentDir(workspaceRoot, teamId, agentId), "findings.md");
}

export function tasksRoot(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), TASKS_DIR);
}

export function taskDir(workspaceRoot: string, teamId: string, taskId: string): string {
  return join(tasksRoot(workspaceRoot, teamId), taskId);
}

export function taskPlanMdPath(workspaceRoot: string, teamId: string, taskId: string): string {
  return join(taskDir(workspaceRoot, teamId, taskId), "task_plan.md");
}

export function taskFindingsPath(workspaceRoot: string, teamId: string, taskId: string): string {
  return join(taskDir(workspaceRoot, teamId, taskId), "findings.md");
}

export function taskProgressPath(workspaceRoot: string, teamId: string, taskId: string): string {
  return join(taskDir(workspaceRoot, teamId, taskId), "progress.md");
}

export function taskReviewPath(workspaceRoot: string, teamId: string, taskId: string): string {
  return join(taskDir(workspaceRoot, teamId, taskId), "review.md");
}

export function docsDir(workspaceRoot: string, teamId: string): string {
  return join(teamDir(workspaceRoot, teamId), DOCS_DIR);
}

export function docsArchitecturePath(workspaceRoot: string, teamId: string): string {
  return join(docsDir(workspaceRoot, teamId), "architecture.md");
}

export function docsApiContractsPath(workspaceRoot: string, teamId: string): string {
  return join(docsDir(workspaceRoot, teamId), "api-contracts.md");
}

export function docsInvariantsPath(workspaceRoot: string, teamId: string): string {
  return join(docsDir(workspaceRoot, teamId), "invariants.md");
}

const SAFE_ID = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i;

/** team id / agent id / task id 必须符合安全规则。 */
export function validateId(id: string, label: string): string | null {
  if (!id || id.trim().length === 0) {
    return `${label} 不能为空`;
  }
  const trimmed = id.trim();
  if (trimmed.length > 128) {
    return `${label} 过长（最多 128 字符）`;
  }
  if (!SAFE_ID.test(trimmed)) {
    return `${label} 包含非法字符（仅允许字母、数字、. _ -，不能以特殊字符开头或结尾）`;
  }
  // 拒绝路径穿越
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return `${label} 包含非法路径字符`;
  }
  return null;
}

/** 验证 team id 在指定工作区不存在（返回 null = ok，返回 string = 错误消息）。 */
export function validateTeamNotExists(workspaceRoot: string, teamId: string): string | null {
  const dir = teamDir(workspaceRoot, teamId);
  if (existsSync(dir)) {
    return `团队 "${teamId}" 已存在。使用 /teams resume 恢复，或选择其他名称。`;
  }
  return null;
}

/** 验证 team id 存在（返回 null = ok，返回 string = 错误消息）。 */
export function validateTeamExists(workspaceRoot: string, teamId: string): string | null {
  const dir = teamDir(workspaceRoot, teamId);
  if (!existsSync(dir)) {
    return `团队 "${teamId}" 不存在。使用 /teams create 创建。`;
  }
  return null;
}

/** 安全的 team id 建议：转小写、空格换横线、去除非法字符。 */
export function suggestTeamId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .slice(0, 64);
}
