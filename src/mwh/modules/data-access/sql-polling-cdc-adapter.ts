import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: SQL Polling CDC Adapter

## Purpose

Use this module as a reusable reference for polling a SQL change table or monotonically sequenced source and converting rows into the common change-data-capture contract.

This is the pragmatic CDC variant for applications that do not have Debezium, logical replication, or broker infrastructure yet.

## When To Use

- Need CDC-like behavior from a normal database table or trigger-maintained change table.
- Need deterministic local tests for polling, checkpointing, and restart resume.
- Need to feed query-result-cache invalidation, search indexing, audit projections, or event-bus publishing from database changes.
- Need a migration path from polling CDC to Debezium or logical replication later.

## When Not To Use

- Do not poll unordered tables without a stable monotonic sequence.
- Do not advance checkpoints before downstream processing has succeeded.
- Do not use polling for very high-volume transaction logs without backpressure and index planning.
- Do not build SQL text from untrusted identifiers.

## Implementation Variants

- Memory adapter for tests and local fixtures.
- SQL change-table adapter with a sequence column and persisted checkpoint table.
- Trigger-table adapter that writes before/after payloads in the same transaction.
- Timestamp polling adapter with tie-breaker sequence.
- Debezium bridge that reuses the same CDC change contract.

## Recommended Architecture

- core.ts: pure source validation, polling SQL plan generation, row-to-CDC mapping, batch slicing, and checkpoint progression.
- memory-adapter.ts: stateful append, poll, ack, checkpoint, and clone-safe fixture behavior.
- adapters/sql.ts: execute the polling plan inside a read-only transaction and persist checkpoints after processing.
- integrations/cache.ts: map table names to query-result-cache invalidation tags.

## Public API Sketch

\`\`\`ts
const adapter = new MemorySqlPollingCdcAdapter({ source });
adapter.append({
  primaryKey: "order-1",
  operation: "insert",
  after: { id: "order-1", status: "created" },
});

const batch = adapter.poll({ consumerId: "search-indexer", limit: 100 });
// process batch.changes durably
adapter.ack({ consumerId: "search-indexer", sequence: batch.nextCheckpoint!.lastSequence });
\`\`\`

## Integration Rules

1. Add an index on the sequence column used by the polling query.
2. Store checkpoints durably per consumer and table.
3. Process changes idempotently because polling is at-least-once.
4. Ack only after downstream writes are durable.
5. Keep SQL identifiers configured, not user supplied.
6. Include delete rows through tombstones or trigger-maintained before payloads.

## Failure Modes

- Missing sequence indexes make polling expensive under load.
- Timestamp-only polling can skip rows with equal timestamps unless a tie-breaker is used.
- Early checkpoint ack loses unprocessed changes.
- Restart without durable checkpoints replays the whole stream.
- Unredacted before/after payloads can leak sensitive fields.

## Security Notes

- Validate table and column identifiers against a strict identifier allowlist.
- Redact PII before publishing CDC events outside the service boundary.
- Restrict checkpoint mutation to trusted workers.
- Audit manual checkpoint rewinds.

## Verification Checklist

- Stateless tests cover SQL plan generation, identifier rejection, row-to-CDC mapping, sorted batches, limit behavior, and backward checkpoint rejection.
- Stateful tests cover append, poll without ack, ack, resume after ack, multiple consumers, and clone-safe rows.
- SQL adapter tests should cover restart resume and malformed row rejection.
- Cache integration tests should prove cache invalidation only happens after successful processing.

## Source References

- Polling-based CDC with sequence checkpoints.
- Database trigger change-table patterns.
- Debezium row envelope concepts.
- SQL keyset polling and durable consumer checkpoint patterns.
`;

export const SQL_POLLING_CDC_ADAPTER_MODULE: MwhModule = {
  id: "sql-polling-cdc-adapter",
  title: "SQL Polling CDC Adapter",
  summary:
    "Reusable data-access reference for polling SQL change rows, mapping them to CDC changes, and managing durable per-consumer checkpoints.",
  version: "0.1.0",
  tags: ["data-access", "cdc", "sql", "polling", "checkpoint", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
