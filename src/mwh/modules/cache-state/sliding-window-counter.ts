import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Sliding Window Counter Middleware

## Purpose

Use this module as a reusable reference for rolling counters backed by cache/state storage. It is useful for rate limiting, failed-login counters, fraud heuristics, active-user windows, API usage windows, and short-lived analytics.

The module contains pure bucketed sliding-window counter logic plus a deterministic in-memory store for tests. Production adapters can use Redis sorted sets/hashes, SQL time buckets, ClickHouse rollups, or provider-native cache stores.

## When To Use

- Count events over a rolling time window.
- Need deterministic tests for limit checks and reset timing.
- Need a reusable counter primitive independent of HTTP middleware.
- Need a state shape that can map to Redis, SQL, or in-memory stores.

## When Not To Use

- Do not use process-local memory for distributed rate limits or security counters.
- Do not use high-cardinality keys without retention and pruning.
- Do not use approximate bucket counters when exact per-event audit is required.
- Do not use counters as authorization decisions without separate policy checks.

## Implementation Variants

- Memory store for tests and single-process prototypes.
- Redis hash per key with bucket timestamps and TTL.
- Redis sorted set per key for exact event windows.
- SQL bucket table with key + bucketStart unique index.
- ClickHouse/OLAP adapter for high-volume analytics windows.

## Recommended Architecture

- core.ts: pure bucket start calculation, increment, pruning, counting, snapshots, and limit checks.
- memory-store.ts: stateful increment, snapshot, allowed, prune, and key listing behavior.
- adapters/redis-hash.ts: bucketed counters with EXPIRE.
- adapters/redis-zset.ts: exact event timestamp counter.
- middleware/rate-limit.ts: optional HTTP adapter using this generic counter.

## Public API Sketch

\`\`\`ts
const counter = new MemorySlidingWindowCounter({
  windowMs: 60_000,
  bucketMs: 1_000,
  limit: 100,
});

counter.increment("api:user:u1");
if (!counter.allowed("api:user:u1")) {
  throw new Error("rate limited");
}
const snapshot = counter.snapshot("api:user:u1");
\`\`\`

## Integration Rules

1. Choose bucketMs small enough for accuracy and large enough for storage cost.
2. Use stable, bounded-cardinality keys.
3. Prune expired buckets on reads/writes and set backend TTLs.
4. Keep the generic counter separate from HTTP response behavior.
5. Use Redis or SQL atomic increments for distributed deployments.
6. Store resetAtMs and remaining in snapshots for callers that need feedback.

## Failure Modes

- Process-local counters diverge across instances.
- Large key cardinality leaks memory or cache storage.
- Coarse buckets overcount near window boundaries.
- Missing TTL leaves expired buckets forever.
- Non-atomic backend increments lose events under concurrency.

## Security Notes

- Do not include secrets or raw tokens in counter keys.
- Hash or normalize user-controlled key parts where needed.
- Treat security counters such as failed login attempts as sensitive operational data.

## Verification Checklist

- Stateless tests cover bucket rounding, increment, bucket merging, pruning, count, snapshot resetAt/remaining, and limit checks.
- Stateful tests cover increment across buckets, allowed checks, pruning expired keys, multiple keys, and custom limits.
- Redis/SQL adapter tests should verify atomic increments, TTL, and concurrent writers.
- HTTP adapter tests should verify headers and 429 behavior separately.

## Source References

- Sliding-window rate limiting and rolling counters.
- Redis hash/zset counter patterns.
- Time-bucket aggregation and TTL pruning.
- Low-cardinality metric/counter key design.
`;

export const SLIDING_WINDOW_COUNTER_MODULE: MwhModule = {
  id: "sliding-window-counter",
  title: "Sliding Window Counter Middleware",
  summary:
    "Reusable cache-state counter reference with bucketed rolling windows, reset snapshots, limit checks, pruning, and stateful tests.",
  version: "0.1.0",
  tags: ["cache-state", "counter", "sliding-window", "rate-limit", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
