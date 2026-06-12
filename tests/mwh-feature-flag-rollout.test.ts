import { describe, expect, it } from "vitest";
import {
  evaluateFeatureFlag,
  evaluateFeatureFlagWithPrerequisites,
  matchesRule,
  mergeFeatureFlag,
  stableBucket,
} from "../src/mwh/modules/feature-config/feature-flag-rollout/core.js";
import { MemoryFeatureFlagStore } from "../src/mwh/modules/feature-config/feature-flag-rollout/memory-store.js";

describe("MWH feature-flag-rollout middleware", () => {
  it("evaluates missing, disabled, allow, and deny decisions", () => {
    expect(evaluateFeatureFlag(undefined, { subjectKey: "u1" })).toEqual({
      enabled: false,
      reason: "missing",
    });
    expect(
      evaluateFeatureFlag(
        { key: "new-ui", enabled: false, defaultValue: true },
        { subjectKey: "u1" },
      ),
    ).toEqual({ enabled: false, reason: "disabled" });
    expect(
      evaluateFeatureFlag(
        {
          key: "new-ui",
          enabled: true,
          defaultValue: false,
          allowSubjects: ["u1"],
          denySubjects: ["u2"],
        },
        { subjectKey: "u1" },
      ),
    ).toEqual({ enabled: true, reason: "allow-override" });
    expect(
      evaluateFeatureFlag(
        {
          key: "new-ui",
          enabled: true,
          defaultValue: true,
          allowSubjects: ["u2"],
          denySubjects: ["u2"],
        },
        { subjectKey: "u2" },
      ),
    ).toEqual({ enabled: false, reason: "deny-override" });
  });

  it("matches attribute rules before percentage rollout", () => {
    const flag = {
      key: "billing-v2",
      enabled: true,
      defaultValue: false,
      rolloutPercentage: 0,
      rules: [
        {
          id: "enterprise-plan",
          attribute: "plan",
          operator: "equals" as const,
          values: ["enterprise"],
          enabled: true,
        },
      ],
    };

    expect(
      evaluateFeatureFlag(flag, { subjectKey: "u1", attributes: { plan: "enterprise" } }),
    ).toEqual({
      enabled: true,
      reason: "rule-match",
      ruleId: "enterprise-plan",
    });
    expect(matchesRule(flag.rules[0], { subjectKey: "u2", attributes: { plan: "free" } })).toBe(
      false,
    );
  });

  it("evaluates prerequisite flags before local rollout rules", () => {
    const flags = new Map([
      ["base", { key: "base", enabled: true, defaultValue: false, allowSubjects: ["u1"] }],
      [
        "child",
        {
          key: "child",
          enabled: true,
          defaultValue: true,
          prerequisites: [{ key: "base", expected: true }],
        },
      ],
    ]);

    expect(
      evaluateFeatureFlagWithPrerequisites(flags.get("child"), { subjectKey: "u1" }, (key) =>
        flags.get(key),
      ),
    ).toEqual({ enabled: true, reason: "default" });
    expect(
      evaluateFeatureFlagWithPrerequisites(flags.get("child"), { subjectKey: "u2" }, (key) =>
        flags.get(key),
      ),
    ).toEqual({
      enabled: false,
      reason: "prerequisite-failed",
      prerequisiteKey: "base",
    });

    const cyclic = new Map([
      [
        "a",
        {
          key: "a",
          enabled: true,
          defaultValue: true,
          prerequisites: [{ key: "b", expected: true }],
        },
      ],
      [
        "b",
        {
          key: "b",
          enabled: true,
          defaultValue: true,
          prerequisites: [{ key: "a", expected: true }],
        },
      ],
    ]);
    expect(() =>
      evaluateFeatureFlagWithPrerequisites(cyclic.get("a"), { subjectKey: "u1" }, (key) =>
        cyclic.get(key),
      ),
    ).toThrow("feature flag prerequisite cycle");
  });

  it("uses deterministic percentage buckets", () => {
    const first = stableBucket({ flagKey: "new-ui", subjectKey: "u1", salt: "prod" });
    const second = stableBucket({ flagKey: "new-ui", subjectKey: "u1", salt: "prod" });
    const other = stableBucket({ flagKey: "new-ui", subjectKey: "u2", salt: "prod" });

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10_000);
    expect(other).not.toBe(first);

    expect(
      evaluateFeatureFlag(
        { key: "new-ui", enabled: true, defaultValue: false, rolloutPercentage: 100 },
        { subjectKey: "u1" },
      ),
    ).toEqual(expect.objectContaining({ enabled: true, reason: "percentage" }));
    expect(
      evaluateFeatureFlag(
        { key: "new-ui", enabled: true, defaultValue: true, rolloutPercentage: 0 },
        { subjectKey: "u1" },
      ),
    ).toEqual(expect.objectContaining({ enabled: false, reason: "percentage" }));
  });

  it("merges flag patches while preserving existing fields", () => {
    const initial = mergeFeatureFlag(undefined, {
      key: "search-v2",
      enabled: true,
      defaultValue: false,
      rolloutPercentage: 10,
    });
    const patched = mergeFeatureFlag(initial, {
      key: "search-v2",
      rolloutPercentage: 50,
    });

    expect(patched).toEqual(
      expect.objectContaining({
        key: "search-v2",
        enabled: true,
        defaultValue: false,
        rolloutPercentage: 50,
      }),
    );
  });

  it("runs a stateful upsert, evaluate, list, and delete flow", () => {
    const store = new MemoryFeatureFlagStore();

    store.upsert({
      key: "checkout-v2",
      enabled: true,
      defaultValue: false,
      rolloutPercentage: 0,
      allowSubjects: ["u1"],
    });
    expect(store.evaluate("checkout-v2", { subjectKey: "u1" })).toEqual({
      enabled: true,
      reason: "allow-override",
    });
    expect(store.evaluate("checkout-v2", { subjectKey: "u2" })).toEqual(
      expect.objectContaining({ enabled: false, reason: "percentage" }),
    );

    store.upsert({ key: "checkout-v2", rolloutPercentage: 100 });
    expect(store.evaluate("checkout-v2", { subjectKey: "u2" })).toEqual(
      expect.objectContaining({ enabled: true, reason: "percentage" }),
    );
    expect(store.list()).toHaveLength(1);
    expect(store.delete("checkout-v2")).toBe(true);
    expect(store.evaluate("checkout-v2", { subjectKey: "u1" })).toEqual({
      enabled: false,
      reason: "missing",
    });
  });

  it("runs a stateful prerequisite rollout flow and returns cloned configs", () => {
    const store = new MemoryFeatureFlagStore();
    store.upsert({
      key: "base",
      enabled: true,
      defaultValue: false,
      allowSubjects: ["u1"],
    });
    const child = store.upsert({
      key: "child",
      enabled: true,
      defaultValue: true,
      prerequisites: [{ key: "base", expected: true }],
    });
    child.prerequisites![0]!.key = "mutated";

    expect(store.evaluate("child", { subjectKey: "u1" })).toEqual({
      enabled: true,
      reason: "default",
    });
    expect(store.evaluate("child", { subjectKey: "u2" })).toEqual({
      enabled: false,
      reason: "prerequisite-failed",
      prerequisiteKey: "base",
    });
    expect(store.get("child")?.prerequisites?.[0]?.key).toBe("base");
  });
});
