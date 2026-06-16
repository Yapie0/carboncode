import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { suggestTeamId, teamJsonPath, validateId } from "../src/teams/paths.js";
import { archiveTeam, createTeam, listTeams, loadTeam, saveTeam } from "../src/teams/store.js";
import type { TeamAgent } from "../src/teams/types.js";

const TEST_AGENT: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "researcher",
  displayName: "研究员",
  capabilities: ["code-search", "web-research"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

describe("teams-store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-teams-"));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  describe("validateId", () => {
    it("rejects empty id", () => {
      expect(validateId("", "ID")).toBe("ID 不能为空");
    });

    it("rejects path traversal", () => {
      expect(validateId("../etc", "ID")).toContain("非法");
    });

    it("accepts valid id", () => {
      expect(validateId("my-project", "ID")).toBeNull();
      expect(validateId("team_2.v1", "ID")).toBeNull();
    });

    it("rejects id over 128 chars", () => {
      const long = "a".repeat(129);
      expect(validateId(long, "ID")).toContain("过长");
    });
  });

  describe("suggestTeamId", () => {
    it("lowercases and replaces spaces with dashes", () => {
      expect(suggestTeamId("My Awesome Project")).toBe("my-awesome-project");
    });

    it("strips invalid characters", () => {
      expect(suggestTeamId("Hello! World?")).toBe("hello-world");
    });
  });

  describe("createTeam", () => {
    it("creates team directory and team.json", () => {
      const result = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo Team",
        goal: "Build something great",
        agents: [TEST_AGENT],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const team = result.team;
      expect(team.id).toBe("demo");
      expect(team.name).toBe("Demo Team");
      expect(team.status).toBe("active");
      expect(team.agents).toHaveLength(1);

      const jsonPath = teamJsonPath(dir, "demo");
      expect(existsSync(jsonPath)).toBe(true);

      const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
      expect(raw.id).toBe("demo");
      expect(raw.agents[0].role).toBe("researcher");
    });

    it("creates agent directories with agent.json and inbox/outbox", () => {
      const result = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT],
      });
      if (!result.ok) throw new Error("createTeam failed");

      const agentFile = join(
        dir,
        ".carboncode",
        "teams",
        "demo",
        "agents",
        "researcher",
        "agent.json",
      );
      expect(existsSync(agentFile)).toBe(true);

      const inboxFile = join(
        dir,
        ".carboncode",
        "teams",
        "demo",
        "agents",
        "researcher",
        "inbox.jsonl",
      );
      expect(existsSync(inboxFile)).toBe(true);
    });

    it("rejects duplicate team id", () => {
      createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "First",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      const result = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Second",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("已存在");
    });

    it("rejects invalid team id", () => {
      const result = createTeam({
        workspaceRoot: dir,
        teamId: "../bad",
        name: "Bad",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      expect(result.ok).toBe(false);
    });
  });

  describe("loadTeam", () => {
    it("loads a created team", () => {
      createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      const team = loadTeam(dir, "demo");
      expect(team).not.toBeNull();
      expect(team!.name).toBe("Demo");
      expect(team!.rootDir).toBeDefined();
    });

    it("returns null for non-existent team", () => {
      const team = loadTeam(dir, "nonexistent");
      expect(team).toBeNull();
    });
  });

  describe("saveTeam", () => {
    it("updates team.json", () => {
      const result = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT],
      });
      if (!result.ok) throw new Error("createTeam failed");

      const team = result.team;
      team.name = "Updated Demo";
      const saved = saveTeam(team, dir);
      expect(saved).toBe(true);

      const reloaded = loadTeam(dir, "demo");
      expect(reloaded!.name).toBe("Updated Demo");
    });
  });

  describe("archiveTeam", () => {
    it("moves team to archive", () => {
      createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      const result = archiveTeam(dir, "demo");
      expect(result.ok).toBe(true);

      // 原始目录应该已移动
      expect(existsSync(join(dir, ".carboncode", "teams", "demo"))).toBe(false);
    });

    it("returns error for already archived team", () => {
      createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT],
      });
      archiveTeam(dir, "demo");

      const result = archiveTeam(dir, "demo");
      expect(result.ok).toBe(false);
    });
  });

  describe("listTeams", () => {
    it("lists created teams", () => {
      createTeam({
        workspaceRoot: dir,
        teamId: "alpha",
        name: "Alpha",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      createTeam({
        workspaceRoot: dir,
        teamId: "beta",
        name: "Beta",
        goal: "Test",
        agents: [TEST_AGENT],
      });

      const teams = listTeams(dir);
      expect(teams).toHaveLength(2);
    });

    it("returns empty array when no teams exist", () => {
      const teams = listTeams(dir);
      expect(teams).toHaveLength(0);
    });
  });
});
