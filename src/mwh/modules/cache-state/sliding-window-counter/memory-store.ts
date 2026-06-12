import {
  type CounterBucket,
  type SlidingWindowAdmission,
  type SlidingWindowSnapshot,
  admitSlidingWindow,
  createSlidingWindowSnapshot,
  incrementSlidingWindow,
  isSlidingWindowAllowed,
  pruneCounterBuckets,
} from "./core.js";

export interface MemorySlidingWindowCounterOptions {
  now?: () => number;
  windowMs: number;
  bucketMs: number;
  limit?: number;
}

export class MemorySlidingWindowCounter {
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly bucketMs: number;
  private readonly limit?: number;
  private readonly bucketsByKey = new Map<string, CounterBucket[]>();

  constructor(opts: MemorySlidingWindowCounterOptions) {
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs;
    this.bucketMs = opts.bucketMs;
    this.limit = opts.limit;
  }

  increment(key: string, amount = 1): SlidingWindowSnapshot {
    const next = incrementSlidingWindow(this.bucketsByKey.get(key) ?? [], {
      nowMs: this.now(),
      windowMs: this.windowMs,
      bucketMs: this.bucketMs,
      amount,
    });
    this.bucketsByKey.set(key, next);
    return this.snapshot(key);
  }

  snapshot(key: string): SlidingWindowSnapshot {
    const nowMs = this.now();
    const active = pruneCounterBuckets(this.bucketsByKey.get(key) ?? [], {
      nowMs,
      windowMs: this.windowMs,
    });
    if (active.length === 0) this.bucketsByKey.delete(key);
    else this.bucketsByKey.set(key, active);
    return createSlidingWindowSnapshot(key, active, {
      nowMs,
      windowMs: this.windowMs,
      bucketMs: this.bucketMs,
      limit: this.limit,
    });
  }

  allowed(key: string, limit = this.limit): boolean {
    if (limit === undefined) throw new Error("limit is required");
    return isSlidingWindowAllowed(this.snapshot(key), limit);
  }

  consumeIfAllowed(key: string, amount = 1, limit = this.limit): SlidingWindowAdmission {
    if (limit === undefined) throw new Error("limit is required");
    const decision = admitSlidingWindow(key, this.bucketsByKey.get(key) ?? [], {
      nowMs: this.now(),
      windowMs: this.windowMs,
      bucketMs: this.bucketMs,
      limit,
      amount,
    });
    if (decision.allowed) this.bucketsByKey.set(key, decision.nextBuckets);
    return {
      ...decision,
      snapshot: {
        ...decision.snapshot,
        buckets: decision.snapshot.buckets.map((bucket) => ({ ...bucket })),
      },
      nextBuckets: decision.nextBuckets.map((bucket) => ({ ...bucket })),
    };
  }

  prune(): number {
    const before = this.bucketsByKey.size;
    for (const key of [...this.bucketsByKey.keys()]) {
      this.snapshot(key);
    }
    return before - this.bucketsByKey.size;
  }

  keys(): string[] {
    return [...this.bucketsByKey.keys()].sort();
  }
}
