import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAndAssignTask,
  getAgentTasks,
  matchBestAgent,
  updateTaskStatus,
} from "../src/teams/dispatcher.js";
import { createTeam, loadTeam } from "../src/teams/store.js";
import type { TeamAgent } from "../src/teams/types.js";

const BACKEND_DEV: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "backend-dev",
  displayName: "后端开发者",
  capabilities: ["typescript", "nodejs", "api-design", "tdd"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

const FRONTEND_DEV: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "frontend-dev",
  displayName: "前端开发者",
  capabilities: ["typescript", "react", "component-testing"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

const RESEARCHER: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "researcher",
  displayName: "研究员",
  capabilities: ["code-search", "web-research"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

describe("teams-dispatcher", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-teams-disp-"));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  describe("matchBestAgent", () => {
    it("matches by capability", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV, FRONTEND_DEV],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const match = matchBestAgent(createResult.team, ["api-design"]);
      expect(match).not.toBeNull();
      expect(match!.agentId).toBe("backend-dev"); // backend-dev has api-design
    });

    it("returns null when no agent matches", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [FRONTEND_DEV],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const match = matchBestAgent(createResult.team, ["database"]);
      expect(match).toBeNull();
    });

    it("excludes offline agents", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      // 将 agent 设为 offline（挂掉后）
      createResult.team.agents[0]!.status = "offline";

      const match = matchBestAgent(createResult.team, ["api-design"]);
      expect(match).toBeNull();
    });
  });

  describe("createAndAssignTask", () => {
    it("creates a task and assigns to capability-matched agent", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV, RESEARCHER],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const taskResult = createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "Implement auth module",
        description: "JWT-based authentication",
        requestedCapabilities: ["api-design", "typescript"],
      });

      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;

      expect(taskResult.assignedAgentId).toBe("backend-dev");
      expect(taskResult.task.title).toBe("Implement auth module");
      expect(taskResult.task.status).toBe("assigned");

      // 验证 task 目录创建
      expect(
        existsSync(join(dir, ".carboncode", "teams", "demo", "tasks", taskResult.task.id)),
      ).toBe(true);

      // 验证 team 中的 task 摘要
      const reloaded = loadTeam(dir, "demo");
      expect(reloaded!.tasks).toHaveLength(1);
    });

    it("allows manual agent targeting", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV, RESEARCHER],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const taskResult = createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "Research task",
        description: "Find out about X",
        targetAgentId: "researcher",
      });

      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;

      expect(taskResult.assignedAgentId).toBe("researcher");
    });

    it("errors for non-existent target agent", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const taskResult = createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "Task",
        description: "Desc",
        targetAgentId: "nonexistent",
      });

      expect(taskResult.ok).toBe(false);
    });

    it("errors when no agent matches capabilities", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [RESEARCHER],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const taskResult = createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "API task",
        description: "Desc",
        requestedCapabilities: ["api-design"],
      });

      expect(taskResult.ok).toBe(false);
    });
  });

  describe("updateTaskStatus", () => {
    it("updates task status and releases agent on completion", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const taskResult = createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "Task 1",
        description: "Desc",
        requestedCapabilities: ["typescript"],
      });
      if (!taskResult.ok) throw new Error("createAndAssignTask failed");

      // 确认 agent 变为 busy
      expect(createResult.team.agents[0]!.status).toBe("busy");

      // 标记完成
      const updated = updateTaskStatus(createResult.team, dir, taskResult.task.id, "accepted");
      expect(updated).toBe(true);

      // agent 应恢复 idle
      expect(createResult.team.agents[0]!.status).toBe("idle");
    });
  });

  describe("getAgentTasks", () => {
    it("returns tasks assigned to a specific agent", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [BACKEND_DEV, RESEARCHER],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "Backend task",
        description: "Desc",
        requestedCapabilities: ["typescript"],
      });

      createAndAssignTask({
        team: createResult.team,
        workspaceRoot: dir,
        title: "Research task",
        description: "Desc",
        targetAgentId: "researcher",
      });

      const backendTasks = getAgentTasks(createResult.team, "backend-dev");
      expect(backendTasks).toHaveLength(1);
      expect(backendTasks[0]!.title).toBe("Backend task");
    });
  });
});
