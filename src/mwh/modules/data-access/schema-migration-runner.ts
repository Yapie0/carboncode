import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Schema Migration Runner Middleware

## Purpose

Use this module as a reusable reference when implementing database schema migration execution in a CLI, service startup flow, or deployment worker.

The module defines provider-neutral migration state: ordered migration plans, checksum validation, lease-based migration locks, fencing tokens, applied records, failed records, and snapshots. SQL execution is intentionally adapter-owned; this module owns the state machine and verification cases.

## When To Use

- A project needs deterministic database migrations without concurrent runners corrupting state.
- Migration files need checksum validation to detect edited history.
- Deployment automation needs a clear pending/applied/failed status model.
- Tests need migration behavior without a real database.

## When Not To Use

- Do not edit already-applied migration files without an explicit repair workflow.
- Do not run migrations without a database-backed lock in distributed deployments.
- Do not keep a migration lock forever; leases must expire.
- Do not treat a failed migration as applied.

## Implementation Variants

- memory-runner: deterministic in-process migration state for unit tests and adapter contracts.
- SQL adapter: stores applied migrations and lock rows in the target database.
- advisory-lock adapter: maps lock acquisition to PostgreSQL advisory locks or MySQL GET_LOCK.
- filesystem adapter: reads migration files, computes checksums, and feeds ordered definitions to the runner.

## Recommended Architecture

- core.ts: pure lock acquisition, release, plan, checksum validation, applied/failed marking, and snapshots.
- memory-runner.ts: stateful reference implementation with applyNext/failNext and clone-safe state reads.
- adapters/sql.ts: persists migration table and lock table in the target database.
- loader.ts: reads migration files and computes stable checksums.

## Public API Sketch

\`\`\`ts
const runner = new MemorySchemaMigrationRunner({
  runnerId: "deploy-1",
  migrations: [
    { id: "001_create_users", checksum: "sha256:a", description: "create users" },
  ],
});

const lock = runner.acquireLock();
if (!lock.acquired) throw new Error("migration lock held");
runner.applyNext();
runner.releaseLock();
\`\`\`

## Integration Steps

1. Load migration definitions in deterministic id order and compute checksums.
2. Acquire a database-backed migration lock before applying any migration.
3. Plan pending migrations and fail fast on checksum mismatch.
4. Apply one migration at a time and record applied or failed state.
5. Release the lock in a finally block.

## Failure Modes

- Concurrent runner: another owner holds an unexpired lock.
- Checksum mismatch: an applied migration file changed after deployment.
- Partial migration failure: record failed state and stop the plan.
- Expired lock: runner must reacquire before marking applied.
- Duplicate migration id: reject the plan before execution.

## Security Notes

- Do not log full migration SQL if it may contain secrets.
- Restrict migration runners to deployment credentials, not request-path database users.
- Keep migration lock and applied rows in the same database being migrated when possible.

## Verification Checklist

- Stateless tests cover lock acquisition, lock contention, lease expiry, plan generation, duplicate id rejection, checksum mismatch, applied marking, failed marking, release, and snapshots.
- Stateful tests cover memory runner applyNext/failNext, clone-safe reads, lock release, and expired lock rejection.
- SQL adapter tests should verify transaction boundaries and lock persistence.

## Source References

- Database migration table patterns used by Flyway, Liquibase, Prisma, and Knex.
- Lease lock and fencing token patterns.
- PostgreSQL advisory lock and MySQL GET_LOCK operational patterns.
`;

export const SCHEMA_MIGRATION_RUNNER_MODULE: MwhModule = {
  id: "schema-migration-runner",
  title: "Schema Migration Runner Middleware",
  summary:
    "Reusable data-access reference for ordered schema migrations, checksum validation, lease locks, failure records, and adapter tests.",
  version: "0.1.0",
  tags: ["data-access", "database", "migration", "schema", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
