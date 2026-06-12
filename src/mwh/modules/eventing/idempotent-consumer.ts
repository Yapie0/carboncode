import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Idempotent Consumer Middleware

## Purpose

Use this module as a reusable reference for message consumers that must process each logical message at most once even when brokers, webhooks, jobs, or event relays deliver duplicates.

This module complements transactional outbox. Outbox makes publish reliable; idempotent consumer makes receive-side handling safe under duplicate delivery and worker crashes.

## When To Use

- Consume Kafka, RabbitMQ, NATS, Redis Stream, SQS, or webhook events with at-least-once delivery.
- Need duplicate detection by consumer name and message id.
- Need processing locks so two workers do not handle the same message at the same time.
- Need retry delay and dead-letter behavior for failed message handlers.
- Need deterministic tests before wiring SQL/Redis/broker acknowledgements.

## When Not To Use

- Do not use process-local memory as distributed idempotency storage.
- Do not acknowledge broker messages before the side effect and consumer record are durably committed.
- Do not use message ids that can collide across event producers without including consumer namespace.
- Do not hide poison messages without a dead-letter inspection path.

## Implementation Variants

- Memory store for local tests and single-process prototypes.
- SQL table with unique key on consumerName + messageId and transactional side effects.
- Redis SET/Hash adapter with locks and TTL for short-lived idempotency windows.
- Broker-specific adapters for Kafka, RabbitMQ, SQS, NATS, or webhook receivers.

## Recommended Architecture

- core.ts: pure consumer key generation, begin decision, lock ownership, success/failure transitions, retry delay, and dead-letter transitions.
- memory-store.ts: stateful begin/succeed/fail/query behavior for tests.
- adapters/sql.ts: durable consumer message table and transaction helper.
- adapters/redis.ts: distributed locks and duplicate detection.
- middleware/worker.ts: wraps broker handlers and maps outcomes to ack/nack/dead-letter.

## Public API Sketch

\`\`\`ts
const store = new MemoryIdempotentConsumerStore({ lockMs: 30_000 });
const begin = store.begin({
  consumerName: "billing-projection",
  messageId: event.id,
  workerId: "worker-a",
});
if (begin.kind !== "started") return begin;

try {
  await updateProjection(event);
  store.succeed("billing-projection", event.id, "worker-a", { projected: true });
} catch (error) {
  store.fail("billing-projection", event.id, "worker-a", String(error));
}
\`\`\`

## Integration Rules

1. Use a stable consumerName plus producer messageId as the idempotency key.
2. Begin consumption before running side effects.
3. Commit side effects and success state atomically when possible.
4. Treat duplicate-success as a safe no-op and broker ack.
5. Retry failed records only after nextAttemptAtMs.
6. Move poison messages to dead-letter after maxAttempts.

## Failure Modes

- Duplicate side effects when the consumer record and business write are not atomic.
- Permanent lockout if processing locks never expire.
- Premature retry if worker clocks diverge.
- Poison messages retry forever without maxAttempts.
- Message id reuse across producers causes false duplicate suppression.

## Security Notes

- Do not store full sensitive payloads in consumer records unless encrypted.
- Treat consumer result/error fields as operational metadata.
- Use bounded retention or archival for processed message records.

## Verification Checklist

- Stateless tests cover key generation, first begin, duplicate success, active lock skip, stale lock takeover, retry delay, success, failure, and dead-letter.
- Stateful tests cover begin/succeed/fail/retry/takeover, duplicate no-op, maxAttempts, and status listing.
- SQL adapter tests should verify unique constraints and transactional side effects.
- Broker adapter tests should verify ack/nack mapping for started, duplicate-success, skip, failed, and dead-letter outcomes.

## Source References

- Idempotent consumer pattern for at-least-once message brokers.
- Transactional inbox / processed messages table pattern.
- Redis lock and TTL based duplicate suppression.
- Dead-letter queue handling for poison messages.
`;

export const IDEMPOTENT_CONSUMER_MODULE: MwhModule = {
  id: "idempotent-consumer",
  title: "Idempotent Consumer Middleware",
  summary:
    "Reusable event consumer reference with duplicate detection, processing locks, retry delay, dead-letter transitions, and stateful tests.",
  version: "0.1.0",
  tags: ["eventing", "idempotency", "consumer", "retry", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
