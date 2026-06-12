import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Transactional Outbox Middleware

## Purpose

Use this module as a reusable reference when a service must write business state and publish integration events without losing messages or publishing duplicates.

The module contains verified stateless outbox event transitions plus a stateful in-memory store used by tests. Production adapters should persist events in the same database transaction as the business write, then relay them to Kafka, RabbitMQ, RocketMQ, SQS, webhooks, or another broker.

## When To Use

- A database write must reliably emit an event.
- Direct publish inside the request path can fail after the database commit.
- Consumers can tolerate at-least-once delivery and use idempotent handling.

## When Not To Use

- Do not use this as exactly-once messaging.
- Do not use an in-memory store for production.
- Do not skip consumer idempotency; relay retries can duplicate deliveries.

## Implementation Variants

1. Polling publisher
   - Select pending rows with SKIP LOCKED, claim, publish, mark published.
   - Simple and portable.
2. CDC relay
   - Database change stream feeds Debezium/Kafka.
   - Better throughput, more infrastructure.
3. Inline local queue
   - Useful for single-process demos only.

## Recommended Architecture

- core.ts: pure event state machine and retry backoff.
- memory-store.ts: deterministic local adapter for tests.
- adapters/sql.ts: transaction-friendly table implementation.
- relay.ts: claim -> publish -> mark-published/fail loop.
- consumer-inbox.ts: optional idempotent consumer table.

## Public API Sketch

\`\`\`ts
await db.transaction(async (tx) => {
  await tx.orders.insert(order);
  await tx.outbox.insert(createOrderCreatedEvent(order));
});

const event = await outbox.claimNext("worker-1");
try {
  await broker.publish(event.eventType, event.payload);
  await outbox.publish(event.id);
} catch (err) {
  await outbox.fail(event.id, String(err));
}
\`\`\`

## Integration Rules

1. Insert outbox rows in the same transaction as the business state change.
2. Use stable event ids and aggregate ids.
3. Claim events atomically before publishing.
4. Use retry backoff and a dead-letter terminal status.
5. Consumers must be idempotent by event id.
6. Publishing should be at-least-once; avoid claiming exactly-once semantics.

## Failure Modes

- Business write succeeds but event insert is outside the transaction.
- Relay publishes successfully but crashes before marking published; consumers may see duplicates.
- Claimed events can be abandoned; reclaim after claim timeout.
- Poison messages need dead-letter status after max attempts.
- Retrying too quickly can overload the broker or downstream consumers.

## Verification Checklist

- Stateless tests cover create, claim, active claim skip, publish, fail, backoff, dead-letter.
- Stateful store tests cover append -> claim -> publish.
- Stateful store tests cover failure -> delayed retry -> re-claim.
- Stateful store tests cover stale claim takeover.
- Integration adapters should test transaction rollback does not leave orphan events.

## Source References

- Nestixis/nestjs-inbox-outbox: NestJS inbox/outbox module reference.
- suites/transactional-outbox: Node transactional outbox reference.
- Debezium outbox pattern: CDC-based outbox relay reference.
- Enterprise Integration Patterns: at-least-once delivery and idempotent receiver.
`;

export const TRANSACTIONAL_OUTBOX_MODULE: MwhModule = {
  id: "transactional-outbox",
  title: "Transactional Outbox Middleware",
  summary:
    "Reusable eventing reference for transactionally writing business state and relaying integration events with retries.",
  version: "0.1.0",
  tags: ["outbox", "eventing", "queue", "retry", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
