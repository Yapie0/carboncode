import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: In-Memory PubSub Middleware

## Purpose

Use this module as a reusable reference when building process-local event buses, plugin hooks, UI/server event dispatch, domain event fan-out for tests, or lightweight pub/sub before adopting a broker.

The module contains pure event envelope and subscription matching logic plus a stateful in-memory bus for tests. Production adapters can replace memory delivery with Redis Pub/Sub, NATS, Kafka, RabbitMQ, Postgres LISTEN/NOTIFY, or cloud event buses.

## When To Use

- Decouple modules inside one process.
- Build deterministic event-driven unit tests.
- Add plugin or extension hooks.
- Prototype event contracts before choosing an external broker.

## When Not To Use

- Do not use in-memory pub/sub for durable cross-process messaging.
- Do not rely on in-memory delivery for business-critical events.
- Do not let one handler failure stop delivery to other subscribers.

## Recommended Architecture

- core.ts: pure event creation, subscription creation, topic-pattern matching, delivery planning, and deactivation.
- memory-bus.ts: stateful bus with subscribe, publish, unsubscribe, once subscriptions, history, and handler error isolation.
- adapters/redis.ts: cross-process pub/sub adapter.
- adapters/nats.ts: broker-backed subject routing.
- bridge/outbox.ts: durable event bridge when events must survive crashes.

## Public API Sketch

\`\`\`ts
const bus = new MemoryPubSubBus();
bus.subscribe({ topicPattern: "user.*" }, (event) => {
  audit(event.topic, event.payload);
});
bus.subscribe({ topicPattern: "user.created", once: true }, warmWelcomeCache);

const result = bus.publish({
  topic: "user.created",
  payload: { userId: "u1" },
});
if (result.errors.length) logHandlerErrors(result.errors);
\`\`\`

## Integration Rules

1. Use event envelopes with id, topic, payload, metadata, and timestamp.
2. Keep topic naming stable and documented.
3. Isolate handler errors so one subscriber does not block others.
4. Use once subscriptions for one-shot waiters and tests.
5. Bridge to a durable outbox when delivery must survive process crashes.
6. Treat publish results as observability data, not transactional proof.

## Failure Modes

- Events are lost on process restart.
- Subscribers leak when one-shot listeners are not removed.
- Handler exceptions break unrelated subscribers if not isolated.
- Wildcard topics overmatch and trigger unexpected side effects.
- In-memory history grows without bounds in long-lived processes.

## Security Notes

- Do not publish secrets to broad wildcard topics.
- Validate plugin subscribers before giving them access to sensitive events.
- Treat event payloads as internal API contracts.

## Verification Checklist

- Stateless tests cover event creation, subscription creation, exact match, single-segment wildcard, multi-segment wildcard, delivery planning, and once removal plans.
- Stateful tests cover subscribe, publish, unsubscribe, once delivery, handler error isolation, history, and wildcard routing.
- Broker adapter tests should verify reconnect behavior and duplicate delivery policy.
- Durable bridge tests should verify outbox persistence before publish acknowledgment.

## Source References

- Node.js EventEmitter pattern: process-local publish/subscribe.
- NATS subject wildcard semantics.
- Redis Pub/Sub and Postgres LISTEN/NOTIFY process-to-process eventing.
`;

export const IN_MEMORY_PUBSUB_MODULE: MwhModule = {
  id: "in-memory-pubsub",
  title: "In-Memory PubSub Middleware",
  summary:
    "Reusable process-local pub/sub reference with topic patterns, once subscriptions, history, and handler error isolation tests.",
  version: "0.1.0",
  tags: ["eventing", "pubsub", "event-bus", "in-memory", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
