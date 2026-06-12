import { describe, expect, it } from "vitest";
import {
  acquireSingleFlightWork,
  createSingleFlightEntry,
  readSingleFlightEntry,
  releaseSingleFlightWork,
} from "../src/mwh/modules/cache-state/single-flight-cache/core.js";
import { MemorySingleFlightCache } from "../src/mwh/modules/cache-state/single-flight-cache/memory-store.js";

describe("MWH single-flight-cache middleware", () => {
  it("classifies stateless cache entries as hit, miss, or expired", () => {
    const entry = createSingleFlightEntry({ value: { id: "user-1" }, nowMs: 1_000, ttlMs: 500 });

    expect(readSingleFlightEntry({ entry, nowMs: 1_200 })).toEqual(
      expect.objectContaining({
        decision: "hit",
        value: { id: "user-1" },
        ageMs: 200,
        expiresAtMs: 1_500,
      }),
    );
    expect(readSingleFlightEntry({ nowMs: 1_200 })).toEqual({ decision: "miss" });
    expect(readSingleFlightEntry({ entry, nowMs: 1_500 })).toEqual(
      expect.objectContaining({ decision: "expired", ageMs: 500 }),
    );
  });

  it("runs stateless work acquisition, renewal, conflict, expiry, and release", () => {
    const first = acquireSingleFlightWork({
      owner: "req-a",
      nowMs: 1_000,
      ttlMs: 200,
    });
    expect(first).toEqual(expect.objectContaining({ acquired: true, reason: "available" }));

    expect(
      acquireSingleFlightWork({
        owner: "req-b",
        nowMs: 1_100,
        ttlMs: 200,
        state: first.state,
      }),
    ).toEqual(expect.objectContaining({ acquired: false, reason: "in-flight", retryAfterMs: 100 }));

    const renewed = acquireSingleFlightWork({
      owner: "req-a",
      nowMs: 1_100,
      ttlMs: 200,
      state: first.state,
    });
    expect(renewed).toEqual(expect.objectContaining({ acquired: true, reason: "same-owner" }));
    expect(releaseSingleFlightWork({ owner: "req-a", state: renewed.state })).toBeUndefined();
    expect(
      acquireSingleFlightWork({
        owner: "req-b",
        nowMs: 1_250,
        ttlMs: 200,
        state: first.state,
      }),
    ).toEqual(expect.objectContaining({ acquired: true, reason: "available" }));
  });

  it("coalesces concurrent stateful loads into one loader call and caches the result", async () => {
    let now = 1_000;
    let loaderCalls = 0;
    let release!: (value: string) => void;
    const loaded = new Promise<string>((resolve) => {
      release = resolve;
    });
    const cache = new MemorySingleFlightCache<string>({ now: () => now });

    const first = cache.getOrLoad("profile:1", {
      owner: "req-a",
      ttlMs: 500,
      workTtlMs: 200,
      loader: async () => {
        loaderCalls += 1;
        return loaded;
      },
    });
    const second = cache.getOrLoad("profile:1", {
      owner: "req-b",
      ttlMs: 500,
      workTtlMs: 200,
      loader: async () => {
        loaderCalls += 1;
        return "duplicate";
      },
    });

    await Promise.resolve();
    expect(loaderCalls).toBe(1);
    release("Ada");

    await expect(first).resolves.toEqual({ value: "Ada", source: "loader" });
    await expect(second).resolves.toEqual({ value: "Ada", source: "in-flight" });
    expect(loaderCalls).toBe(1);
    expect(
      await cache.getOrLoad("profile:1", {
        owner: "req-c",
        ttlMs: 500,
        workTtlMs: 200,
        loader: () => {
          loaderCalls += 1;
          return "fresh";
        },
      }),
    ).toEqual({ value: "Ada", source: "cache" });

    now = 1_600;
    expect(
      await cache.getOrLoad("profile:1", {
        owner: "req-d",
        ttlMs: 500,
        workTtlMs: 200,
        loader: () => {
          loaderCalls += 1;
          return "Grace";
        },
      }),
    ).toEqual({ value: "Grace", source: "loader" });
    expect(loaderCalls).toBe(2);
  });

  it("cleans up failed in-flight work, prunes expired entries, deletes state, and returns clone-safe snapshots", async () => {
    let now = 1_000;
    const cache = new MemorySingleFlightCache<string>({ now: () => now });

    await expect(
      cache.getOrLoad("profile:1", {
        owner: "req-a",
        ttlMs: 500,
        workTtlMs: 200,
        loader: () => {
          throw new Error("database down");
        },
      }),
    ).rejects.toThrow("database down");

    expect(cache.snapshot().work).toEqual([]);
    await expect(
      cache.getOrLoad("profile:1", {
        owner: "req-b",
        ttlMs: 500,
        workTtlMs: 200,
        loader: () => "Ada",
      }),
    ).resolves.toEqual({ value: "Ada", source: "loader" });

    const snapshot = cache.snapshot();
    snapshot.entries[0][1].value = "mutated";
    expect(cache.get("profile:1")).toEqual(expect.objectContaining({ value: "Ada" }));

    now = 1_600;
    expect(cache.pruneExpired()).toBe(1);
    expect(cache.get("profile:1")).toEqual(expect.objectContaining({ decision: "miss" }));

    cache.set("profile:2", "Grace", 500);
    expect(cache.delete("profile:2")).toBe(true);
    expect(cache.get("profile:2")).toEqual(expect.objectContaining({ decision: "miss" }));
  });
});
