import { describe, expect, it } from "vitest";
import {
  createTrafficEndpoint,
  createTrafficPolicy,
  matchTrafficRule,
  routeTraffic,
  selectWeightedEndpoint,
  stableHash,
  updateTrafficEndpointStatus,
} from "../src/mwh/modules/service-governance/traffic-policy-router/core.js";
import { MemoryTrafficPolicyRouter } from "../src/mwh/modules/service-governance/traffic-policy-router/memory-router.js";

describe("MWH traffic-policy-router middleware", () => {
  it("creates validated policies, matches rules, and keeps endpoint metadata clone-safe", () => {
    const stable = createTrafficEndpoint({
      id: "stable",
      url: "https://api.example.com",
      weight: 90,
      metadata: { version: "stable" },
    });
    const canary = createTrafficEndpoint({
      id: "canary",
      url: "https://api-canary.example.com",
      weight: 10,
      metadata: { version: "canary" },
    });
    const policy = createTrafficPolicy({
      serviceName: "api",
      endpoints: [canary, stable],
      rules: [
        {
          id: "beta",
          priority: 10,
          match: { cohort: "beta" },
          endpointIds: ["canary"],
        },
      ],
    });
    stable.metadata.version = "mutated";

    expect(policy.endpoints.map((endpoint) => endpoint.id)).toEqual(["canary", "stable"]);
    expect(policy.endpoints.find((endpoint) => endpoint.id === "stable")?.metadata).toEqual({
      version: "stable",
    });
    expect(matchTrafficRule(policy.rules[0]!, { cohort: "beta" })).toBe(true);
    expect(matchTrafficRule(policy.rules[0]!, { cohort: "general" })).toBe(false);
    expect(() =>
      createTrafficPolicy({
        serviceName: "api",
        endpoints: [stable],
        rules: [{ id: "bad", priority: 0, match: { x: "1" }, endpointIds: ["missing"] }],
      }),
    ).toThrow("unknown rule endpoint");
  });

  it("routes matching canary rules before fallback routes", () => {
    const policy = createTrafficPolicy({
      serviceName: "api",
      endpoints: [
        createTrafficEndpoint({ id: "stable", url: "https://stable", weight: 100 }),
        createTrafficEndpoint({ id: "canary", url: "https://canary", weight: 1 }),
      ],
      rules: [{ id: "beta", priority: 10, match: { cohort: "beta" }, endpointIds: ["canary"] }],
      fallbackEndpointIds: ["stable"],
    });

    expect(
      routeTraffic(
        policy,
        { serviceName: "api", key: "user-1", attributes: { cohort: "beta" } },
        { nowMs: 1_000 },
      ),
    ).toEqual(
      expect.objectContaining({
        endpoint: expect.objectContaining({ id: "canary" }),
        reason: "rule",
        ruleId: "beta",
        decidedAtMs: 1_000,
      }),
    );
    expect(routeTraffic(policy, { serviceName: "api", key: "user-2" }, { nowMs: 1_100 })).toEqual(
      expect.objectContaining({
        endpoint: expect.objectContaining({ id: "stable" }),
        reason: "fallback",
      }),
    );
  });

  it("filters unhealthy endpoints and can optionally include degraded endpoints", () => {
    const strictPolicy = createTrafficPolicy({
      serviceName: "api",
      endpoints: [
        createTrafficEndpoint({
          id: "stable",
          url: "https://stable",
          weight: 1,
          status: "unhealthy",
        }),
        createTrafficEndpoint({
          id: "degraded",
          url: "https://degraded",
          weight: 1,
          status: "degraded",
        }),
      ],
    });
    const relaxedPolicy = createTrafficPolicy({
      ...strictPolicy,
      includeDegraded: true,
    });

    expect(
      selectWeightedEndpoint(strictPolicy, ["stable", "degraded"], stableHash("x")),
    ).toBeNull();
    expect(selectWeightedEndpoint(relaxedPolicy, ["stable", "degraded"], stableHash("x"))).toEqual(
      expect.objectContaining({ id: "degraded" }),
    );
    expect(
      updateTrafficEndpointStatus(strictPolicy, { endpointId: "stable", status: "healthy" }),
    ).toEqual(
      expect.objectContaining({
        endpoints: expect.arrayContaining([
          expect.objectContaining({ id: "stable", status: "healthy" }),
        ]),
      }),
    );
  });

  it("selects weighted endpoints deterministically from a stable hash", () => {
    const policy = createTrafficPolicy({
      serviceName: "api",
      endpoints: [
        createTrafficEndpoint({ id: "a", url: "https://a", weight: 1 }),
        createTrafficEndpoint({ id: "b", url: "https://b", weight: 3 }),
      ],
    });
    const first = routeTraffic(policy, { serviceName: "api", key: "tenant-1" }, { nowMs: 1_000 });
    const second = routeTraffic(policy, { serviceName: "api", key: "tenant-1" }, { nowMs: 1_500 });
    const other = routeTraffic(policy, { serviceName: "api", key: "tenant-2" }, { nowMs: 1_500 });

    expect(first.endpoint?.id).toBe(second.endpoint?.id);
    expect(first.hash).toBe(stableHash("api:tenant-1"));
    expect(other.hash).toBe(stableHash("api:tenant-2"));
  });

  it("runs stateful policy upsert, route, status update, missing-policy, and history flows", () => {
    let now = 1_000;
    const router = new MemoryTrafficPolicyRouter({ now: () => now });
    router.upsertPolicy({
      serviceName: "api",
      endpoints: [
        createTrafficEndpoint({ id: "stable", url: "https://stable", weight: 1 }),
        createTrafficEndpoint({ id: "canary", url: "https://canary", weight: 1 }),
      ],
      rules: [{ id: "beta", priority: 10, match: { cohort: "beta" }, endpointIds: ["canary"] }],
      fallbackEndpointIds: ["stable"],
    });

    expect(router.route({ serviceName: "missing", key: "u1" })).toBeNull();
    expect(router.route({ serviceName: "api", key: "u1", attributes: { cohort: "beta" } })).toEqual(
      expect.objectContaining({ endpoint: expect.objectContaining({ id: "canary" }) }),
    );
    now = 1_100;
    router.updateEndpointStatus({ serviceName: "api", endpointId: "canary", status: "unhealthy" });
    expect(router.route({ serviceName: "api", key: "u1", attributes: { cohort: "beta" } })).toEqual(
      expect.objectContaining({ endpoint: null, reason: "no-endpoint" }),
    );
    expect(router.listDecisions().map((decision) => decision.reason)).toEqual([
      "rule",
      "no-endpoint",
    ]);

    const policy = router.getPolicy("api");
    if (!policy) throw new Error("policy missing");
    policy.endpoints[0]!.metadata.mutated = "true";
    expect(router.getPolicy("api")?.endpoints[0]?.metadata).toEqual({});
  });
});
