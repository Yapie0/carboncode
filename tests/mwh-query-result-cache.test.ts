import { describe, expect, it } from "vitest";
import {
  createQueryCacheKey,
  createQueryCacheState,
  invalidateQueryCacheByTags,
  pruneExpiredQueryResults,
  putQueryResult,
  queryCacheSnapshot,
  readQueryResult,
} from "../src/mwh/modules/data-access/query-result-cache/core.js";
import { MemoryQueryResultCache } from "../src/mwh/modules/data-access/query-result-cache/memory-query-cache.js";

describe("MWH query-result-cache stateless core", () => {
  it("creates stable keys and returns fresh then stale hits", () => {
    const keyA = createQueryCacheKey({
      namespace: "users",
      sql: " SELECT  *  FROM users WHERE id = ? ",
      params: ["u1"],
    });
    const keyB = createQueryCacheKey({
      namespace: "users",
      sql: "select * from users where id = ?",
      params: ["u1"],
    });
    expect(keyA).toBe(keyB);

    let state = createQueryCacheState();
    const put = putQueryResult(state, {
      key: keyA,
      value: [{ id: "u1" }],
      tags: ["table:users", "user:u1"],
      nowMs: 1_000,
      policy: { ttlMs: 100, staleTtlMs: 200 },
    });
    state = put.state;

    const fresh = readQueryResult<typeof put.entry.value>(state, { key: keyA, nowMs: 1_050 });
    expect(fresh.lookup).toEqual(
      expect.objectContaining({
        kind: "fresh",
        shouldRefresh: false,
      }),
    );
    state = fresh.state;
    const stale = readQueryResult<typeof put.entry.value>(state, { key: keyA, nowMs: 1_150 });
    expect(stale.lookup).toEqual(
      expect.objectContaining({
        kind: "stale",
        shouldRefresh: true,
      }),
    );
    expect(stale.lookup.entry?.accessCount).toBe(2);
  });

  it("misses after stale expiry, prunes expired entries, and reports snapshots", () => {
    let state = createQueryCacheState();
    state = putQueryResult(state, {
      key: "query:1",
      value: { count: 1 },
      tags: ["table:orders"],
      nowMs: 1_000,
      policy: { ttlMs: 100, staleTtlMs: 100 },
    }).state;

    expect(queryCacheSnapshot(state, 1_050)).toEqual({
      totalEntries: 1,
      freshEntries: 1,
      staleEntries: 0,
      expiredEntries: 0,
    });
    expect(queryCacheSnapshot(state, 1_150)).toEqual({
      totalEntries: 1,
      freshEntries: 0,
      staleEntries: 1,
      expiredEntries: 0,
    });
    expect(readQueryResult(state, { key: "query:1", nowMs: 1_200 }).lookup).toEqual({
      kind: "miss",
      shouldRefresh: true,
    });
    const pruned = pruneExpiredQueryResults(state, 1_200);
    expect(pruned.prunedKeys).toEqual(["query:1"]);
    expect(pruned.state.entries).toEqual([]);
  });

  it("invalidates entries by dependency tags", () => {
    let state = createQueryCacheState();
    state = putQueryResult(state, {
      key: "users:u1",
      value: { id: "u1" },
      tags: ["table:users", "user:u1"],
      nowMs: 1_000,
      policy: { ttlMs: 100, staleTtlMs: 100 },
    }).state;
    state = putQueryResult(state, {
      key: "orders:u1",
      value: [{ id: "o1" }],
      tags: ["table:orders", "user:u1"],
      nowMs: 1_000,
      policy: { ttlMs: 100, staleTtlMs: 100 },
    }).state;

    const invalidated = invalidateQueryCacheByTags(state, ["table:users"]);

    expect(invalidated.invalidatedKeys).toEqual(["users:u1"]);
    expect(invalidated.state.entries.map((entry) => entry.key)).toEqual(["orders:u1"]);
  });
});

describe("MWH query-result-cache stateful memory cache", () => {
  it("reads, invalidates, prunes, and keeps clone-safe entries", () => {
    let now = 1_000;
    const cache = new MemoryQueryResultCache({
      now: () => now,
      policy: { ttlMs: 100, staleTtlMs: 100 },
    });
    cache.put({
      namespace: "users",
      sql: "select * from users where id = ?",
      params: ["u1"],
      tags: ["table:users", "user:u1"],
      value: [{ id: "u1" }],
    });

    const entries = cache.listEntries();
    entries[0]!.tags = ["mutated"];
    entries[0]!.value = [{ id: "mutated" }];
    expect(cache.listEntries()[0]?.tags).toEqual(["table:users", "user:u1"]);

    expect(
      cache.read<Array<{ id: string }>>({
        namespace: "users",
        sql: "select * from users where id = ?",
        params: ["u1"],
      }).kind,
    ).toBe("fresh");
    now = 1_150;
    expect(
      cache.read<Array<{ id: string }>>({
        namespace: "users",
        sql: "select * from users where id = ?",
        params: ["u1"],
      }).kind,
    ).toBe("stale");
    expect(cache.invalidateTags(["user:u1"])).toHaveLength(1);
    expect(cache.snapshot().totalEntries).toBe(0);
  });

  it("prunes expired query results by deterministic time", () => {
    let now = 1_000;
    const cache = new MemoryQueryResultCache({
      now: () => now,
      policy: { ttlMs: 50, staleTtlMs: 50 },
    });
    cache.put({
      namespace: "orders",
      sql: "select count(*) from orders",
      tags: ["table:orders"],
      value: { count: 1 },
    });

    now = 1_100;
    expect(cache.pruneExpired()).toHaveLength(1);
    expect(cache.read({ namespace: "orders", sql: "select count(*) from orders" })).toEqual({
      kind: "miss",
      shouldRefresh: true,
    });
  });

  it("loads misses, coalesces concurrent refreshes, and supports stale-while-refresh", async () => {
    let now = 1_000;
    let loadCount = 0;
    const cache = new MemoryQueryResultCache({
      now: () => now,
      policy: { ttlMs: 100, staleTtlMs: 1_000 },
    });
    const request = {
      namespace: "users",
      sql: "select * from users where id = ?",
      params: ["u1"],
      tags: ["table:users", "user:u1"],
    };
    const loader = async () => {
      loadCount += 1;
      return [{ id: "u1", version: loadCount }];
    };

    const [first, second] = await Promise.all([
      cache.getOrLoad({ ...request, loader }),
      cache.getOrLoad({ ...request, loader }),
    ]);
    expect(first.entry?.value).toEqual([{ id: "u1", version: 1 }]);
    expect(second.entry?.value).toEqual([{ id: "u1", version: 1 }]);
    expect(loadCount).toBe(1);

    now = 1_150;
    const stale = await cache.getOrLoad({
      ...request,
      allowStaleWhileRefresh: true,
      loader,
    });
    expect(stale.kind).toBe("stale");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadCount).toBe(2);
    expect(cache.read<Array<{ id: string; version: number }>>(request).entry?.value).toEqual([
      { id: "u1", version: 2 },
    ]);
  });
});
