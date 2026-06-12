import { describe, expect, it } from "vitest";
import {
  acquireDistributedLock,
  checkLockOperation,
  compareFencingToken,
  isLockExpired,
  lockSnapshot,
  releaseDistributedLock,
  remainingLockTtlMs,
  renewDistributedLock,
} from "../src/mwh/modules/cache-state/distributed-lock/core.js";
import { MemoryDistributedLockStore } from "../src/mwh/modules/cache-state/distributed-lock/memory-store.js";

describe("MWH distributed-lock middleware", () => {
  it("acquires, blocks, renews, and expires stateless locks", () => {
    const first = acquireDistributedLock({
      key: "sync:1",
      ownerId: "worker-a",
      token: "token-a",
      nowMs: 1_000,
      ttlMs: 500,
    });
    expect(first).toEqual(
      expect.objectContaining({
        acquired: true,
        reason: "available",
      }),
    );
    expect(first.record).toEqual(
      expect.objectContaining({
        ownerId: "worker-a",
        fencingToken: 1,
        expiresAtMs: 1_500,
      }),
    );

    expect(
      acquireDistributedLock({
        current: first.record,
        key: "sync:1",
        ownerId: "worker-b",
        token: "token-b",
        nowMs: 1_100,
        ttlMs: 500,
      }),
    ).toEqual(expect.objectContaining({ acquired: false, reason: "held", retryAfterMs: 400 }));

    expect(
      acquireDistributedLock({
        current: first.record,
        key: "sync:1",
        ownerId: "worker-a",
        token: "token-a",
        nowMs: 1_200,
        ttlMs: 500,
      }),
    ).toEqual(expect.objectContaining({ acquired: true, reason: "same-owner" }));
    expect(isLockExpired(first.record, 1_499)).toBe(false);
    expect(isLockExpired(first.record, 1_500)).toBe(true);
  });

  it("takes over expired locks with a new fencing token", () => {
    const first = acquireDistributedLock({
      key: "sync:1",
      ownerId: "worker-a",
      token: "token-a",
      nowMs: 1_000,
      ttlMs: 500,
    });
    const second = acquireDistributedLock({
      current: first.record,
      key: "sync:1",
      ownerId: "worker-b",
      token: "token-b",
      nowMs: 1_500,
      ttlMs: 500,
    });

    expect(second).toEqual(expect.objectContaining({ acquired: true, reason: "expired" }));
    expect(second.record).toEqual(
      expect.objectContaining({ ownerId: "worker-b", fencingToken: 2 }),
    );
  });

  it("renews and releases only when owner and token match", () => {
    const lock = acquireDistributedLock({
      key: "sync:1",
      ownerId: "worker-a",
      token: "token-a",
      nowMs: 1_000,
      ttlMs: 500,
    }).record;

    expect(
      renewDistributedLock(lock, {
        ownerId: "worker-b",
        token: "token-b",
        nowMs: 1_100,
        ttlMs: 500,
      }),
    ).toBeUndefined();
    expect(
      renewDistributedLock(lock, {
        ownerId: "worker-a",
        token: "token-a",
        nowMs: 1_100,
        ttlMs: 500,
      }),
    ).toEqual(expect.objectContaining({ expiresAtMs: 1_600 }));
    expect(releaseDistributedLock(lock, { ownerId: "worker-b", token: "token-b" })).toEqual(lock);
    expect(releaseDistributedLock(lock, { ownerId: "worker-a", token: "token-a" })).toBeUndefined();
  });

  it("checks operation ownership and fencing tokens before side effects", () => {
    const lock = acquireDistributedLock({
      key: "sync:1",
      ownerId: "worker-a",
      token: "token-a",
      nowMs: 1_000,
      ttlMs: 500,
    }).record;

    expect(
      checkLockOperation(lock, {
        ownerId: "worker-a",
        token: "token-a",
        fencingToken: 1,
        nowMs: 1_100,
      }),
    ).toEqual({ allowed: true, reason: "active-owner" });
    expect(() =>
      checkLockOperation(lock, {
        ownerId: "worker-a",
        token: "token-a",
        fencingToken: 0,
        nowMs: 1_100,
      }),
    ).toThrow("fencingToken must be a positive integer");
    expect(
      checkLockOperation(lock, {
        ownerId: "worker-a",
        token: "token-a",
        fencingToken: 2,
        nowMs: 1_100,
      }),
    ).toEqual({ allowed: false, reason: "stale-fencing-token" });
    expect(
      checkLockOperation(lock, {
        ownerId: "worker-b",
        token: "token-a",
        fencingToken: 1,
        nowMs: 1_100,
      }),
    ).toEqual({ allowed: false, reason: "owner-mismatch" });
    expect(
      checkLockOperation(lock, {
        ownerId: "worker-a",
        token: "token-a",
        fencingToken: 1,
        nowMs: 1_500,
      }),
    ).toEqual({ allowed: false, reason: "expired" });

    expect(compareFencingToken({ currentFencingToken: 3, operationFencingToken: 2 })).toBe("stale");
    expect(compareFencingToken({ currentFencingToken: 3, operationFencingToken: 3 })).toBe(
      "current",
    );
    expect(compareFencingToken({ currentFencingToken: 3, operationFencingToken: 4 })).toBe(
      "future",
    );
    expect(remainingLockTtlMs(lock, 1_100)).toBe(400);
    expect(remainingLockTtlMs(lock, 1_500)).toBe(0);
    expect(lockSnapshot([lock], 1_100)).toEqual({
      total: 1,
      active: 1,
      expired: 0,
      nextExpiryAtMs: 1_500,
    });
    expect(lockSnapshot([lock], 1_500)).toEqual({
      total: 1,
      active: 0,
      expired: 1,
      nextExpiryAtMs: undefined,
    });
  });

  it("runs a stateful acquire conflict, renew, release, prune, and takeover flow", () => {
    let now = 1_000;
    const tokens = ["token-a", "token-b", "token-c"];
    const store = new MemoryDistributedLockStore({
      now: () => now,
      tokenFactory: () => tokens.shift() ?? "fallback",
    });

    const first = store.acquire("sync:1", "worker-a", 500);
    expect(first).toEqual(expect.objectContaining({ acquired: true, reason: "available" }));
    expect(first.record.token).toBe("token-a");

    expect(store.acquire("sync:1", "worker-b", 500)).toEqual(
      expect.objectContaining({ acquired: false, reason: "held" }),
    );
    expect(store.renew("sync:1", "worker-a", "token-a", 700)).toEqual(
      expect.objectContaining({ expiresAtMs: 1_700 }),
    );
    expect(store.remainingTtl("sync:1")).toBe(700);
    expect(store.snapshot()).toEqual({
      total: 1,
      active: 1,
      expired: 0,
      nextExpiryAtMs: 1_700,
    });

    const leaked = store.get("sync:1")!;
    leaked.ownerId = "mutated";
    expect(store.get("sync:1")?.ownerId).toBe("worker-a");

    expect(
      store.checkOperation({
        key: "sync:1",
        ownerId: "worker-a",
        token: "token-a",
        fencingToken: first.record.fencingToken,
      }),
    ).toEqual({ allowed: true, reason: "active-owner" });
    expect(store.release("sync:1", "worker-b", "token-b")).toBe(false);
    expect(store.release("sync:1", "worker-a", "token-a")).toBe(true);
    expect(store.get("sync:1")).toBeUndefined();

    const second = store.acquire("sync:1", "worker-b", 100);
    expect(second.record.fencingToken).toBe(2);
    const listed = store.list();
    listed[0]!.token = "mutated";
    expect(store.list()[0]?.token).toBe("token-c");
    expect(
      store.checkOperation({
        key: "sync:1",
        ownerId: "worker-a",
        token: "token-a",
        fencingToken: first.record.fencingToken,
      }),
    ).toEqual({ allowed: false, reason: "owner-mismatch" });
    now = 1_100;
    expect(store.pruneExpired()).toBe(1);
    expect(store.acquire("sync:1", "worker-c", 100)).toEqual(
      expect.objectContaining({
        acquired: true,
        reason: "available",
        record: expect.objectContaining({ fencingToken: 3 }),
      }),
    );
  });
});
