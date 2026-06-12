import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Single Flight Cache

## Purpose

Use this module as a reusable reference when expensive cache misses must be coalesced so concurrent callers share one loader execution. It combines a small TTL cache with single-flight in-process coordination and exposes the pure decision logic separately from the stateful adapter.

This is different from a basic cache-aside wrapper: the primary behavior under test is request coalescing, not just hit/miss classification.

## When To Use

- Multiple concurrent requests can trigger the same expensive database, HTTP, AI, or filesystem load.
- A cache miss or expired entry causes backend pressure spikes.
- You need deterministic tests that prove duplicate loaders are collapsed.
- You want a local implementation before adding Redis locks, promise registries, or distributed leases.

## When Not To Use

- Do not rely on process-local single-flight across multiple replicas.
- Do not coalesce requests with different authorization, tenant, locale, or representation scope.
- Do not cache mutation results that must remain strictly fresh.
- Do not use long work leases without cancellation or timeout handling.

## Implementation Variants

- Memory single-flight cache for tests and local prototypes.
- Redis lock + cache adapter for distributed miss coalescing.
- Database advisory-lock adapter for SQL-heavy services.
- HTTP middleware wrapper that derives scoped cache keys and maps loader failures.
- LLM/tool-call adapter that coalesces identical expensive prompts or embeddings.

## Recommended Architecture

- core.ts: pure entry creation, hit/miss/expired read decisions, work acquisition, and release logic.
- memory-store.ts: in-process TTL cache plus promise coalescing with getOrLoad.
- adapters/redis.ts: distributed SET NX PX work lease plus cache value storage.
- adapters/sql.ts: advisory lock or lease-table backed miss coalescing.
- middleware/http.ts: route-level key derivation, loader invocation, and cache headers.

## Public API Sketch

\`\`\`ts
const cache = new MemorySingleFlightCache<User>();

const result = await cache.getOrLoad(\`user:\${userId}\`, {
  owner: requestId,
  ttlMs: 60_000,
  workTtlMs: 10_000,
  loader: () => users.findById(userId),
});

return result.value;
\`\`\`

## Integration Rules

1. Include every response-affecting scope in the cache key.
2. Keep work leases short and pair them with loader timeouts.
3. Cache only successful loader results unless negative caching is explicit.
4. Invalidate or version keys after writes.
5. Use distributed coordination when more than one process can serve the key.
6. Emit metrics for cache hits, loader executions, in-flight joins, and loader failures.

## Failure Modes

- Key scopes are incomplete and leak data across tenants or permissions.
- A stuck loader leaves callers waiting without timeout control.
- Process-local coalescing does not protect a distributed deployment.
- Loader failures fan out to all joined callers.
- Long TTLs hide backend data changes.

## Security Notes

- Never include raw secrets in cache keys.
- Hash sensitive key fragments before sending keys to external stores.
- Treat authorization-sensitive cache entries as scoped to the exact caller context.

## Verification Checklist

- Stateless tests cover entry creation, hit/miss/expired reads, work acquisition conflicts, expiry, same-owner renewal, and release.
- Stateful tests cover get/set/delete, TTL expiry, concurrent getOrLoad coalescing, loader result caching, loader failure cleanup, pruning, and clone-safe snapshots.
- Redis/SQL adapters should test atomic work acquisition under concurrent callers.
- HTTP middleware tests should verify scoped key construction and no caching on failed loaders.

## Source References

- Go singleflight request coalescing pattern.
- Redis SET NX PX lease patterns.
- Cache stampede protection patterns.
- Request-scoped cache key design for multi-tenant services.
`;

export const SINGLE_FLIGHT_CACHE_MODULE: MwhModule = {
  id: "single-flight-cache",
  title: "Single Flight Cache",
  summary:
    "Reusable cache-state reference for TTL cache entries, miss coalescing, work leases, concurrent loader sharing, and stateful cache-stampede tests.",
  version: "0.1.0",
  tags: ["cache-state", "single-flight", "cache", "stampede", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
