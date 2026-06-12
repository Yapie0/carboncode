export interface CounterBucket {
  bucketStartMs: number;
  count: number;
}

export interface SlidingWindowSnapshot {
  key: string;
  nowMs: number;
  windowMs: number;
  bucketMs: number;
  count: number;
  remaining?: number;
  resetAtMs: number;
  buckets: CounterBucket[];
}

export interface SlidingWindowAdmission {
  allowed: boolean;
  snapshot: SlidingWindowSnapshot;
  nextBuckets: CounterBucket[];
  retryAfterMs?: number;
}

export function bucketStartFor(nowMs: number, bucketMs: number): number {
  assertNonNegativeInteger(nowMs, "nowMs");
  assertPositiveInteger(bucketMs, "bucketMs");
  return Math.floor(nowMs / bucketMs) * bucketMs;
}

export function incrementSlidingWindow(
  buckets: readonly CounterBucket[],
  input: {
    nowMs: number;
    windowMs: number;
    bucketMs: number;
    amount?: number;
  },
): CounterBucket[] {
  assertWindow(input.windowMs, input.bucketMs);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const amount = input.amount ?? 1;
  assertPositiveInteger(amount, "amount");
  const active = pruneCounterBuckets(buckets, {
    nowMs: input.nowMs,
    windowMs: input.windowMs,
  });
  const bucketStartMs = bucketStartFor(input.nowMs, input.bucketMs);
  const next = active.map((bucket) => ({ ...bucket }));
  const existing = next.find((bucket) => bucket.bucketStartMs === bucketStartMs);
  if (existing) existing.count += amount;
  else next.push({ bucketStartMs, count: amount });
  return sortBuckets(next);
}

export function pruneCounterBuckets(
  buckets: readonly CounterBucket[],
  input: { nowMs: number; windowMs: number },
): CounterBucket[] {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.windowMs, "windowMs");
  const cutoff = input.nowMs - input.windowMs;
  return sortBuckets(
    buckets
      .filter((bucket) => {
        assertCounterBucket(bucket);
        return bucket.bucketStartMs > cutoff;
      })
      .map((bucket) => ({ ...bucket })),
  );
}

export function countSlidingWindow(
  buckets: readonly CounterBucket[],
  input: { nowMs: number; windowMs: number },
): number {
  return pruneCounterBuckets(buckets, input).reduce((sum, bucket) => sum + bucket.count, 0);
}

export function createSlidingWindowSnapshot(
  key: string,
  buckets: readonly CounterBucket[],
  input: {
    nowMs: number;
    windowMs: number;
    bucketMs: number;
    limit?: number;
  },
): SlidingWindowSnapshot {
  assertNonEmpty(key, "key");
  assertWindow(input.windowMs, input.bucketMs);
  if (input.limit !== undefined) assertPositiveInteger(input.limit, "limit");
  const activeBuckets = pruneCounterBuckets(buckets, input);
  const count = activeBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const oldest = activeBuckets[0];
  return {
    key,
    nowMs: input.nowMs,
    windowMs: input.windowMs,
    bucketMs: input.bucketMs,
    count,
    remaining: input.limit === undefined ? undefined : Math.max(0, input.limit - count),
    resetAtMs: oldest ? oldest.bucketStartMs + input.windowMs : input.nowMs,
    buckets: activeBuckets,
  };
}

export function isSlidingWindowAllowed(snapshot: SlidingWindowSnapshot, limit: number): boolean {
  assertPositiveInteger(limit, "limit");
  return snapshot.count < limit;
}

export function admitSlidingWindow(
  key: string,
  buckets: readonly CounterBucket[],
  input: {
    nowMs: number;
    windowMs: number;
    bucketMs: number;
    limit: number;
    amount?: number;
  },
): SlidingWindowAdmission {
  assertPositiveInteger(input.limit, "limit");
  const amount = input.amount ?? 1;
  assertPositiveInteger(amount, "amount");
  const before = createSlidingWindowSnapshot(key, buckets, input);
  if (before.count + amount > input.limit) {
    return {
      allowed: false,
      snapshot: before,
      nextBuckets: before.buckets.map((bucket) => ({ ...bucket })),
      retryAfterMs: Math.max(0, before.resetAtMs - input.nowMs),
    };
  }
  const nextBuckets = incrementSlidingWindow(before.buckets, { ...input, amount });
  return {
    allowed: true,
    snapshot: createSlidingWindowSnapshot(key, nextBuckets, input),
    nextBuckets,
  };
}

function sortBuckets(buckets: CounterBucket[]): CounterBucket[] {
  return buckets.sort((left, right) => left.bucketStartMs - right.bucketStartMs);
}

function assertWindow(windowMs: number, bucketMs: number): void {
  assertPositiveInteger(windowMs, "windowMs");
  assertPositiveInteger(bucketMs, "bucketMs");
  if (bucketMs > windowMs) throw new Error("bucketMs must be <= windowMs");
}

function assertCounterBucket(bucket: CounterBucket): void {
  assertNonNegativeInteger(bucket.bucketStartMs, "bucketStartMs");
  assertPositiveInteger(bucket.count, "count");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
