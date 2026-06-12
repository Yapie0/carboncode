import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Repository Unit Of Work Middleware

## Purpose

Use this module as a reusable reference for repository unit-of-work orchestration: begin a business transaction, stage repository operations, apply steps, commit only after all steps are applied, and rollback with compensation metadata.

This module sits above transaction-scope. transaction-scope models database transaction primitives; repository-unit-of-work models application-level repository coordination.

## When To Use

- Need multiple repository operations to share one logical transaction boundary.
- Need deterministic tests for staged/applied/committed/rolled-back flows.
- Need a provider-neutral state machine before wiring Prisma, TypeORM, Knex, SQL, or custom repositories.
- Need to keep transaction orchestration out of business handlers.

## When Not To Use

- Do not use it as a replacement for database transactions.
- Do not commit while steps are still staged.
- Do not assume compensation can perfectly undo external side effects.
- Do not expose internal repository operation names to untrusted clients.

## Implementation Variants

- Memory store for tests and local prototypes.
- Prisma adapter using interactive transactions.
- TypeORM/Knex adapter using query runner/transaction scopes.
- SQL adapter using explicit connection and transaction handles.
- Outbox integration for external side effects after commit.

## Recommended Architecture

- core.ts: pure unit creation, step staging, step application, commit gate, rollback compensation, snapshots, and clone helpers.
- memory-store.ts: stateful begin, stage, apply, commit, rollback, get, and snapshots.
- adapters/prisma.ts: wraps Prisma transaction client.
- adapters/typeorm.ts: wraps QueryRunner or EntityManager.
- integrations/outbox.ts: emits domain events only after commit.

## Public API Sketch

\`\`\`ts
const store = new MemoryUnitOfWorkStore();
store.begin({ id: "uow-1", ownerId: "order-service" });
store.stage({
  unitId: "uow-1",
  stepId: "create-order",
  repository: "orders",
  operation: "insert",
  entityId: "order-1",
});
store.apply({ unitId: "uow-1", stepId: "create-order" });
store.commit("uow-1");
\`\`\`

## Integration Rules

1. Keep one unit-of-work per business command.
2. Stage intended repository operations before applying them.
3. Commit only after all staged steps are applied.
4. Roll back and mark applied steps as compensated on failure.
5. Emit external side effects after commit, preferably through an outbox.
6. Keep provider adapters behind the same unit-of-work contract.

## Failure Modes

- Committing with staged steps produces partial writes.
- Compensation metadata is mistaken for actual external rollback.
- Long-lived units keep database transactions open too long.
- Repository adapters leak provider-specific clients into business logic.
- Retried commands create duplicate units without idempotency keys.

## Security Notes

- Validate owner and repository names before exposing diagnostics.
- Avoid storing secrets or raw SQL in step metadata.
- Audit commit and rollback decisions for high-risk commands.
- Pair with idempotency keys for retried write commands.

## Verification Checklist

- Stateless tests cover begin, stage, duplicate steps, apply, commit gate, rollback compensation, snapshots, and clone safety.
- Stateful tests cover begin/stage/apply/commit, rollback, missing units, duplicate unit IDs, committed-unit mutation rejection, and clone-safe reads.
- ORM adapters should test commit, rollback on thrown errors, and client scoping.
- Outbox integrations should test events are emitted only after commit.

## Source References

- Unit of Work pattern from repository architecture.
- Repository transaction orchestration patterns.
- Prisma/TypeORM/Knex transaction wrapper patterns.
- Transactional outbox integration for post-commit side effects.
`;

export const REPOSITORY_UNIT_OF_WORK_MODULE: MwhModule = {
  id: "repository-unit-of-work",
  title: "Repository Unit Of Work Middleware",
  summary:
    "Reusable data-access reference with repository operation staging, apply/commit gates, rollback compensation, snapshots, and stateful unit tests.",
  version: "0.1.0",
  tags: ["data-access", "repository", "unit-of-work", "transaction", "orm", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
