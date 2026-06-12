import { describe, expect, it } from "vitest";
import {
  type HeaderPolicy,
  evaluateRequestHeaders,
  headerByteLength,
  normalizeHeaderName,
  normalizeHeaders,
} from "../src/mwh/modules/api-traffic/request-header-policy/core.js";
import { MemoryRequestHeaderPolicy } from "../src/mwh/modules/api-traffic/request-header-policy/memory-guard.js";

const policy: HeaderPolicy = {
  routeId: "POST /orders",
  requiredHeaders: [{ name: "x-tenant-id" }, { name: "accept", oneOf: ["application/json"] }],
  allowedHeaderNames: ["content-type", "accept", "x-tenant-id", "idempotency-key"],
  blockedHeaderNames: ["x-internal-role"],
  maxHeaderBytes: 64,
  maxTotalHeaderBytes: 128,
};

describe("MWH request-header-policy stateless core", () => {
  it("normalizes names, measures bytes, merges repeated values, and allows valid headers", () => {
    expect(normalizeHeaderName(" X-Tenant-ID ")).toBe("x-tenant-id");
    expect(headerByteLength("x-tenant-id", "tenant-1")).toBe(21);
    expect(normalizeHeaders({ ACCEPT: ["application/json", "text/plain"] })).toEqual([
      { name: "accept", value: "application/json,text/plain", bytes: 35 },
    ]);
    expect(
      evaluateRequestHeaders(policy, {
        routeId: "POST /orders",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Tenant-ID": "tenant-1",
          "Idempotency-Key": "key-1",
        },
      }),
    ).toEqual({ kind: "allow", routeId: "POST /orders", statusCode: 200 });
  });

  it("rejects missing required headers, value mismatch, blocked headers, and allowlist violations", () => {
    expect(
      evaluateRequestHeaders(policy, {
        routeId: "POST /orders",
        headers: { accept: "application/json" },
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "reject",
        reason: "header-required",
        headerName: "x-tenant-id",
        statusCode: 400,
      }),
    );
    expect(
      evaluateRequestHeaders(policy, {
        routeId: "POST /orders",
        headers: { accept: "text/plain", "x-tenant-id": "tenant-1" },
      }),
    ).toEqual(expect.objectContaining({ reason: "header-value-mismatch", statusCode: 400 }));
    expect(
      evaluateRequestHeaders(policy, {
        routeId: "POST /orders",
        headers: {
          accept: "application/json",
          "x-tenant-id": "tenant-1",
          "x-internal-role": "admin",
        },
      }),
    ).toEqual(expect.objectContaining({ reason: "header-blocked", statusCode: 400 }));
    expect(
      evaluateRequestHeaders(policy, {
        routeId: "POST /orders",
        headers: { accept: "application/json", "x-tenant-id": "tenant-1", "x-debug": "1" },
      }),
    ).toEqual(expect.objectContaining({ reason: "header-not-allowed", statusCode: 400 }));
  });

  it("rejects single oversized headers and total oversized headers", () => {
    expect(
      evaluateRequestHeaders(policy, {
        routeId: "POST /orders",
        headers: {
          accept: "application/json",
          "x-tenant-id": "tenant-1",
          "idempotency-key": "x".repeat(80),
        },
      }),
    ).toEqual(expect.objectContaining({ reason: "header-too-large", statusCode: 431 }));
    expect(
      evaluateRequestHeaders(
        { ...policy, maxHeaderBytes: 256, maxTotalHeaderBytes: 40 },
        {
          routeId: "POST /orders",
          headers: {
            accept: "application/json",
            "x-tenant-id": "tenant-1",
            "idempotency-key": "key-1",
          },
        },
      ),
    ).toEqual(expect.objectContaining({ reason: "headers-too-large", statusCode: 431 }));
  });
});

describe("MWH request-header-policy stateful memory guard", () => {
  it("evaluates route policies, records audit entries, and keeps clone-safe policy reads", () => {
    let now = 1_000;
    const guard = new MemoryRequestHeaderPolicy({ policies: [policy], now: () => now });

    expect(
      guard.evaluate({
        routeId: "POST /orders",
        headers: { accept: "application/json", "x-tenant-id": "tenant-1" },
      }).kind,
    ).toBe("allow");
    now = 1_010;
    guard.evaluate({
      routeId: "POST /orders",
      headers: { accept: "application/json" },
    });

    const policies = guard.listPolicies();
    policies[0]!.allowedHeaderNames = ["mutated"];
    policies[0]!.requiredHeaders![1]!.oneOf = ["mutated"];
    expect(guard.listPolicies()[0]?.allowedHeaderNames).toEqual([
      "content-type",
      "accept",
      "x-tenant-id",
      "idempotency-key",
    ]);
    expect(guard.listPolicies()[0]?.requiredHeaders?.[1]?.oneOf).toEqual(["application/json"]);
    expect(guard.listAudit().map((entry) => entry.atMs)).toEqual([1_000, 1_010]);
  });

  it("updates policies and rejects missing route policies", () => {
    const guard = new MemoryRequestHeaderPolicy({ policies: [] });
    expect(() =>
      guard.evaluate({ routeId: "POST /orders", headers: { accept: "application/json" } }),
    ).toThrow("route policy not found");

    guard.upsertPolicy({
      routeId: "POST /orders",
      requiredHeaders: [{ name: "x-tenant-id", equals: "tenant-1" }],
    });
    expect(
      guard.evaluate({
        routeId: "POST /orders",
        headers: { "x-tenant-id": "tenant-1", "x-debug": "1" },
      }).kind,
    ).toBe("allow");
    expect(
      guard.evaluate({
        routeId: "POST /orders",
        headers: { "x-tenant-id": "tenant-2" },
      }).reason,
    ).toBe("header-value-mismatch");
  });
});
