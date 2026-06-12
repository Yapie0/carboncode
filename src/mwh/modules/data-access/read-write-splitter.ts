import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Read Write Splitter Middleware

## Purpose

Use this module as a reusable reference when implementing database read/write splitting, primary/replica routing, or service-local SQL routing middleware.

The module defines provider-neutral routing logic for query intent, primary selection, replica selection, replica lag thresholds, read-your-writes fallback, fresh-read routing, and health-based downgrade. It is intentionally small: adapters should provide real database connections, while this module owns the decision model and tests.

## When To Use

- A service has one primary database and one or more read replicas.
- Read queries should use replicas when they are healthy and not too stale.
- Writes, transactions, and read-your-writes flows must use primary.
- Tests need deterministic routing without a live database cluster.

## When Not To Use

- Do not route writes based on SQL string heuristics alone. Pass explicit intent for generated SQL and ORM queries.
- Do not use replicas for strong-consistency reads after a write.
- Do not keep sending traffic to replicas with high lag or failing health checks.
- Do not hide cross-region consistency risks behind generic read routing.

## Implementation Variants

- memory-splitter: deterministic in-process node registry, route history, and round-robin replica selection.
- pg adapter: maps decisions to primary/replica pg Pool instances.
- mysql2 adapter: maps decisions to primary/replica pools and exposes replica health metrics.
- ORM adapter: maps query scope metadata to primary/replica Prisma, Drizzle, Kysely, or TypeORM clients.

## Recommended Architecture

- core.ts: pure query intent inference, primary/replica route planning, node health updates, lag filtering, and snapshots.
- memory-splitter.ts: stateful reference implementation with deterministic replica cursor and clone-safe reads.
- adapters/pg.ts: receives QueryRouteDecision and acquires a client from the selected pool.
- adapters/orm.ts: requires explicit intent metadata for mutation, transaction, and read-your-writes flows.
- observability.ts: exports route decisions, fallback reason, node lag, and health state.

## Public API Sketch

\`\`\`ts
const splitter = new MemoryReadWriteSplitter({
  nodes: [
    { id: "primary", role: "primary", status: "healthy", replicaLagMs: 0, weight: 1 },
    { id: "replica-a", role: "replica", status: "healthy", replicaLagMs: 20, weight: 1 },
  ],
  policy: { maxReplicaLagMs: 100, allowPrimaryReads: true },
});

const route = splitter.route({ id: "q1", sql: "select * from users" });
\`\`\`

## Integration Steps

1. Require callers to pass explicit intent for writes, transactions, and read-your-writes reads.
2. Feed health checks and replica lag into the splitter before routing.
3. Use the route decision to acquire a connection from the matching pool.
4. Emit route history or metrics so primary-read fallback is visible.

## Failure Modes

- No healthy primary: writes and transactions must fail closed.
- No healthy replica: reads either fail or fall back to primary according to policy.
- Stale replica: lag over threshold must be excluded.
- Misclassified query: SQL inference is conservative but explicit intent is required for safety-critical paths.

## Security Notes

- Do not log raw SQL with sensitive literals in route history.
- Treat route metadata as operational diagnostics, not authorization.
- Tenant isolation should be enforced before selecting a node.

## Verification Checklist

- Stateless tests cover intent inference, write/transaction primary routing, replica round-robin, lag filtering, fresh-read fallback, no-replica failure, and snapshots.
- Stateful tests cover health updates, clone-safe node reads, route history, replica cursor movement, and primary fallback.
- Adapter tests should verify selected pool acquisition and release behavior for pg/mysql/ORM clients.

## Source References

- Primary/replica read routing patterns used by pg/mysql connection pools.
- Read-your-writes consistency and replica lag handling patterns.
- ProxySQL, PgBouncer, and service-local database router operational patterns.
`;

export const READ_WRITE_SPLITTER_MODULE: MwhModule = {
  id: "read-write-splitter",
  title: "Read Write Splitter Middleware",
  summary:
    "Reusable data-access reference for primary/replica query routing, lag-aware replica selection, health fallback, and adapter tests.",
  version: "0.1.0",
  tags: ["data-access", "database", "read-write-splitting", "replica", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
