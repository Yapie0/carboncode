import { describe, expect, it } from "vitest";
import {
  type BodyGuardPolicy,
  analyzeJsonShape,
  appendBodyChunk,
  byteLength,
  createBodyStreamState,
  evaluateRequestBody,
  finalizeBodyStream,
  normalizeContentType,
} from "../src/mwh/modules/api-traffic/request-body-guard/core.js";
import { MemoryRequestBodyGuard } from "../src/mwh/modules/api-traffic/request-body-guard/memory-guard.js";

const policy: BodyGuardPolicy = {
  routeId: "POST /users",
  maxBytes: 64,
  allowedContentTypes: ["application/json"],
  maxJsonDepth: 3,
  maxJsonFields: 4,
};

describe("MWH request-body-guard stateless core", () => {
  it("normalizes content type, measures bytes, and allows valid JSON", () => {
    expect(normalizeContentType("Application/JSON; charset=utf-8")).toBe("application/json");
    expect(byteLength("你好")).toBe(6);
    expect(
      evaluateRequestBody(policy, {
        routeId: "POST /users",
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({ name: "Ada" }),
      }),
    ).toEqual({ kind: "allow", routeId: "POST /users", statusCode: 200 });
  });

  it("rejects large bodies, unsupported content types, and invalid JSON", () => {
    expect(
      evaluateRequestBody(policy, {
        routeId: "POST /users",
        contentType: "application/json",
        contentLengthBytes: 65,
      }),
    ).toEqual(
      expect.objectContaining({ kind: "reject", statusCode: 413, reason: "body-too-large" }),
    );
    expect(
      evaluateRequestBody(policy, {
        routeId: "POST /users",
        contentType: "text/plain",
        body: "hello",
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "reject",
        statusCode: 415,
        reason: "content-type-not-allowed",
      }),
    );
    expect(
      evaluateRequestBody(policy, {
        routeId: "POST /users",
        contentType: "application/json",
        body: "{bad",
      }),
    ).toEqual(expect.objectContaining({ kind: "reject", statusCode: 400, reason: "json-invalid" }));
  });

  it("rejects excessive JSON depth and field count", () => {
    expect(analyzeJsonShape({ a: { b: 1 }, c: 2 })).toEqual({ depth: 3, fields: 3 });
    expect(
      evaluateRequestBody(policy, {
        routeId: "POST /users",
        contentType: "application/json",
        body: JSON.stringify({ a: { b: { c: 1 } } }),
      }),
    ).toEqual(
      expect.objectContaining({ kind: "reject", reason: "json-depth-exceeded", statusCode: 400 }),
    );
    expect(
      evaluateRequestBody(policy, {
        routeId: "POST /users",
        contentType: "application/json",
        body: JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5 }),
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "reject",
        reason: "json-field-count-exceeded",
        statusCode: 400,
      }),
    );
  });

  it("guards streaming body chunks before final JSON parsing", () => {
    const state = createBodyStreamState({
      routeId: "POST /users",
      contentType: "application/json",
    });
    const first = appendBodyChunk(policy, state, '{"name"');
    expect(first.decision).toBeUndefined();
    expect(first.state.receivedBytes).toBe(byteLength('{"name"'));

    const second = appendBodyChunk(policy, first.state, ':"Ada"}');
    expect(second.decision).toBeUndefined();
    expect(finalizeBodyStream(policy, second.state)).toEqual({
      kind: "allow",
      routeId: "POST /users",
      statusCode: 200,
    });

    const rejected = appendBodyChunk(policy, state, "x".repeat(65));
    expect(rejected.decision).toEqual(
      expect.objectContaining({ kind: "reject", reason: "body-too-large", statusCode: 413 }),
    );
    expect(finalizeBodyStream(policy, rejected.state)).toEqual(rejected.decision);
  });
});

describe("MWH request-body-guard stateful memory guard", () => {
  it("evaluates route policies, records audit entries, and keeps clone-safe policy reads", () => {
    let now = 1_000;
    const guard = new MemoryRequestBodyGuard({ policies: [policy], now: () => now });

    expect(
      guard.evaluate({
        routeId: "POST /users",
        contentType: "application/json",
        body: JSON.stringify({ name: "Ada" }),
      }).kind,
    ).toBe("allow");
    now = 1_010;
    guard.evaluate({
      routeId: "POST /users",
      contentType: "text/plain",
      body: "hello",
    });

    const policies = guard.listPolicies();
    policies[0]!.allowedContentTypes = ["mutated"];
    expect(guard.listPolicies()[0]?.allowedContentTypes).toEqual(["application/json"]);
    expect(guard.listAudit().map((entry) => entry.atMs)).toEqual([1_000, 1_010]);
  });

  it("updates policies and rejects missing route policies", () => {
    const guard = new MemoryRequestBodyGuard({ policies: [] });
    expect(() =>
      guard.evaluate({ routeId: "POST /users", contentType: "application/json", body: "{}" }),
    ).toThrow("route policy not found");

    guard.upsertPolicy({ ...policy, maxBytes: 2 });
    expect(
      guard.evaluate({
        routeId: "POST /users",
        contentType: "application/json",
        body: "{}",
      }).kind,
    ).toBe("allow");
    expect(
      guard.evaluate({
        routeId: "POST /users",
        contentType: "application/json",
        body: '{"a":1}',
      }).reason,
    ).toBe("body-too-large");
  });

  it("runs stateful streaming sessions with early rejection and audit", () => {
    let now = 2_000;
    const guard = new MemoryRequestBodyGuard({ policies: [policy], now: () => now });

    guard.startStream("s1", { routeId: "POST /users", contentType: "application/json" });
    expect(guard.appendStream("s1", '{"name"')).toBeUndefined();
    expect(guard.appendStream("s1", ':"Ada"}')).toBeUndefined();
    expect(guard.finalizeStream("s1")).toEqual({
      kind: "allow",
      routeId: "POST /users",
      statusCode: 200,
    });

    now = 2_010;
    guard.startStream("s2", { routeId: "POST /users", contentType: "application/json" });
    expect(guard.appendStream("s2", "x".repeat(65))).toEqual(
      expect.objectContaining({ kind: "reject", reason: "body-too-large" }),
    );
    expect(guard.finalizeStream("s2")).toEqual(
      expect.objectContaining({ kind: "reject", reason: "body-too-large" }),
    );
    expect(guard.listAudit().map((entry) => entry.atMs)).toEqual([2_000, 2_010]);
    expect(() => guard.appendStream("s2", "{}")).toThrow("stream session not found");
  });
});
