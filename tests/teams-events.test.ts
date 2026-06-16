import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { logEvent, readEvents } from "../src/teams/events.js";
import { createTeam } from "../src/teams/store.js";
import type { TeamAgent } from "../src/teams/types.js";

const TEST_AGENT: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "researcher",
  displayName: "研究员",
  capabilities: ["code-search"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

describe("teams-events", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-teams-ev-"));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("logs and reads events", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    const ev = logEvent(dir, "demo", {
      type: "task_assigned",
      agentId: "researcher",
      taskId: "task-1",
      body: { title: "Research" },
    });

    expect(ev.id).toBeDefined();
    expect(ev.type).toBe("task_assigned");

    // createTeam 已经写了 team_created 事件，所以两条
    const all = readEvents(dir, "demo");
    expect(all).toHaveLength(2);
    expect(all.some((e) => e.type === "task_assigned")).toBe(true);
    expect(all.some((e) => e.type === "team_created")).toBe(true);
  });

  it("filters by type", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    // createTeam 已经写了一个 team_created
    logEvent(dir, "demo", { type: "task_assigned", agentId: "researcher" });
    logEvent(dir, "demo", { type: "task_assigned", agentId: "backend-dev" });

    const filtered = readEvents(dir, "demo", { type: "task_assigned" });
    expect(filtered).toHaveLength(2);
  });

  it("filters by agentId", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    logEvent(dir, "demo", { type: "task_assigned", agentId: "researcher" });
    logEvent(dir, "demo", { type: "task_assigned", agentId: "backend-dev" });

    const filtered = readEvents(dir, "demo", { agentId: "researcher" });
    expect(filtered).toHaveLength(1);
  });

  it("respects limit", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    logEvent(dir, "demo", { type: "note", agentId: "a" });
    logEvent(dir, "demo", { type: "note", agentId: "b" });
    logEvent(dir, "demo", { type: "note", agentId: "c" });

    const limited = readEvents(dir, "demo", { limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
