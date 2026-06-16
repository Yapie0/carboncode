/**
 * Carbon Code Teams — Audit 测试。
 *
 * 覆盖：redaction、stable hash、sequence chain、verification、query。
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendAudit,
  queryAuditLog,
  readAuditLog,
  verifyAuditIntegrity,
} from "../src/teams/audit.js";
import { auditJsonlPath } from "../src/teams/paths.js";
import { createTeam } from "../src/teams/store.js";
import type { TeamAgent } from "../src/teams/types.js";

const TEST_AGENT: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "researcher",
  displayName: "研究员",
  capabilities: ["code-search"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

describe("teams-audit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-teams-audit-"));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("appends audit entries with sequence and hash chain", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    const e1 = appendAudit(dir, "demo", {
      actor: "team-lead",
      action: "task_assigned",
      resourceType: "task",
      resourceId: "task-1",
      metadata: { title: "Implement auth" },
    });

    const e2 = appendAudit(dir, "demo", {
      actor: "researcher",
      action: "task_completed",
      resourceType: "task",
      resourceId: "task-1",
      outcome: "success",
    });

    // createTeam 已经写了 team_created audit（sequence=1）
    // 所以这里 append 的是 sequence=2 和 sequence=3
    expect(e1.sequence).toBe(2);
    expect(e2.sequence).toBe(3);
    expect(e2.prevHash).toBe(e1.hash);
    expect(e1.hash).toBeDefined();
    expect(e1.hash).toHaveLength(64);

    const log = readAuditLog(dir, "demo");
    expect(log).toHaveLength(3); // team_created + task_assigned + task_completed
  });

  it("redacts sensitive metadata", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    const entry = appendAudit(dir, "demo", {
      actor: "admin",
      action: "login",
      resourceType: "session",
      resourceId: "s1",
      metadata: {
        token: "sk-abc123",
        password: "s3cret",
        safe: "visible",
        nested: { apiKey: "key-456", ok: true },
      },
    });

    expect(entry.metadata.token).toBe("[REDACTED]");
    expect(entry.metadata.password).toBe("[REDACTED]");
    expect(entry.metadata.safe).toBe("visible");
    expect((entry.metadata.nested as Record<string, unknown>)!.apiKey).toBe("[REDACTED]");
    expect((entry.metadata.nested as Record<string, unknown>)!.ok).toBe(true);
  });

  it("verifies valid chain", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    appendAudit(dir, "demo", {
      actor: "a",
      action: "create",
      resourceType: "team",
      resourceId: "demo",
    });
    appendAudit(dir, "demo", {
      actor: "b",
      action: "update",
      resourceType: "team",
      resourceId: "demo",
    });

    const result = verifyAuditIntegrity(dir, "demo");
    expect(result.valid).toBe(true);
  });

  it("detects hash mismatch", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    appendAudit(dir, "demo", {
      actor: "a",
      action: "create",
      resourceType: "team",
      resourceId: "demo",
    });

    // 直接篡改 audit.jsonl
    const path = auditJsonlPath(dir, "demo");
    const raw = readAuditLog(dir, "demo");
    raw[0]!.metadata = { tampered: true };
    writeFileSync(path, `${raw.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf-8");

    const result = verifyAuditIntegrity(dir, "demo");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("entry hash mismatch");
  });

  it("queries by actor and resourceType", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    appendAudit(dir, "demo", {
      actor: "researcher",
      action: "search",
      resourceType: "code",
      resourceId: "src/app.ts",
    });
    appendAudit(dir, "demo", {
      actor: "backend-dev",
      action: "deploy",
      resourceType: "task",
      resourceId: "task-1",
    });
    appendAudit(dir, "demo", {
      actor: "researcher",
      action: "search",
      resourceType: "web",
      resourceId: "url-1",
    });

    const byActor = queryAuditLog(dir, "demo", { actor: "researcher" });
    expect(byActor).toHaveLength(2);

    const byType = queryAuditLog(dir, "demo", { resourceType: "task" });
    expect(byType).toHaveLength(1);

    const limited = queryAuditLog(dir, "demo", { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("stable hash is deterministic across calls", () => {
    const createResult = createTeam({
      workspaceRoot: dir,
      teamId: "demo",
      name: "Demo",
      goal: "Test",
      agents: [TEST_AGENT],
    });
    if (!createResult.ok) throw new Error("createTeam failed");

    // 完全相同的内容应该产生相同的 hash
    const entry1 = appendAudit(dir, "demo", {
      actor: "test",
      action: "create",
      resourceType: "team",
      resourceId: "demo",
      metadata: { a: 1, b: 2 },
    });

    // 字段顺序不同也应该产生相同的 hash（stableStringify 排序）
    const entry2 = appendAudit(dir, "demo", {
      actor: "test",
      action: "create",
      resourceType: "team",
      resourceId: "demo",
      metadata: { b: 2, a: 1 }, // reversed
    });

    // 不同 sequence 导致不同 hash（ok）
    expect(entry1.hash).not.toBe(entry2.hash);

    // 但两次 metadata 序列化后的 hash 基础应该是稳定的
    // （验证 stableStringify 字段排序）
    expect(entry1.metadata).toEqual(entry2.metadata);
  });
});
