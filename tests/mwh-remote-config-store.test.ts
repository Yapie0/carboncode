import { describe, expect, it } from "vitest";
import {
  createRemoteConfigEntry,
  createRemoteConfigSnapshot,
  remoteConfigEtag,
  remoteConfigRuleMatches,
  resolveRemoteConfig,
  updateRemoteConfigEntry,
} from "../src/mwh/modules/feature-config/remote-config-store/core.js";
import { MemoryRemoteConfigStore } from "../src/mwh/modules/feature-config/remote-config-store/memory-store.js";

describe("MWH remote-config-store middleware", () => {
  it("creates entries, updates versions, and preserves clone safety", () => {
    const entry = createRemoteConfigEntry({
      key: "model.temperature",
      defaultValue: { value: 0.2 },
      nowMs: 1_000,
      rules: [{ id: "tenant-t1", priority: 10, tenantId: "t1", value: { value: 0.7 } }],
    });
    const next = updateRemoteConfigEntry(entry, { nowMs: 1_100, defaultValue: { value: 0.3 } });

    expect(entry).toEqual(
      expect.objectContaining({
        key: "model.temperature",
        version: 1,
        enabled: true,
        updatedAtMs: 1_000,
      }),
    );
    expect(next).toEqual(
      expect.objectContaining({
        key: "model.temperature",
        version: 2,
        defaultValue: { value: 0.3 },
        updatedAtMs: 1_100,
      }),
    );
  });

  it("matches environment, tenant, and attribute rules by priority", () => {
    const prodTenant = {
      id: "prod-tenant",
      priority: 20,
      environment: "prod",
      tenantId: "t1",
      value: "tenant-value",
    };
    expect(
      remoteConfigRuleMatches(prodTenant, {
        environment: "prod",
        tenantId: "t1",
      }),
    ).toBe(true);
    expect(remoteConfigRuleMatches(prodTenant, { environment: "dev", tenantId: "t1" })).toBe(false);

    const entry = createRemoteConfigEntry({
      key: "theme",
      defaultValue: "light",
      nowMs: 1_000,
      rules: [
        { id: "prod", priority: 10, environment: "prod", value: "dark" },
        { id: "tenant", priority: 20, environment: "prod", tenantId: "t1", value: "blue" },
      ],
    });
    expect(resolveRemoteConfig(entry, { environment: "prod", tenantId: "t1" })).toEqual({
      key: "theme",
      value: "blue",
      version: 1,
      source: "rule",
      ruleId: "tenant",
    });
    expect(resolveRemoteConfig(entry, { environment: "prod", tenantId: "t2" })).toEqual(
      expect.objectContaining({ value: "dark", ruleId: "prod" }),
    );
    expect(resolveRemoteConfig(entry, { environment: "dev", tenantId: "t1" })).toEqual(
      expect.objectContaining({ value: "light", source: "default" }),
    );
  });

  it("creates deterministic snapshots and ETags", () => {
    const entries = [
      createRemoteConfigEntry({ key: "b", defaultValue: 2, nowMs: 1_000 }),
      createRemoteConfigEntry({ key: "a", defaultValue: 1, nowMs: 1_000 }),
    ];
    const snapshot = createRemoteConfigSnapshot(entries, { environment: "prod", nowMs: 2_000 });

    expect(snapshot.values).toEqual({ a: 1, b: 2 });
    expect(snapshot.versions).toEqual({ a: 1, b: 1 });
    expect(snapshot.etag).toBe(remoteConfigEtag(snapshot.values, snapshot.versions));
    expect(snapshot.etag).toMatch(/^[a-f0-9]{64}$/);
  });

  it("runs a stateful upsert, resolve, snapshot, rollback, and delete flow", () => {
    let now = 1_000;
    const store = new MemoryRemoteConfigStore({ now: () => now });
    store.upsert({
      key: "agent.maxTokens",
      defaultValue: 4_000,
      rules: [{ id: "tenant-large", priority: 10, tenantId: "t1", value: 8_000 }],
    });

    expect(store.resolve("agent.maxTokens", { environment: "prod", tenantId: "t1" })).toEqual({
      key: "agent.maxTokens",
      value: 8_000,
      version: 1,
      source: "rule",
      ruleId: "tenant-large",
    });
    now = 1_100;
    store.upsert({ key: "agent.maxTokens", defaultValue: 2_000, rules: [] });
    expect(store.resolve("agent.maxTokens", { environment: "prod", tenantId: "t1" })).toEqual(
      expect.objectContaining({ value: 2_000, version: 2, source: "default" }),
    );
    expect(store.versions("agent.maxTokens").map((entry) => entry.version)).toEqual([1, 2]);

    now = 1_200;
    expect(store.rollback("agent.maxTokens", 1)).toEqual(
      expect.objectContaining({ version: 3, defaultValue: 4_000 }),
    );
    expect(store.snapshot({ environment: "prod", tenantId: "t1" })).toEqual(
      expect.objectContaining({
        environment: "prod",
        tenantId: "t1",
        values: { "agent.maxTokens": 8_000 },
        versions: { "agent.maxTokens": 3 },
      }),
    );
    expect(store.delete("agent.maxTokens")).toBe(true);
    expect(store.resolve("agent.maxTokens", { environment: "prod" })).toEqual({
      key: "agent.maxTokens",
      value: undefined,
      source: "missing",
    });
  });

  it("lists entries and keeps returned values isolated from store mutation", () => {
    const store = new MemoryRemoteConfigStore({ now: () => 1_000 });
    const entry = store.upsert({ key: "json", defaultValue: { nested: { value: 1 } } });
    (entry.defaultValue as { nested: { value: number } }).nested.value = 99;

    expect(store.get("json")?.defaultValue).toEqual({ nested: { value: 1 } });
    expect(store.list().map((item) => item.key)).toEqual(["json"]);
  });
});
