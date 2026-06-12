import { describe, expect, it } from "vitest";
import {
  acquireRefreshLease,
  cloneCacheEntry,
  cloneCacheReadResult,
  createCacheEntry,
  planCacheAsideRead,
  readCacheEntry,
  releaseRefreshLease,
  resolveCacheAsideLoad,
} from "../src/mwh/modules/cache-state/cache-aside/core.js";
import { MemoryCacheAsideStore } from "../src/mwh/modules/cache-state/cache-aside/memory-store.js";

describe("MWH cache-aside middleware", () => {
  it("classifies stateless cache entries as hit, stale, or miss", () => {
    const entry = createCacheEntry({
      value: { id: "user-1" },
      nowMs: 1_000,
      ttlMs: 500,
      staleTtlMs: 1_000,
    });

    expect(readCacheEntry({ nowMs: 1_200, entry })).toEqual(
      expect.objectContaining({
        decision: "hit",
        value: { id: "user-1" },
        shouldRefresh: false,
      }),
    );
    expect(readCacheEntry({ nowMs: 1_600, entry })).toEqual(
      expect.objectContaining({
        decision: "stale",
        value: { id: "user-1" },
        shouldRefresh: true,
      }),
    );
    expect(readCacheEntry({ nowMs: 2_500, entry })).toEqual(
      expect.objectContaining({
        decision: "miss",
        shouldRefresh: true,
      }),
    );

    const clonedEntry = cloneCacheEntry(entry, (value) => ({ ...value }));
    clonedEntry.value.id = "mutated";
    expect(entry.value).toEqual({ id: "user-1" });
    const clonedRead = cloneCacheReadResult(readCacheEntry({ nowMs: 1_200, entry }), (value) => ({
      ...value,
    }));
    clonedRead.value!.id = "mutated-again";
    expect(entry.value).toEqual({ id: "user-1" });
  });

  it("uses refresh leases to avoid duplicate stale refresh work", () => {
    const first = acquireRefreshLease({
      nowMs: 1_000,
      owner: "req-a",
      ttlMs: 250,
    });
    expect(first).toEqual(
      expect.objectContaining({
        acquired: true,
        reason: "available",
      }),
    );

    const second = acquireRefreshLease({
      nowMs: 1_100,
      owner: "req-b",
      ttlMs: 250,
      state: first.state,
    });
    expect(second).toEqual(
      expect.objectContaining({
        acquired: false,
        reason: "held",
        retryAfterMs: 150,
      }),
    );

    const renewed = acquireRefreshLease({
      nowMs: 1_150,
      owner: "req-a",
      ttlMs: 250,
      state: first.state,
    });
    expect(renewed).toEqual(expect.objectContaining({ acquired: true, reason: "same-owner" }));
    expect(releaseRefreshLease({ owner: "req-a", state: renewed.state })).toBeUndefined();
  });

  it("plans cache-aside load behavior for hit, stale, and miss reads", () => {
    const hit = readCacheEntry({
      nowMs: 1_000,
      entry: createCacheEntry({ value: "fresh", nowMs: 900, ttlMs: 200 }),
    });
    expect(planCacheAsideRead({ read: hit })).toEqual({
      response: hit,
      serveCachedValue: true,
      runLoader: false,
      writeLoadedValue: false,
      backgroundRefresh: false,
    });

    const stale = readCacheEntry({
      nowMs: 1_200,
      entry: createCacheEntry({ value: "old", nowMs: 900, ttlMs: 100, staleTtlMs: 500 }),
    });
    expect(
      planCacheAsideRead({
        read: stale,
        refreshLease: acquireRefreshLease({ nowMs: 1_200, owner: "a", ttlMs: 100 }),
      }),
    ).toEqual(
      expect.objectContaining({
        serveCachedValue: true,
        runLoader: true,
        writeLoadedValue: true,
        backgroundRefresh: true,
      }),
    );

    expect(planCacheAsideRead({ read: { decision: "miss", shouldRefresh: true } })).toEqual(
      expect.objectContaining({
        serveCachedValue: false,
        runLoader: true,
        writeLoadedValue: true,
        backgroundRefresh: false,
      }),
    );
  });

  it("resolves loader success and stale-on-error fallback", () => {
    const stale = readCacheEntry({
      nowMs: 1_200,
      entry: createCacheEntry({ value: "old", nowMs: 900, ttlMs: 100, staleTtlMs: 500 }),
    });

    expect(resolveCacheAsideLoad({ current: stale, loaded: "new" })).toEqual({
      decision: "hit",
      value: "new",
      shouldRefresh: false,
    });
    expect(resolveCacheAsideLoad({ current: stale, error: new Error("origin down") })).toEqual(
      expect.objectContaining({
        decision: "stale",
        value: "old",
        shouldRefresh: true,
      }),
    );
    expect(
      resolveCacheAsideLoad({
        current: { decision: "miss", shouldRefresh: true },
        error: new Error("origin down"),
      }),
    ).toEqual({ decision: "miss", shouldRefresh: true });
  });

  it("stores, serves stale data, invalidates, and prunes expired entries", () => {
    let now = 1_000;
    const store = new MemoryCacheAsideStore<string>({ now: () => now });

    expect(store.get("profile:1")).toEqual(
      expect.objectContaining({ decision: "miss", shouldRefresh: true }),
    );
    store.set("profile:1", "Ada", { ttlMs: 100, staleTtlMs: 300 });
    expect(store.get("profile:1")).toEqual(expect.objectContaining({ decision: "hit" }));

    now = 1_150;
    expect(store.get("profile:1")).toEqual(
      expect.objectContaining({ decision: "stale", value: "Ada" }),
    );

    expect(store.acquireRefreshLease("profile:1", { owner: "req-a", ttlMs: 200 })).toEqual(
      expect.objectContaining({ acquired: true }),
    );
    expect(store.acquireRefreshLease("profile:1", { owner: "req-b", ttlMs: 200 })).toEqual(
      expect.objectContaining({ acquired: false }),
    );
    store.releaseRefreshLease("profile:1", "req-a");
    expect(store.acquireRefreshLease("profile:1", { owner: "req-b", ttlMs: 200 })).toEqual(
      expect.objectContaining({ acquired: true }),
    );

    now = 1_500;
    expect(store.pruneExpired()).toBe(1);
    expect(store.size()).toBe(0);
    expect(store.get("profile:1")).toEqual(expect.objectContaining({ decision: "miss" }));
  });

  it("keeps object values isolated when a clone strategy is configured", async () => {
    let now = 1_000;
    type Profile = { name: string; tags: string[] };
    const store = new MemoryCacheAsideStore<Profile>({
      now: () => now,
      cloneValue: (value) => ({ ...value, tags: [...value.tags] }),
    });

    const source = { name: "Ada", tags: ["math"] };
    const written = store.set("profile:1", source, { ttlMs: 100, staleTtlMs: 300 });
    source.tags.push("mutated-source");
    written.value.tags.push("mutated-return");
    expect(store.get("profile:1").value).toEqual({ name: "Ada", tags: ["math"] });

    const hit = store.get("profile:1");
    hit.value!.tags.push("mutated-hit");
    expect(store.get("profile:1").value).toEqual({ name: "Ada", tags: ["math"] });

    now = 1_150;
    const stale = await store.getOrLoad(
      "profile:1",
      () => ({ name: "Grace", tags: ["compiler"] }),
      { ttlMs: 100, staleTtlMs: 300, owner: "req-a", leaseTtlMs: 100 },
    );
    stale.value!.tags.push("mutated-load-result");
    expect(store.get("profile:1").value).toEqual({ name: "Grace", tags: ["compiler"] });
  });

  it("deletes cached entries and their refresh leases together", () => {
    const store = new MemoryCacheAsideStore<string>({ now: () => 1_000 });
    store.set("k", "v", { ttlMs: 100 });
    store.acquireRefreshLease("k", { owner: "a", ttlMs: 100 });

    expect(store.delete("k")).toBe(true);
    expect(store.get("k")).toEqual(expect.objectContaining({ decision: "miss" }));
    expect(store.acquireRefreshLease("k", { owner: "b", ttlMs: 100 })).toEqual(
      expect.objectContaining({ acquired: true }),
    );
  });

  it("runs stateful get-or-load flows for miss, stale refresh, lease contention, and errors", async () => {
    let now = 1_000;
    const store = new MemoryCacheAsideStore<string>({ now: () => now });

    await expect(
      store.getOrLoad("profile:2", () => "Grace", {
        ttlMs: 100,
        staleTtlMs: 300,
        owner: "req-a",
        leaseTtlMs: 200,
      }),
    ).resolves.toEqual({ decision: "hit", value: "Grace", shouldRefresh: false });
    expect(store.get("profile:2")).toEqual(expect.objectContaining({ decision: "hit" }));

    now = 1_150;
    expect(store.acquireRefreshLease("profile:2", { owner: "req-other", ttlMs: 200 })).toEqual(
      expect.objectContaining({ acquired: true }),
    );
    await expect(
      store.getOrLoad("profile:2", () => "Updated", {
        ttlMs: 100,
        staleTtlMs: 300,
        owner: "req-b",
        leaseTtlMs: 200,
      }),
    ).resolves.toEqual(expect.objectContaining({ decision: "stale", value: "Grace" }));
    store.releaseRefreshLease("profile:2", "req-other");

    await expect(
      store.getOrLoad("profile:2", () => "Updated", {
        ttlMs: 100,
        staleTtlMs: 300,
        owner: "req-c",
        leaseTtlMs: 200,
      }),
    ).resolves.toEqual({ decision: "hit", value: "Updated", shouldRefresh: false });
    expect(store.get("profile:2")).toEqual(expect.objectContaining({ value: "Updated" }));

    now = 1_300;
    await expect(
      store.getOrLoad(
        "profile:2",
        () => {
          throw new Error("origin down");
        },
        { ttlMs: 100, staleTtlMs: 300, owner: "req-d", leaseTtlMs: 200 },
      ),
    ).resolves.toEqual(expect.objectContaining({ decision: "stale", value: "Updated" }));

    await expect(
      store.getOrLoad(
        "missing",
        () => {
          throw new Error("origin down");
        },
        { ttlMs: 100, staleTtlMs: 300, owner: "req-e", leaseTtlMs: 200 },
      ),
    ).resolves.toEqual({ decision: "miss", shouldRefresh: true });
  });
});
