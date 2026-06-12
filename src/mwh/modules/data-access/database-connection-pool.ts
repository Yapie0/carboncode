import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Database Connection Pool Middleware

## Purpose

Use this module as a reusable reference when building database connection pools, SQL client adapters, read/write proxy layers, or service-local database access middleware.

The module defines a small connection lifecycle state machine: acquire, lease, release, queue waiters, expire queued requests, prune idle connections, and report health snapshots. It is intentionally provider-neutral so the same core can back pg, mysql2, Prisma raw adapters, SQLite fixtures, or a custom TCP database client.

## When To Use

- A service needs bounded database concurrency instead of creating one connection per request.
- Tests need deterministic acquire/release behavior without a real database server.
- A database adapter needs wait-queue behavior, idle pruning, and health snapshots.
- A codebase needs a clean seam between SQL client creation and request-level repository code.

## When Not To Use

- Do not replace a mature driver pool blindly when pg/mysql2 already satisfies the production need.
- Do not share one in-memory pool across multiple Node processes.
- Do not treat pool acquisition as transaction management; transactions still need explicit commit/rollback guards.
- Do not queue requests indefinitely. Always set a wait timeout.

## Implementation Variants

- memory-pool: deterministic in-process pool for local development, unit tests, and adapter contract tests.
- pg adapter: wraps node-postgres PoolClient acquire/release and maps driver stats into the same snapshot shape.
- mysql2 adapter: wraps createPool/getConnection/releaseConnection and applies wait-timeout instrumentation.
- proxy adapter: forwards acquire/release to PgBouncer, ProxySQL, or a service-local connection manager while preserving the same health contract.

## Recommended Architecture

- core.ts: pure pool state machine for acquire/release, wait-queue assignment, timeout expiry, idle/lifetime pruning, and snapshots.
- memory-pool.ts: stateful reference implementation with deterministic IDs and clone-safe reads.
- adapters/pg.ts: maps Pool.connect(), client.release(), idleCount, waitingCount, and error events.
- adapters/mysql2.ts: maps getConnection(), connection.release(), enqueue events, and pool end lifecycle.
- transaction.ts: helper that acquires a connection, starts a transaction, commits on success, rolls back on failure, and always releases.

## Public API Sketch

\`\`\`ts
const pool = new MemoryConnectionPool({ maxSize: 10, idleTtlMs: 60_000 });
const acquired = pool.acquire({ requesterId: "request-123", waitTimeoutMs: 5_000 });
if (acquired.kind !== "leased") throw new Error("database pool saturated");

try {
  await runQuery(acquired.connection.id);
} finally {
  pool.release(acquired.connection.id);
}
\`\`\`

## Integration Steps

1. Keep repository/query code dependent on a small ConnectionPool interface.
2. Use the memory implementation in tests to verify saturation, release, timeout, and transaction cleanup.
3. Add a provider adapter for pg/mysql2/Prisma that maps driver acquire/release into the same contract.
4. Export snapshot metrics to logs or OpenTelemetry so saturation is visible before production incidents.

## Failure Modes

- Pool saturation: all connections are leased and waiters time out.
- Connection leak: code path fails to release after query or rollback.
- Idle churn: idle TTL is too low and repeatedly reconnects.
- Long-lived bad connection: lifetime pruning is missing and stale sockets remain in use.
- Thundering herd: too many waiters resume at once after one connection is released.

## Security Notes

- Never log database credentials in pool errors or snapshots.
- Treat requesterId as diagnostic metadata, not authentication.
- Redact SQL text before storing audit records.
- Keep per-tenant pools bounded to prevent noisy-neighbor exhaustion.

## Verification Checklist

- Stateless tests cover new connection leasing, wait-queue insertion, release-to-waiter assignment, timeout expiry, idle pruning, and snapshot counts.
- Stateful tests cover memory pool saturation, clone-safe reads, release assignment, waiter expiry, and idle/lifetime pruning.
- Driver adapter tests should prove that acquire failures do not leak pool accounting and release always runs after failed transactions.

## Source References

- node-postgres Pool lifecycle and waitingCount patterns.
- mysql2 createPool/getConnection/releaseConnection lifecycle patterns.
- PgBouncer and ProxySQL connection pooling operational patterns.
- Generic bounded-resource semaphore and wait-queue patterns.
`;

export const DATABASE_CONNECTION_POOL_MODULE: MwhModule = {
  id: "database-connection-pool",
  title: "Database Connection Pool Middleware",
  summary:
    "Reusable data-access reference for bounded database connection lifecycles, wait queues, idle pruning, and provider adapter tests.",
  version: "0.1.0",
  tags: ["data-access", "database", "connection-pool", "sql", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
