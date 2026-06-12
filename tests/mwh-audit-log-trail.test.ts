import { describe, expect, it } from "vitest";
import {
  appendAuditEntry,
  auditEntryMatches,
  createAuditEvent,
  hashAuditEntry,
  redactAuditMetadata,
  verifyAuditChain,
} from "../src/mwh/modules/observability/audit-log-trail/core.js";
import { MemoryAuditLogStore } from "../src/mwh/modules/observability/audit-log-trail/memory-store.js";

describe("MWH audit-log-trail stateless core", () => {
  it("creates audit events and redacts nested sensitive metadata", () => {
    expect(
      createAuditEvent({
        id: "a1",
        actorId: "admin",
        action: "update",
        resourceType: "user",
        resourceId: "u1",
        occurredAtMs: 1_000,
        metadata: {
          role: "owner",
          token: "secret",
          nested: { password: "pw", safe: true },
        },
      }),
    ).toEqual({
      id: "a1",
      actorId: "admin",
      action: "update",
      resourceType: "user",
      resourceId: "u1",
      outcome: "success",
      occurredAtMs: 1_000,
      metadata: {
        role: "owner",
        token: "[REDACTED]",
        nested: { password: "[REDACTED]", safe: true },
      },
    });
    expect(redactAuditMetadata({ apiKey: "k", visible: "ok" }, ["apiKey"])).toEqual({
      apiKey: "[REDACTED]",
      visible: "ok",
    });
  });

  it("appends entries with deterministic hashes and verifies valid chains", () => {
    const first = appendAuditEntry(
      undefined,
      createAuditEvent({
        id: "a1",
        actorId: "admin",
        action: "login",
        resourceType: "session",
        resourceId: "s1",
        occurredAtMs: 1_000,
      }),
    );
    const second = appendAuditEntry(
      first,
      createAuditEvent({
        id: "a2",
        actorId: "admin",
        action: "update",
        resourceType: "user",
        resourceId: "u1",
        occurredAtMs: 1_100,
      }),
    );

    expect(first.sequence).toBe(1);
    expect(first.previousHash).toMatch(/^0{64}$/);
    expect(first.hash).toBe(hashAuditEntry(first));
    expect(second).toEqual(expect.objectContaining({ sequence: 2, previousHash: first.hash }));
    expect(verifyAuditChain([second, first])).toEqual({ valid: true });
  });

  it("detects mutated entries and sequence gaps", () => {
    const first = appendAuditEntry(
      undefined,
      createAuditEvent({
        id: "a1",
        actorId: "admin",
        action: "login",
        resourceType: "session",
        resourceId: "s1",
        occurredAtMs: 1_000,
      }),
    );
    const second = appendAuditEntry(
      first,
      createAuditEvent({
        id: "a2",
        actorId: "admin",
        action: "logout",
        resourceType: "session",
        resourceId: "s1",
        occurredAtMs: 1_100,
      }),
    );

    expect(verifyAuditChain([{ ...first, actorId: "mutated" }, second])).toEqual({
      valid: false,
      invalidAtSequence: 1,
      reason: "entry hash mismatch",
    });
    expect(verifyAuditChain([{ ...second, sequence: 3 }])).toEqual({
      valid: false,
      invalidAtSequence: 3,
      reason: "sequence gap or duplicate",
    });
  });

  it("matches entries with audit query filters", () => {
    const entry = appendAuditEntry(
      undefined,
      createAuditEvent({
        id: "a1",
        actorId: "admin",
        action: "delete",
        resourceType: "project",
        resourceId: "p1",
        outcome: "denied",
        occurredAtMs: 1_000,
      }),
    );

    expect(auditEntryMatches(entry, { actorId: "admin", resourceType: "project" })).toBe(true);
    expect(auditEntryMatches(entry, { actorId: "other" })).toBe(false);
  });
});

describe("MWH audit-log-trail stateful memory store", () => {
  it("appends, queries, limits, verifies, and preserves clone safety", () => {
    let now = 1_000;
    const store = new MemoryAuditLogStore({ now: () => now });
    const first = store.append({
      id: "a1",
      actorId: "admin",
      action: "login",
      resourceType: "session",
      resourceId: "s1",
    });
    now = 1_100;
    store.append({
      id: "a2",
      actorId: "admin",
      action: "update",
      resourceType: "user",
      resourceId: "u1",
    });
    first.actorId = "mutated";

    expect(store.list()[0]?.actorId).toBe("admin");
    expect(store.query({ actorId: "admin", limit: 1 }).map((entry) => entry.id)).toEqual(["a1"]);
    expect(store.query({ resourceType: "user" }).map((entry) => entry.id)).toEqual(["a2"]);
    expect(store.verify()).toEqual({ valid: true });
  });

  it("appends prebuilt events with store-level redaction settings", () => {
    const store = new MemoryAuditLogStore({ now: () => 1_000, redactedKeys: ["secretValue"] });
    const appended = store.append({
      id: "a1",
      actorId: "admin",
      action: "custom",
      resourceType: "api-key",
      resourceId: "key1",
      metadata: { secretValue: "secret", name: "prod" },
    });
    const event = createAuditEvent({
      id: "a2",
      actorId: "system",
      action: "read",
      resourceType: "api-key",
      resourceId: "key1",
      occurredAtMs: 1_100,
      metadata: { token: "hidden" },
    });
    const second = store.appendEvent(event);

    expect(appended.metadata).toEqual({ secretValue: "[REDACTED]", name: "prod" });
    expect(second.sequence).toBe(2);
    expect(store.verify()).toEqual({ valid: true });
  });
});
