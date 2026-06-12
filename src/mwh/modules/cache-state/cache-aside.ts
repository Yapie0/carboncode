import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Cache-Aside Middleware

## Purpose

Use this module as a reusable reference when adding cache-aside reads, stale-while-revalidate behavior, and refresh stampede protection to API servers, workers, or backend services.

The module keeps cache policy in pure functions and puts state in replaceable stores. The included memory store exists for tests and local development; production adapters should usually target Redis, KeyDB, Dragonfly, Memcached, Cloudflare KV, or provider-native cache services.

## When To Use

- Cache expensive database reads, HTTP calls, or AI/tool responses.
- Serve briefly stale data while a background refresh runs.
- Prevent many concurrent requests from refreshing the same key.
- Add deterministic cache behavior before choosing a production cache backend.

## When Not To Use

- Do not use process memory as the only cache across multiple replicas.
- Do not cache user-specific or permission-sensitive data without including auth scope in the key.
- Do not use stale reads for workflows requiring strict read-after-write consistency.

## Recommended Architecture

- core.ts: pure cache entry decisions and refresh lease logic.
- memory-store.ts: deterministic stateful adapter for tests.
- adapters/redis.ts: production adapter using atomic SET NX PX for refresh leases.
- adapters/memcached.ts: simple cache-aside adapter without strong lease semantics.
- middleware/http.ts: optional route wrapper that maps keys, loader, TTL, and headers.

## Public API Sketch

\`\`\`ts
const cache = new MemoryCacheAsideStore<UserProfile>();
const cached = cache.get(\`profile:\${userId}\`);
if (cached.decision === "hit") return cached.value;

if (cached.decision === "stale") {
  const lease = cache.acquireRefreshLease(\`profile:\${userId}\`, {
    owner: requestId,
    ttlMs: 10_000,
  });
  if (lease.acquired) void refreshProfileInBackground(userId);
  return cached.value;
}

const value = await loadProfileFromDatabase(userId);
cache.set(\`profile:\${userId}\`, value, { ttlMs: 60_000, staleTtlMs: 300_000 });
return value;
\`\`\`

## Integration Rules

1. Build keys from stable domain identifiers and version prefixes.
2. Include tenant, locale, permission, and representation scope when they affect the response.
3. Use short refresh leases to avoid duplicate expensive loads.
4. Invalidate or version cache keys after writes that require fresh reads.
5. Add jitter to TTLs in production to avoid synchronized expiry.
6. Decide explicitly whether backend cache failures should fail open or closed.

## Failure Modes

- Cache stampedes when many callers miss or stale-refresh the same key.
- Serving stale data beyond the business tolerance window.
- Cross-tenant data leaks from incomplete key scopes.
- Permanent stale values when background refresh fails silently.
- Memory stores diverge across replicas and are cleared on restart.

## Security Notes

- Do not put raw secrets, bearer tokens, or PII in cache keys.
- Hash high-cardinality or sensitive key parts before writing them to external caches.
- Treat cached authorization-sensitive objects as scoped to the exact caller context.

## Verification Checklist

- Stateless tests cover hit, stale, miss, stale expiry, and refresh lease conflict.
- Stateful tests cover get/set/delete, stale reads, lease acquisition/release, and pruning.
- Production adapter tests should verify atomic lease acquisition under concurrency.
- HTTP wrapper tests should assert cache headers only when the route contract permits them.

## Source References

- Django cache framework: cache-aside and backend abstraction conventions.
- Rails ActiveSupport::Cache: key namespacing and expiry conventions.
- Vercel/SWR: stale-while-revalidate behavior model.
- Redis SET NX PX: common refresh lease primitive.
`;

export const CACHE_ASIDE_MODULE: MwhModule = {
  id: "cache-aside",
  title: "Cache-Aside Middleware",
  summary:
    "Reusable cache-aside reference with pure hit/stale/miss decisions, refresh leases, and memory-store tests.",
  version: "0.1.0",
  tags: ["cache", "cache-aside", "stale-while-revalidate", "redis", "cache-state"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
