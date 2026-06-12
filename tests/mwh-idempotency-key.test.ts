import { describe, expect, it } from "vitest";
import {
  cloneIdempotencyDecision,
  cloneIdempotencyRecord,
  completeIdempotencyRecord,
  evaluateIdempotency,
  fingerprintRequest,
} from "../src/mwh/modules/api-traffic/idempotency-key/core.js";
import { MemoryIdempotencyStore } from "../src/mwh/modules/api-traffic/idempotency-key/memory-store.js";

const request = {
  method: "post",
  route: "orders",
  actor: "user-1",
  body: { amount: 100, currency: "USD" },
};

describe("MWH idempotency-key stateless core", () => {
  it("builds stable fingerprints independent of JSON object key order", () => {
    const a = fingerprintRequest({
      method: "POST",
      route: "/orders",
      actor: "user-1",
      body: { amount: 100, currency: "USD" },
    });
    const b = fingerprintRequest({
      method: "post",
      route: "orders",
      actor: "user-1",
      body: { currency: "USD", amount: 100 },
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("starts a new record and replays a completed matching request", () => {
    const start = evaluateIdempotency({ key: "key-1", request, nowMs: 0, ttlMs: 1000 });
    expect(start.kind).toBe("start");
    if (start.kind !== "start") throw new Error("expected start");

    const completed = completeIdempotencyRecord(
      start.record,
      { statusCode: 201, body: { orderId: "ord-1" } },
      10,
    );
    const clonedRecord = cloneIdempotencyRecord(completed);
    (clonedRecord.response!.body as { orderId: string }).orderId = "mutated";
    expect(completed.response?.body).toEqual({ orderId: "ord-1" });

    const replay = evaluateIdempotency({
      key: "key-1",
      request,
      nowMs: 20,
      ttlMs: 1000,
      existing: completed,
    });

    expect(replay).toMatchObject({
      kind: "replay",
      response: { statusCode: 201, body: { orderId: "ord-1" } },
    });
    const clonedReplay = cloneIdempotencyDecision(replay);
    if (clonedReplay.kind !== "replay") throw new Error("expected replay");
    (clonedReplay.response.body as { orderId: string }).orderId = "mutated";
    expect(replay).toMatchObject({
      kind: "replay",
      response: { statusCode: 201, body: { orderId: "ord-1" } },
    });
  });

  it("rejects same key with a different request fingerprint", () => {
    const start = evaluateIdempotency({ key: "key-1", request, nowMs: 0, ttlMs: 1000 });
    if (start.kind !== "start") throw new Error("expected start");

    const conflict = evaluateIdempotency({
      key: "key-1",
      request: { ...request, body: { amount: 200, currency: "USD" } },
      nowMs: 10,
      ttlMs: 1000,
      existing: start.record,
    });

    expect(conflict).toMatchObject({
      kind: "conflict",
      reason: expect.stringContaining("different request fingerprint"),
    });
  });

  it("reports matching processing records as in-flight and starts fresh after expiry", () => {
    const start = evaluateIdempotency({ key: "key-1", request, nowMs: 0, ttlMs: 1000 });
    if (start.kind !== "start") throw new Error("expected start");

    const inFlight = evaluateIdempotency({
      key: "key-1",
      request,
      nowMs: 100,
      ttlMs: 1000,
      existing: start.record,
    });
    expect(inFlight).toMatchObject({ kind: "in-flight", retryAfterMs: 900 });

    const expired = evaluateIdempotency({
      key: "key-1",
      request,
      nowMs: 1000,
      ttlMs: 1000,
      existing: start.record,
    });
    expect(expired).toMatchObject({ kind: "expired", next: { status: "processing" } });
  });
});

describe("MWH idempotency-key stateful memory store", () => {
  it("reserves, completes, and replays a response", () => {
    let now = 0;
    const store = new MemoryIdempotencyStore({ ttlMs: 1000, now: () => now });

    expect(store.evaluate("key-1", request).kind).toBe("start");
    now = 25;
    const completed = store.complete("key-1", {
      statusCode: 201,
      body: { orderId: "ord-1" },
      headers: { location: "/orders/ord-1" },
    });
    (completed.response!.body as { orderId: string }).orderId = "mutated";
    completed.response!.headers!.location = "/mutated";
    expect(store.get("key-1")?.response).toEqual({
      statusCode: 201,
      body: { orderId: "ord-1" },
      headers: { location: "/orders/ord-1" },
    });

    now = 50;
    const replay = store.evaluate("key-1", request);
    expect(replay).toMatchObject({
      kind: "replay",
      response: {
        statusCode: 201,
        body: { orderId: "ord-1" },
        headers: { location: "/orders/ord-1" },
      },
    });
    if (replay.kind !== "replay") throw new Error("expected replay");
    (replay.response.body as { orderId: string }).orderId = "mutated-again";
    expect(store.evaluate("key-1", request)).toMatchObject({
      kind: "replay",
      response: { body: { orderId: "ord-1" } },
    });
  });

  it("keeps conflicts and TTL pruning stateful", () => {
    let now = 0;
    const store = new MemoryIdempotencyStore({ ttlMs: 1000, now: () => now });

    expect(store.evaluate("key-1", request).kind).toBe("start");
    expect(
      store.evaluate("key-1", { ...request, body: { amount: 200, currency: "USD" } }).kind,
    ).toBe("conflict");

    now = 1000;
    expect(store.pruneExpired()).toBe(1);
    expect(store.get("key-1")).toBeUndefined();
    expect(store.evaluate("key-1", request).kind).toBe("start");
  });
});
