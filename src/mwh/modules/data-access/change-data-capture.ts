import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Change Data Capture Middleware

## Purpose

Use this module as a reusable reference for change data capture: normalize database row changes into ordered envelopes, track consumer cursors, read batches, acknowledge progress, and expose snapshots.

This module bridges data-access and eventing. Captured changes can feed event-bus-adapter, transactional-outbox, query-result-cache invalidation, search indexing, or audit pipelines.

## When To Use

- Need table-level insert/update/delete changes as ordered events.
- Need per-consumer cursors and resumable reads.
- Need a small local CDC model before wiring Debezium, Postgres logical replication, MySQL binlog, SQLite triggers, or polling queries.
- Need deterministic tests for cache invalidation or event projection flows.

## When Not To Use

- Do not use process-local memory as durable CDC storage.
- Do not expose raw row images without redaction.
- Do not assume CDC delivery is exactly-once; consumers should be idempotent.
- Do not ack a cursor before downstream side effects are durable.

## Implementation Variants

- Memory log for tests and local prototypes.
- SQL polling adapter using monotonically increasing sequence columns.
- Trigger table adapter that appends row changes inside database transactions.
- Postgres logical replication adapter.
- Debezium/Kafka adapter that maps source envelopes into the same contract.

## Recommended Architecture

- core.ts: pure change creation, envelope mapping, cursor creation, batch reads, ack progression, snapshots, and clone helpers.
- memory-log.ts: stateful append, ensureCursor, read, ack, listChanges, and snapshot behavior.
- adapters/sql-poll.ts: polling query plus checkpoint storage.
- adapters/debezium.ts: map Debezium payloads into CdcChange.
- integrations/cache.ts: invalidate query-result-cache tags from CDC envelopes.

## Public API Sketch

\`\`\`ts
const log = new MemoryCdcLog();
log.append({
  table: "orders",
  primaryKey: "order-1",
  operation: "insert",
  after: { id: "order-1", status: "created" },
});

const batch = log.read({ consumerId: "cache-invalidator", limit: 100 });
log.ack({ consumerId: "cache-invalidator", sequence: batch.at(-1)!.change.sequence });
\`\`\`

## Integration Rules

1. Keep CDC sequences monotonically increasing.
2. Ack only after downstream processing succeeds.
3. Treat consumers as at-least-once and idempotent.
4. Redact sensitive columns before publishing outside trusted boundaries.
5. Preserve table and primary key as routing metadata.
6. Use durable cursor storage in production.

## Failure Modes

- Acking too early loses unprocessed changes.
- Non-idempotent consumers duplicate side effects after retry.
- Missing redaction leaks sensitive row fields.
- Polling adapters miss changes without stable sequence columns.
- Local memory logs lose changes after restart.

## Security Notes

- Redact secrets and PII before publishing CDC envelopes.
- Restrict consumer access by table/topic.
- Audit cursor rewinds and manual checkpoint changes.
- Avoid including raw SQL in change metadata.

## Verification Checklist

- Stateless tests cover insert/update/delete validation, envelope mapping, cursor creation, batch filtering, ack progression, backward ack rejection, snapshots, and clone safety.
- Stateful tests cover append, read, ack, table filtering, multiple consumers, snapshots, and clone-safe changes.
- SQL/Debezium adapters should test ordering, restart resume, malformed payloads, and idempotent downstream processing.
- Cache integration should test invalidation after ack-safe processing.

## Source References

- Change Data Capture and transaction log tailing patterns.
- Debezium-style source envelopes.
- Postgres logical replication and MySQL binlog CDC.
- Polling-based CDC with sequence checkpoints.
`;

export const CHANGE_DATA_CAPTURE_MODULE: MwhModule = {
  id: "change-data-capture",
  title: "Change Data Capture Middleware",
  summary:
    "Reusable data-access reference with ordered row changes, envelopes, consumer cursors, batch reads, ack progression, and stateful CDC tests.",
  version: "0.1.0",
  tags: ["data-access", "cdc", "change-data-capture", "eventing", "cursor", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
