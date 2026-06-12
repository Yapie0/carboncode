import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Bulkhead Isolation Middleware

## Purpose

Use this module as a reusable reference for bulkhead isolation: per-scope concurrency limits, bounded queues, queue timeouts, request rejection, release promotion, and operational snapshots.

This module complements circuit breakers and traffic policy. Circuit breakers decide whether a dependency is failing; traffic policy chooses a target; bulkheads prevent one target, tenant, operation, or downstream dependency from consuming all execution capacity.

## When To Use

- Need per-service, per-tenant, or per-operation concurrency isolation.
- Need bounded queues with explicit rejection when capacity is exhausted.
- Need deterministic tests for admission, release, queue promotion, and timeout cleanup.
- Need a small state machine before wiring Redis, SQL, worker pools, or API middleware.

## When Not To Use

- Do not use an in-memory bulkhead as the only production control across many instances.
- Do not queue unbounded work; define maxQueue and timeout policies.
- Do not treat bulkhead admission as authorization.
- Do not block release paths; leaked running requests will exhaust capacity.

## Implementation Variants

- Memory manager for unit tests, local CLIs, and single-process services.
- Express/Fastify middleware that admits by route, tenant, or downstream scope.
- Redis lease/semaphore adapter for distributed service instances.
- SQL lease table adapter for durable queue and audit needs.
- Worker-pool adapter for CPU or IO-bound task isolation.

## Recommended Architecture

- core.ts: pure policy validation, admission, rejection, release, queue promotion, timeout pruning, snapshots, and clone helpers.
- memory-bulkhead.ts: stateful policy definition, admit, release, prune, snapshots, and event history.
- adapters/redis.ts: distributed semaphore and queue with TTL leases.
- adapters/http.ts: route/tenant scope extraction middleware.
- adapters/worker.ts: worker-pool executor integration.

## Public API Sketch

\`\`\`ts
const bulkheads = new MemoryBulkheadManager();
bulkheads.definePolicy({
  scope: "tenant:t1:payments",
  maxConcurrent: 2,
  maxQueue: 10,
  queueTimeoutMs: 5_000,
});

const admission = bulkheads.admit("tenant:t1:payments", "request-1");
// run the protected operation
bulkheads.release("tenant:t1:payments", "request-1");
\`\`\`

## Integration Rules

1. Pick a stable scope: service, tenant, route, operation, or dependency.
2. Bound both active concurrency and queued work.
3. Always release running requests in finally blocks.
4. Prune timed-out queued requests before admitting new work in high-load paths.
5. Emit admission/rejection/completion events for observability.
6. Use distributed leases for multi-instance production systems.

## Failure Modes

- Missing release leaks capacity and eventually rejects all work for a scope.
- Unbounded queues turn overload into memory pressure and high latency.
- Local-only state allows global concurrency to exceed intended limits.
- Long queue timeouts produce stale work that callers no longer need.
- Duplicate request IDs hide retries unless explicitly rejected.

## Security Notes

- Do not derive scopes from untrusted input without normalization.
- Avoid exposing tenant-specific queue sizes to unrelated tenants.
- Rate-limit rejected clients separately to avoid retry storms.
- Audit policy changes and high-risk scope overrides.

## Verification Checklist

- Stateless tests cover policy validation, running admission, queue admission, rejection, release, promotion, timeout pruning, duplicate IDs, snapshots, and clone safety.
- Stateful tests cover multiple scopes, event history, missing scopes, admission/release/prune flows, and clone-safe state reads.
- Redis/SQL adapters should test lease expiry, duplicate release, concurrency races, and queue fairness.
- HTTP adapters should test release in success, failure, and thrown-error paths.

## Source References

- Bulkhead isolation pattern in resilience engineering.
- Semaphore and bounded queue concurrency control.
- Redis semaphore and lease patterns.
- Service mesh and API gateway concurrency limiting patterns.
`;

export const BULKHEAD_ISOLATION_MODULE: MwhModule = {
  id: "bulkhead-isolation",
  title: "Bulkhead Isolation Middleware",
  summary:
    "Reusable service-governance reference with per-scope concurrency limits, bounded queues, timeout pruning, release promotion, and stateful isolation tests.",
  version: "0.1.0",
  tags: ["service-governance", "bulkhead", "concurrency", "isolation", "queue", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
