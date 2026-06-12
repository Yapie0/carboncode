import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Query Result Cache Middleware

## Purpose

Use this module as a reusable reference when implementing query-result caching in repository or data-access layers.

The module defines a provider-neutral cache lifecycle for deterministic query keys, TTL, stale-while-revalidate windows, dependency tags, write-driven invalidation, expired-entry pruning, and hit snapshots. It is scoped to query results, not generic application cache-aside behavior.

## When To Use

- A service has expensive read queries whose results can be cached by parameters.
- Cached rows need invalidation by table, aggregate, tenant, or business tag after writes.
- Stale data is acceptable briefly while a background refresh happens.
- Tests need deterministic fresh/stale/miss behavior without Redis or a database.

## When Not To Use

- Do not cache mutation results.
- Do not cache tenant-sensitive rows without tenant tags in the key or dependency tags.
- Do not infer invalidation tags from raw SQL in production-critical paths.
- Do not use stale results for strong-consistency workflows after writes.

## Implementation Variants

- memory-query-cache: deterministic in-process cache for unit tests and adapter contract tests.
- Redis adapter: stores query entries by stable key and maintains tag-to-key sets for invalidation.
- SQL adapter: stores cache metadata and invalidation tags in relational tables.
- ORM adapter: wraps repository read methods and requires explicit dependency tags.

## Recommended Architecture

- core.ts: pure cache key creation, put/read, fresh/stale/miss evaluation, tag invalidation, pruning, and snapshots.
- memory-query-cache.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/redis.ts: maps query keys to values and tags to sets with TTL.
- invalidation.ts: maps write operations to tags such as table:users, tenant:t1, user:u1.
- observability.ts: records hit kind, stale refresh requests, invalidated keys, and prune counts.

## Public API Sketch

\`\`\`ts
const cache = new MemoryQueryResultCache({
  policy: { ttlMs: 5_000, staleTtlMs: 30_000 },
});

cache.put({
  namespace: "users",
  sql: "select * from users where id = ?",
  params: ["u1"],
  tags: ["table:users", "user:u1"],
  value: [{ id: "u1" }],
});

const lookup = cache.read({ namespace: "users", sql: "select * from users where id = ?", params: ["u1"] });
if (lookup.kind === "stale") refreshInBackground();
\`\`\`

## Integration Steps

1. Require repository methods to provide namespace, query params, and dependency tags.
2. Cache only read query results and define TTL/stale TTL per query family.
3. Invalidate tags from write paths before or immediately after commit.
4. Export hit/miss/stale metrics to observe cache effectiveness and unsafe staleness.

## Failure Modes

- Missing invalidation tag: stale data can survive after writes.
- Overbroad invalidation tag: cache hit rate collapses.
- Key mismatch: logically identical queries produce different keys because params or namespace differ.
- Tenant leak: key or tags omit tenant dimension.
- Large values: query results exceed memory or Redis payload limits.

## Security Notes

- Do not log raw query params when they may contain PII.
- Include tenant/user scope in keys or tags for sensitive data.
- Treat cached rows as data subject to the same retention and deletion rules as source rows.

## Verification Checklist

- Stateless tests cover stable key generation, put/read, fresh hit, stale hit with refresh signal, miss after stale expiry, tag invalidation, pruning, and snapshots.
- Stateful tests cover deterministic time, clone-safe reads, tag invalidation after writes, and expired-entry pruning.
- Redis/SQL adapter tests should verify tag indexes and TTL behavior.

## Source References

- Repository-level query caching patterns.
- Redis tag-invalidation patterns using key sets.
- Stale-while-revalidate cache lifecycle patterns.
- ORM query-cache patterns in Prisma/TypeORM/Kysely-like data layers.
`;

export const QUERY_RESULT_CACHE_MODULE: MwhModule = {
  id: "query-result-cache",
  title: "Query Result Cache Middleware",
  summary:
    "Reusable data-access reference for query result caching, stable keys, TTL/stale windows, tag invalidation, and adapter tests.",
  version: "0.1.0",
  tags: ["data-access", "database", "query-cache", "stale-while-revalidate", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
