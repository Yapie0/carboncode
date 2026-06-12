import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Dead Letter Queue Middleware

## Purpose

Use this module as a reusable reference when implementing a dead-letter queue for event consumers, outbox relays, webhook delivery, message brokers, or background workers.

The module focuses on failure containment: classify failed messages, store immutable failure context, claim messages for replay with leases, release failed replays, resolve successful replays, archive old records, and expose operational snapshots.

## When To Use

- Consumers need to stop retrying poison messages without losing evidence.
- Operators need to replay or archive failed messages deterministically.
- Multiple workers may inspect or replay dead letters and need a lock/lease contract.
- Tests need dead-letter behavior without Kafka, RabbitMQ, SQS, or Redis.

## When Not To Use

- Do not use this as the primary message broker.
- Do not replay messages without idempotency on the target handler.
- Do not store secrets or raw PII in dead-letter payloads without redaction and retention policy.
- Do not archive actively replaying messages.

## Implementation Variants

- memory-store: deterministic in-process queue for unit tests and adapter contracts.
- SQL adapter: durable dead_letters table with status, reason, payload, lock owner, and timestamps.
- Redis adapter: short-lived operational DLQ with sorted-set indexes by status/reason.
- Broker adapter: maps Kafka/RabbitMQ/SQS dead-letter topics into the common message shape.

## Recommended Architecture

- core.ts: pure message creation, replay claim, release, resolve, archive, cloning, and snapshot aggregation.
- memory-store.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/sql.ts: transactional claim/update using row locks or optimistic versioning.
- adapters/broker.ts: imports broker DLQ payloads and emits replay commands.
- admin routes: list, filter, replay, resolve, archive, and inspect redacted payloads.

## Public API Sketch

\`\`\`ts
const dlq = new MemoryDeadLetterQueue();
dlq.enqueue({
  source: "orders.consumer",
  messageId: "msg-1",
  reason: "max-attempts",
  payload: { orderId: "ord_1" },
  error: "payment service timeout",
  attempts: 5,
});

const claim = dlq.claimReplay({ source: "orders.consumer", messageId: "msg-1", workerId: "worker-a", lockMs: 30_000 });
if (claim.kind === "claimed") dlq.resolve({ source: "orders.consumer", messageId: "msg-1", workerId: "worker-a" });
\`\`\`

## Integration Steps

1. Send terminal retry failures into the DLQ with source, message id, reason, headers, payload, error, and attempt count.
2. Redact payloads before storage when required.
3. Let replay workers claim messages with a finite lease.
4. Resolve only after the target handler confirms success.
5. Release failed replays back to queued with the new error.
6. Archive records only when they are no longer actively replaying.

## Failure Modes

- Poison messages retry forever because there is no terminal DLQ state.
- Replays run concurrently without a lease.
- Operators cannot distinguish schema errors from handler failures.
- Dead-letter payloads mutate after enqueue.
- Archived messages can still be replayed by stale workers.

## Security Notes

- Store redacted payloads or references when messages contain secrets.
- Restrict replay actions to privileged operators or automation.
- Keep audit logs for replay, resolve, and archive operations.
- Pair replay with idempotent consumers or idempotency keys.

## Verification Checklist

- Stateless tests cover enqueue shape, header normalization, replay claim/skip, lock ownership, release, resolve, archive, and snapshot counts.
- Stateful tests cover duplicate enqueue rejection, clone-safe reads, filtered listing, replay lifecycle, active replay skip, and archive restrictions.
- Adapter tests should verify SQL atomic claim semantics and broker topic import/export mapping.

## Source References

- Kafka, RabbitMQ, SQS, and NATS dead-letter queue patterns.
- Idempotent consumer and poison-message handling patterns.
- Operational replay tooling for event-driven systems.
`;

export const DEAD_LETTER_QUEUE_MODULE: MwhModule = {
  id: "dead-letter-queue",
  title: "Dead Letter Queue Middleware",
  summary:
    "Reusable eventing reference for dead-letter message classification, replay leases, release/resolve/archive lifecycle, and operational snapshots.",
  version: "0.1.0",
  tags: ["eventing", "dead-letter", "dlq", "replay", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
