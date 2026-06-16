/**
 * Carbon Code Teams — 团队存储层。
 *
 * 负责 team.json 的创建、读取、更新，以及目录结构的初始化。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { appendAudit } from "./audit.js";
import { logEvent } from "./events.js";
import {
  agentJsonPath,
  agentsRoot,
  archivedTeamDir,
  auditJsonlPath,
  decisionsPath,
  docsDir,
  eventsJsonlPath,
  inboxJsonlPath,
  outboxJsonlPath,
  taskPlanPath,
  tasksRoot,
  teamDir,
  teamJsonPath,
  teamSnapshotPath,
  teamsRoot,
  validateId,
  validateTeamExists,
  validateTeamNotExists,
} from "./paths.js";
import type { Team, TeamAgent, TeamAgentStatus, TeamStatus } from "./types.js";

// ─── 创建团队 ──────────────────────────────────────────────────────

export interface CreateTeamInput {
  /** 工作区根目录 */
  workspaceRoot: string;
  /** 团队 id（kebab-case） */
  teamId: string;
  /** 人类可读名称 */
  name: string;
  /** 项目目标 */
  goal: string;
  /** 初始 agent 列表 */
  agents: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath">[];
}

export interface CreateTeamResult {
  ok: true;
  team: Team;
}

export type CreateTeamError = {
  ok: false;
  error: string;
};

export function createTeam(input: CreateTeamInput): CreateTeamResult | CreateTeamError {
  // 验证 id
  const idErr = validateId(input.teamId, "团队 ID");
  if (idErr) return { ok: false, error: idErr };
  const existsErr = validateTeamNotExists(input.workspaceRoot, input.teamId);
  if (existsErr) return { ok: false, error: existsErr };

  const teamId = input.teamId.trim();
  const now = new Date().toISOString();
  const root = teamDir(input.workspaceRoot, teamId);

  // 分配完整 agent 数据（填充 id 和路径）
  const agents: TeamAgent[] = input.agents.map((a) => {
    const agentId = `${a.role}`;
    return {
      id: agentId,
      role: a.role,
      displayName: a.displayName,
      capabilities: a.capabilities ?? [],
      status: "idle" as TeamAgentStatus,
      modelPreference: a.modelPreference ?? "deepseek-v4-flash",
      inboxPath: `agents/${agentId}/inbox.jsonl`,
      outboxPath: `agents/${agentId}/outbox.jsonl`,
    };
  });

  const team: Team = {
    id: teamId,
    name: input.name,
    goal: input.goal,
    status: "active" as TeamStatus,
    agents,
    tasks: [],
    createdAt: now,
    updatedAt: now,
    rootDir: root,
  };

  try {
    // 创建目录结构
    const dirs = [
      root,
      agentsRoot(input.workspaceRoot, teamId),
      tasksRoot(input.workspaceRoot, teamId),
      docsDir(input.workspaceRoot, teamId),
    ];
    for (const d of dirs) {
      mkdirSync(d, { recursive: true });
    }

    // 为每个 agent 创建目录和文件
    for (const agent of agents) {
      const ad = dirname(agentJsonPath(input.workspaceRoot, teamId, agent.id));
      mkdirSync(ad, { recursive: true });

      // agent.json
      writeFileSync(
        agentJsonPath(input.workspaceRoot, teamId, agent.id),
        JSON.stringify(
          {
            id: agent.id,
            role: agent.role,
            displayName: agent.displayName,
            capabilities: agent.capabilities,
            status: agent.status,
            modelPreference: agent.modelPreference,
            inboxPath: agent.inboxPath,
            outboxPath: agent.outboxPath,
          },
          null,
          2,
        ),
        "utf-8",
      );

      // 空 inbox.jsonl / outbox.jsonl
      writeFileSync(inboxJsonlPath(input.workspaceRoot, teamId, agent.id), "", "utf-8");
      writeFileSync(outboxJsonlPath(input.workspaceRoot, teamId, agent.id), "", "utf-8");
    }

    // 写入 team.json
    writeFileSync(
      teamJsonPath(input.workspaceRoot, teamId),
      JSON.stringify(
        {
          id: team.id,
          name: team.name,
          goal: team.goal,
          status: team.status,
          agents: team.agents,
          tasks: team.tasks,
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
        },
        null,
        2,
      ),
      "utf-8",
    );

    // 创建空文件
    writeFileSync(taskPlanPath(input.workspaceRoot, teamId), "# 暂无计划\n", "utf-8");
    writeFileSync(decisionsPath(input.workspaceRoot, teamId), "# 决策日志\n", "utf-8");
    writeFileSync(eventsJsonlPath(input.workspaceRoot, teamId), "", "utf-8");
    writeFileSync(auditJsonlPath(input.workspaceRoot, teamId), "", "utf-8");
    writeFileSync(teamSnapshotPath(input.workspaceRoot, teamId), "", "utf-8");

    // 审计 + 事件
    logEvent(input.workspaceRoot, teamId, {
      type: "team_created",
      agentId: "team-lead",
      body: { name: team.name, goal: team.goal, agentCount: agents.length },
    });
    appendAudit(input.workspaceRoot, teamId, {
      actor: "team-lead",
      action: "team_created",
      resourceType: "team",
      resourceId: teamId,
      outcome: "success",
      metadata: { name: team.name },
    });

    return { ok: true, team };
  } catch (err) {
    return { ok: false, error: `创建团队目录失败: ${(err as Error).message}` };
  }
}

// ─── 加载团队 ──────────────────────────────────────────────────────

export function loadTeam(workspaceRoot: string, teamId: string): Team | null {
  const existsErr = validateTeamExists(workspaceRoot, teamId);
  if (existsErr) return null;

  try {
    const raw = readFileSync(teamJsonPath(workspaceRoot, teamId), "utf-8");
    const data = JSON.parse(raw) as Team;
    data.rootDir = teamDir(workspaceRoot, teamId);
    return data;
  } catch {
    return null;
  }
}

// ─── 更新团队 ──────────────────────────────────────────────────────

export function saveTeam(team: Team, workspaceRoot: string): boolean {
  try {
    // 去掉运行时字段再持久化
    const { rootDir, ...persist } = team;
    writeFileSync(
      teamJsonPath(workspaceRoot, team.id),
      JSON.stringify(
        {
          ...persist,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    return true;
  } catch {
    return false;
  }
}

// ─── 归档团队 ──────────────────────────────────────────────────────

export function archiveTeam(
  workspaceRoot: string,
  teamId: string,
): { ok: true } | { ok: false; error: string } {
  const team = loadTeam(workspaceRoot, teamId);
  if (!team) return { ok: false, error: `团队 "${teamId}" 不存在。` };
  if (team.status === "archived") return { ok: false, error: `团队 "${teamId}" 已经归档。` };

  try {
    // 审计日志 — 必须在 rename 之前写，因为 rename 后原路径不再存在
    logEvent(workspaceRoot, teamId, {
      type: "team_archived",
      agentId: "team-lead",
    });
    appendAudit(workspaceRoot, teamId, {
      actor: "team-lead",
      action: "team_archived",
      resourceType: "team",
      resourceId: teamId,
      outcome: "success",
    });

    const src = teamDir(workspaceRoot, teamId);
    const dest = archivedTeamDir(workspaceRoot, teamId);
    mkdirSync(dirname(dest), { recursive: true });
    renameSync(src, dest);

    // 更新 archive 目录下的 team.json status
    team.status = "archived";
    team.updatedAt = new Date().toISOString();
    writeFileSync(
      `${dest}/team.json`,
      JSON.stringify(
        {
          id: team.id,
          name: team.name,
          goal: team.goal,
          status: team.status,
          agents: team.agents,
          tasks: team.tasks,
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
        },
        null,
        2,
      ),
      "utf-8",
    );

    return { ok: true };
  } catch (err) {
    return { ok: false, error: `归档失败: ${(err as Error).message}` };
  }
}

// ─── 列出全部团队 ─────────────────────────────────────────────────

export function listTeams(workspaceRoot: string): Team[] {
  const root = teamsRoot(workspaceRoot);
  try {
    if (!existsSync(root)) return [];
    const teams: Team[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "archive") continue;
      const team = loadTeam(workspaceRoot, entry.name);
      if (team) teams.push(team);
    }
    return teams.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
