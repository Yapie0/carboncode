import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkSnapshotStaleness, generateSnapshot, loadSnapshot } from "../src/teams/snapshot.js";
import { createTeam } from "../src/teams/store.js";
import type { TeamAgent } from "../src/teams/types.js";

const TEST_AGENT: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "researcher",
  displayName: "研究员",
  capabilities: ["code-search"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

describe("teams-snapshot", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-teams-snap-"));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("generates and loads a snapshot", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo Team",
      goal: "Build something",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    const snapshot = generateSnapshot(createResult.team, dir);
    expect(snapshot.teamId).toBe("demo");
    expect(snapshot.teamName).toBe("Demo Team");
    expect(snapshot.agents).toHaveLength(1);
    expect(snapshot.agents[0]!.onboardingPrompt).toBeTruthy();

    // 验证文件存在
    const snapFile = join(dir, ".carboncode", "teams", "demo", "team-snapshot.md");
    expect(existsSync(snapFile)).toBe(true);

    // 加载快照
    const loaded = loadSnapshot(dir, "demo");
    expect(loaded).not.toBeNull();
    expect(loaded!.teamId).toBe("demo");
    expect(loaded!.agents).toHaveLength(1);
  });

  it("checks staleness", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    const snapshot = generateSnapshot(createResult.team, dir);

    // 刚生成的不应过期
    const staleness = checkSnapshotStaleness(snapshot);
    expect(staleness.stale).toBe(false);
  });

  it("returns null for non-existent snapshot", () => {
    const loaded = loadSnapshot(dir, "nonexistent");
    expect(loaded).toBeNull();
  });

  it("snapshot markdown contains required sections", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    generateSnapshot(createResult.team, dir);
    const snapFile = join(dir, ".carboncode", "teams", "demo", "team-snapshot.md");
    const content = readFileSync(snapFile, "utf-8");

    expect(content).toContain("## 团队成员");
    expect(content).toContain("### 研究员");
    expect(content).toContain("## 源文件时间戳");
  });
});
