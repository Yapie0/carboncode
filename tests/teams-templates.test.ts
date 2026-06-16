/**
 * Carbon Code Teams — Templates 测试。
 *
 * 覆盖：7 个默认角色完整性、onboarding prompt 渲染。
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  getDefaultAgentList,
  getLeanAgentList,
  renderOnboardingPrompt,
} from "../src/teams/templates.js";
import type { Team, TeamAgent, TeamAgentRole } from "../src/teams/types.js";

function makeTeam(): Team {
  return {
    id: "demo",
    name: "Demo Team",
    goal: "Build something great",
    status: "active",
    agents: [],
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeAgent(role: TeamAgentRole): TeamAgent {
  return {
    id: role,
    role,
    displayName: DEFAULT_ROLES[role].displayName,
    capabilities: DEFAULT_ROLES[role].capabilities,
    status: "idle",
    modelPreference: DEFAULT_ROLES[role].modelPreference,
    inboxPath: `agents/${role}/inbox.jsonl`,
    outboxPath: `agents/${role}/outbox.jsonl`,
  };
}

describe("teams-templates", () => {
  it("has all 7 default roles defined", () => {
    const expectedRoles: TeamAgentRole[] = [
      "team-lead",
      "researcher",
      "backend-dev",
      "frontend-dev",
      "reviewer",
      "custodian",
      "e2e-tester",
    ];

    for (const role of expectedRoles) {
      const def = DEFAULT_ROLES[role];
      expect(def).toBeDefined();
      expect(def.displayName).toBeTruthy();
      expect(def.capabilities.length).toBeGreaterThan(0);
      expect(def.responsibilities).toBeTruthy();
    }
  });

  it("getDefaultAgentList returns 6 agents (excludes team-lead)", () => {
    const list = getDefaultAgentList();
    expect(list).toHaveLength(6);
    expect(list.find((a) => a.role === "team-lead")).toBeUndefined();
    expect(list.find((a) => a.role === "researcher")).toBeDefined();
  });

  it("getLeanAgentList returns 3 agents", () => {
    const list = getLeanAgentList();
    expect(list).toHaveLength(3);
  });

  it("renders onboarding prompt with team context", () => {
    const team = makeTeam();
    const agent = makeAgent("researcher");

    const prompt = renderOnboardingPrompt(team, agent);

    expect(prompt).toContain("研究员");
    expect(prompt).toContain("Build something great");
    expect(prompt).toContain("code-search");
    expect(prompt).toContain("2-Action Rule");
    expect(prompt).toContain("3-Strike 升级");
    expect(prompt).toContain(".carboncode/teams/demo/agents/researcher/");
  });

  it("each role template has all required fields", () => {
    for (const [roleName, role] of Object.entries(DEFAULT_ROLES)) {
      expect(role.role).toBe(roleName);
      expect(role.displayName.length).toBeGreaterThan(0);
      expect(role.capabilities.length).toBeGreaterThan(0, `${roleName}: capabilities empty`);
      expect(role.responsibilities.length).toBeGreaterThan(
        0,
        `${roleName}: responsibilities empty`,
      );
      expect(role.inputContext.length).toBeGreaterThan(0, `${roleName}: inputContext empty`);
      expect(role.outputFiles.length).toBeGreaterThan(0, `${roleName}: outputFiles empty`);
      expect(role.escalationTriggers.length).toBeGreaterThan(
        0,
        `${roleName}: escalationTriggers empty`,
      );
      expect(role.reviewTriggers.length).toBeGreaterThan(0, `${roleName}: reviewTriggers empty`);
      expect(role.documentationTriggers.length).toBeGreaterThan(
        0,
        `${roleName}: documentationTriggers empty`,
      );
    }
  });
});
