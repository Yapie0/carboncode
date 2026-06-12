import { describe, expect, it } from "vitest";
import {
  admitSlidingWindow,
  bucketStartFor,
  countSlidingWindow,
  createSlidingWindowSnapshot,
  incrementSlidingWindow,
  isSlidingWindowAllowed,
  pruneCounterBuckets,
} from "../src/mwh/modules/cache-state/sliding-window-counter/core.js";
import { MemorySlidingWindowCounter } from "../src/mwh/modules/cache-state/sliding-window-counter/memory-store.js";

describe("MWH sliding-window-counter middleware", () => {
  it("rounds timestamps to buckets and merges increments", () => {
    expect(bucketStartFor(1_234, 1_000)).toBe(1_000);
    const first = incrementSlidingWindow([], {
      nowMs: 1_234,
      windowMs: 10_000,
      bucketMs: 1_000,
    });
    const second = incrementSlidingWindow(first, {
      nowMs: 1_500,
      windowMs: 10_000,
      bucketMs: 1_000,
      amount: 2,
    });

    expect(second).toEqual([{ bucketStartMs: 1_000, count: 3 }]);
  });

  it("prunes old buckets and counts the active window", () => {
    const buckets = [
      { bucketStartMs: 0, count: 1 },
      { bucketStartMs: 1_000, count: 2 },
      { bucketStartMs: 2_000, count: 3 },
    ];

    expect(pruneCounterBuckets(buckets, { nowMs: 2_500, windowMs: 1_500 })).toEqual([
      { bucketStartMs: 2_000, count: 3 },
    ]);
    expect(countSlidingWindow(buckets, { nowMs: 2_500, windowMs: 2_500 })).toBe(5);
  });

  it("creates snapshots with remaining count, reset time, and limit decisions", () => {
    const snapshot = createSlidingWindowSnapshot(
      "login:user-1",
      [
        { bucketStartMs: 1_000, count: 2 },
        { bucketStartMs: 2_000, count: 1 },
      ],
      {
        nowMs: 2_500,
        windowMs: 3_000,
        bucketMs: 1_000,
        limit: 5,
      },
    );

    expect(snapshot).toEqual({
      key: "login:user-1",
      nowMs: 2_500,
      windowMs: 3_000,
      bucketMs: 1_000,
      count: 3,
      remaining: 2,
      resetAtMs: 4_000,
      buckets: [
        { bucketStartMs: 1_000, count: 2 },
        { bucketStartMs: 2_000, count: 1 },
      ],
    });
    expect(isSlidingWindowAllowed(snapshot, 4)).toBe(true);
    expect(isSlidingWindowAllowed(snapshot, 3)).toBe(false);
  });

  it("computes atomic admission decisions without mutating rejected buckets", () => {
    const buckets = [{ bucketStartMs: 1_000, count: 2 }];
    expect(
      admitSlidingWindow("api:u1", buckets, {
        nowMs: 1_500,
        windowMs: 3_000,
        bucketMs: 1_000,
        limit: 3,
        amount: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        snapshot: expect.objectContaining({ count: 3, remaining: 0 }),
        nextBuckets: [{ bucketStartMs: 1_000, count: 3 }],
      }),
    );

    expect(
      admitSlidingWindow("api:u1", buckets, {
        nowMs: 1_500,
        windowMs: 3_000,
        bucketMs: 1_000,
        limit: 3,
        amount: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        snapshot: expect.objectContaining({ count: 2, remaining: 1 }),
        nextBuckets: [{ bucketStartMs: 1_000, count: 2 }],
        retryAfterMs: 2_500,
      }),
    );
    expect(buckets).toEqual([{ bucketStartMs: 1_000, count: 2 }]);
  });

  it("runs a stateful increment, allowed, and rolling expiry flow", () => {
    let now = 1_000;
    const counter = new MemorySlidingWindowCounter({
      now: () => now,
      windowMs: 3_000,
      bucketMs: 1_000,
      limit: 3,
    });

    expect(counter.increment("api:u1").count).toBe(1);
    now = 1_500;
    expect(counter.increment("api:u1", 2)).toEqual(
      expect.objectContaining({ count: 3, remaining: 0 }),
    );
    expect(counter.allowed("api:u1")).toBe(false);

    const leaked = counter.snapshot("api:u1");
    leaked.buckets[0]!.count = 999;
    expect(counter.snapshot("api:u1")).toEqual(expect.objectContaining({ count: 3 }));

    now = 4_001;
    expect(counter.snapshot("api:u1")).toEqual(
      expect.objectContaining({
        count: 0,
        remaining: 3,
        buckets: [],
      }),
    );
    expect(counter.allowed("api:u1")).toBe(true);
  });

  it("tracks multiple keys and prunes empty state", () => {
    let now = 1_000;
    const counter = new MemorySlidingWindowCounter({
      now: () => now,
      windowMs: 1_000,
      bucketMs: 500,
    });
    counter.increment("a");
    counter.increment("b", 2);
    expect(counter.keys()).toEqual(["a", "b"]);

    now = 2_001;
    expect(counter.prune()).toBe(2);
    expect(counter.keys()).toEqual([]);
  });

  it("runs a stateful atomic consume flow and preserves state on rejection", () => {
    let now = 1_000;
    const counter = new MemorySlidingWindowCounter({
      now: () => now,
      windowMs: 3_000,
      bucketMs: 1_000,
      limit: 3,
    });

    expect(counter.consumeIfAllowed("api:u2", 2)).toEqual(
      expect.objectContaining({
        allowed: true,
        snapshot: expect.objectContaining({ count: 2, remaining: 1 }),
      }),
    );
    const rejected = counter.consumeIfAllowed("api:u2", 2);
    expect(rejected).toEqual(
      expect.objectContaining({
        allowed: false,
        snapshot: expect.objectContaining({ count: 2, remaining: 1 }),
      }),
    );
    rejected.nextBuckets[0]!.count = 999;
    rejected.snapshot.buckets[0]!.count = 999;
    expect(counter.snapshot("api:u2")).toEqual(expect.objectContaining({ count: 2 }));

    now = 4_001;
    expect(counter.consumeIfAllowed("api:u2", 3)).toEqual(
      expect.objectContaining({
        allowed: true,
        snapshot: expect.objectContaining({ count: 3, remaining: 0 }),
      }),
    );
  });
});
