import { describe, expect, it } from "vitest";
import {
  buildRateLimitResponse,
  checkFixedWindow,
  checkSlidingWindow,
  checkTokenBucket,
  createRateLimitKey,
  parseForwardedFor,
} from "../src/mwh/modules/api-traffic/rate-limit-http/core.js";
import { MemoryRateLimitStore } from "../src/mwh/modules/api-traffic/rate-limit-http/memory-store.js";

describe("MWH rate-limit-http stateless algorithms", () => {
  it("fixed window allows up to the limit and denies until reset", () => {
    const first = checkFixedWindow({ nowMs: 0, windowMs: 1000, limit: 2 });
    expect(first).toMatchObject({ decision: "allow", remaining: 1, retryAfterMs: 0 });

    const second = checkFixedWindow({
      nowMs: 100,
      windowMs: 1000,
      limit: 2,
      state: first.state,
    });
    expect(second).toMatchObject({ decision: "allow", remaining: 0 });

    const denied = checkFixedWindow({
      nowMs: 200,
      windowMs: 1000,
      limit: 2,
      state: second.state,
    });
    expect(denied).toMatchObject({ decision: "deny", remaining: 0, retryAfterMs: 800 });

    const reset = checkFixedWindow({
      nowMs: 1000,
      windowMs: 1000,
      limit: 2,
      state: denied.state,
    });
    expect(reset).toMatchObject({ decision: "allow", remaining: 1, resetAtMs: 2000 });
  });

  it("token bucket supports burst capacity and time-based refill", () => {
    const burst = checkTokenBucket({ nowMs: 0, capacity: 3, refillPerMs: 0.01, cost: 3 });
    expect(burst).toMatchObject({ decision: "allow", remaining: 0 });

    const denied = checkTokenBucket({
      nowMs: 50,
      capacity: 3,
      refillPerMs: 0.01,
      state: burst.state,
    });
    expect(denied).toMatchObject({ decision: "deny", retryAfterMs: 50 });

    const allowed = checkTokenBucket({
      nowMs: 100,
      capacity: 3,
      refillPerMs: 0.01,
      state: denied.state,
    });
    expect(allowed).toMatchObject({ decision: "allow", remaining: 0 });
  });

  it("sliding window prunes expired events and denies until the oldest active event expires", () => {
    const first = checkSlidingWindow({ nowMs: 0, windowMs: 1000, limit: 2 });
    const second = checkSlidingWindow({
      nowMs: 100,
      windowMs: 1000,
      limit: 2,
      events: first.events,
    });
    const denied = checkSlidingWindow({
      nowMs: 500,
      windowMs: 1000,
      limit: 2,
      events: second.events,
    });
    expect(denied).toMatchObject({ decision: "deny", retryAfterMs: 500 });

    const allowed = checkSlidingWindow({
      nowMs: 1001,
      windowMs: 1000,
      limit: 2,
      events: denied.events,
    });
    expect(allowed).toMatchObject({ decision: "allow", remaining: 0 });
    expect(allowed.events).toHaveLength(2);
  });

  it("builds HTTP keys, headers, and retry responses", () => {
    expect(
      createRateLimitKey({
        routeId: "GET /v1/items",
        subjectId: "user-1",
        ip: "10.0.0.1",
        method: "get",
      }),
    ).toBe("GET:GET /v1/items:user-1");
    expect(parseForwardedFor("203.0.113.10, 10.0.0.1")).toBe("203.0.113.10");

    expect(
      buildRateLimitResponse({
        decision: "allow",
        limit: 10,
        remaining: 4,
        retryAfterMs: 0,
        resetAtMs: 5_000,
        nowMs: 1_000,
      }),
    ).toEqual({
      allowed: true,
      statusCode: 200,
      headers: {
        "RateLimit-Limit": "10",
        "RateLimit-Remaining": "4",
        "RateLimit-Reset": "4",
      },
    });
    expect(
      buildRateLimitResponse({
        decision: "deny",
        limit: 10,
        remaining: 0,
        retryAfterMs: 1_250,
        nowMs: 1_000,
      }),
    ).toEqual({
      allowed: false,
      statusCode: 429,
      headers: {
        "RateLimit-Limit": "10",
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": "2",
        "Retry-After": "2",
      },
    });
  });
});

describe("MWH rate-limit-http stateful memory store", () => {
  it("keeps counters isolated per key", () => {
    let now = 0;
    const store = new MemoryRateLimitStore({ now: () => now });

    expect(store.checkFixedWindow("user:a", { limit: 1, windowMs: 1000 }).decision).toBe("allow");
    expect(store.checkFixedWindow("user:a", { limit: 1, windowMs: 1000 }).decision).toBe("deny");
    expect(store.checkFixedWindow("user:b", { limit: 1, windowMs: 1000 }).decision).toBe("allow");

    now = 1000;
    expect(store.checkFixedWindow("user:a", { limit: 1, windowMs: 1000 }).decision).toBe("allow");
  });

  it("resets one key without clearing other limiter state", () => {
    const store = new MemoryRateLimitStore({ now: () => 0 });

    store.checkTokenBucket("user:a", { capacity: 1, refillPerMs: 0.001 });
    store.checkTokenBucket("user:b", { capacity: 1, refillPerMs: 0.001 });
    expect(store.checkTokenBucket("user:a", { capacity: 1, refillPerMs: 0.001 }).decision).toBe(
      "deny",
    );
    expect(store.checkTokenBucket("user:b", { capacity: 1, refillPerMs: 0.001 }).decision).toBe(
      "deny",
    );

    store.reset("user:a");
    expect(store.checkTokenBucket("user:a", { capacity: 1, refillPerMs: 0.001 }).decision).toBe(
      "allow",
    );
    expect(store.checkTokenBucket("user:b", { capacity: 1, refillPerMs: 0.001 }).decision).toBe(
      "deny",
    );
  });

  it("runs stateful HTTP fixed-window limiting with response headers and audit clones", () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore({ now: () => now });
    const request = {
      routeId: "POST /login",
      subjectId: "user-1",
      ip: "203.0.113.10",
      method: "post",
    };

    expect(store.checkHttpFixedWindow(request, { limit: 2, windowMs: 1_000 })).toEqual(
      expect.objectContaining({
        allowed: true,
        statusCode: 200,
        headers: expect.objectContaining({ "RateLimit-Remaining": "1" }),
      }),
    );
    expect(store.checkHttpFixedWindow(request, { limit: 2, windowMs: 1_000 })).toEqual(
      expect.objectContaining({
        allowed: true,
        headers: expect.objectContaining({ "RateLimit-Remaining": "0" }),
      }),
    );
    expect(store.checkHttpFixedWindow(request, { limit: 2, windowMs: 1_000 })).toEqual(
      expect.objectContaining({
        allowed: false,
        statusCode: 429,
        headers: expect.objectContaining({ "Retry-After": "1" }),
      }),
    );

    const audit = store.listAudit();
    audit[0]!.response.headers["RateLimit-Remaining"] = "mutated";
    expect(store.listAudit()[0]?.response.headers["RateLimit-Remaining"]).toBe("1");

    now = 2_000;
    expect(store.checkHttpFixedWindow(request, { limit: 2, windowMs: 1_000 })).toEqual(
      expect.objectContaining({
        allowed: true,
        headers: expect.objectContaining({ "RateLimit-Remaining": "1" }),
      }),
    );
  });
});
