import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Transaction Scope Middleware

## Purpose

Use this module as a reusable reference when implementing database transaction scopes around repository code, unit-of-work services, or SQL adapter layers.

The module defines a provider-neutral transaction lifecycle: begin, savepoint, rollback-to-savepoint, release-savepoint, commit, rollback, timeout expiry, and status snapshots. It does not execute SQL directly; it gives adapters a tested state machine that can be mapped to pg, mysql2, Prisma, Drizzle, Kysely, SQLite, or a custom data-access layer.

## When To Use

- A service needs a consistent transaction wrapper across repositories.
- Code paths must guarantee rollback on thrown errors and release the connection after commit or rollback.
- Tests need deterministic transaction lifecycle behavior without a real database.
- A codebase uses savepoints for partial rollback inside a larger workflow.

## When Not To Use

- Do not treat this as a distributed transaction coordinator.
- Do not hide long-running external network calls inside a database transaction.
- Do not start nested database transactions unless the adapter maps them to savepoints explicitly.
- Do not skip timeout expiry; abandoned active transactions become connection leaks.

## Implementation Variants

- memory-transaction-manager: deterministic in-process lifecycle manager for unit and adapter contract tests.
- pg adapter: maps begin/commit/rollback/savepoint to SQL statements on a PoolClient.
- mysql2 adapter: maps lifecycle commands to a pooled connection and ensures release in finally blocks.
- orm adapter: wraps Prisma/Drizzle/Kysely transaction helpers while preserving the same audit/snapshot model.

## Recommended Architecture

- core.ts: pure transaction registry and lifecycle transitions.
- memory-transaction-manager.ts: stateful manager for local tests and adapter contracts.
- adapters/pg.ts: begin with client.query("BEGIN"), apply isolation level, commit/rollback, and release.
- adapters/mysql2.ts: beginTransaction(), commit(), rollback(), release().
- with-transaction.ts: helper that calls user code, commits on success, rolls back on failure, and always releases resources.

## Public API Sketch

\`\`\`ts
const manager = new MemoryTransactionManager({ defaultTimeoutMs: 5_000 });
const tx = manager.begin({ connectionId: "conn-1", ownerId: "request-123" });
manager.savepoint(tx.id, "before_optional_step");

try {
  await runRepositoryWork(tx.id);
  manager.commit(tx.id);
} catch (error) {
  manager.rollback(tx.id, "repository failed");
  throw error;
}
\`\`\`

## Integration Steps

1. Keep repository code dependent on a small TransactionScope interface.
2. Use the memory manager to verify commit, rollback, savepoint, timeout, and clone-safe state reads.
3. Add a driver adapter that maps each lifecycle action to SQL commands.
4. Export snapshots and timeout-expiry records to observability so transaction leaks are visible.

## Failure Modes

- Commit after rollback or rollback after commit must be rejected.
- Expired transactions should not accept new savepoints or commits.
- Savepoint names must be unique within one active transaction.
- Adapter failures during commit should trigger rollback or mark the transaction as uncertain.
- Connections must be released in finally blocks outside the pure state machine.

## Security Notes

- Do not put SQL text or database credentials in transaction events.
- Treat ownerId as diagnostic metadata, not an authorization decision.
- Redact business identifiers before exporting transaction traces.

## Verification Checklist

- Stateless tests cover begin, duplicate active transaction rejection, savepoints, rollback-to-savepoint, release-savepoint, commit, rollback, expiry, and snapshots.
- Stateful tests cover manager begin/commit, failure rollback, clone-safe reads, timeout expiry, and savepoint sequencing.
- Driver adapter tests should verify that commit/rollback always releases a pooled connection and that SQL errors do not leave a transaction marked active.

## Source References

- PostgreSQL transaction and SAVEPOINT lifecycle patterns.
- MySQL transaction, SAVEPOINT, ROLLBACK TO SAVEPOINT, and RELEASE SAVEPOINT patterns.
- Unit-of-work and repository transaction wrapper patterns.
- Bounded timeout and cleanup patterns for abandoned request-scoped resources.
`;

export const TRANSACTION_SCOPE_MODULE: MwhModule = {
  id: "transaction-scope",
  title: "Transaction Scope Middleware",
  summary:
    "Reusable data-access reference for transaction lifecycle state, savepoints, rollback cleanup, timeout expiry, and driver adapter tests.",
  version: "0.1.0",
  tags: ["data-access", "database", "transaction", "unit-of-work", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
