import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Event Bus Adapter Middleware

## Purpose

Use this module as a reusable reference when building provider-neutral event bus adapters for Kafka, Pulsar, NATS, EventBridge, Redis Streams, or local in-memory brokers.

The module defines a normalized event envelope, topic binding rules, subscription filtering, publish audit records, and a deterministic memory broker for tests. It complements transactional-outbox and idempotent-consumer: the outbox persists events before publish, this module maps events onto bus topics, and consumers still need idempotency.

## When To Use

- A codebase needs one event envelope across multiple broker providers.
- Event types need routing to broker topics.
- Subscriptions need topic and event-type filters.
- Tests should verify publish routing without external Kafka/Redis infrastructure.

## When Not To Use

- Do not use the memory broker as a durable production broker.
- Do not assume broker delivery is exactly once.
- Do not replace transactional outbox with direct publish inside a domain transaction.
- Do not put secrets or large payloads in event headers.

## Recommended Architecture

- core.ts: pure envelope creation, topic binding, wildcard matching, delivery planning, and publish audit records.
- memory-broker.ts: stateful bind, subscribe, publish, readTopic, listSubscriptions, and publish history.
- adapters/kafka.ts: maps envelope to topic/key/headers.
- adapters/eventbridge.ts: maps envelope to source/detail-type/detail.
- adapters/redis-streams.ts: maps envelope to stream entries and consumer groups.

## Verification Checklist

- Stateless tests cover envelope normalization, wildcard matching, topic resolution, subscription filtering, and publish record creation.
- Stateful tests cover binding, subscribing, publishing, per-topic history, duplicate subscription rejection, unsubscribe, and clone-safe reads.
- Broker adapter tests should verify provider-specific topic/header mapping and retry behavior.
`;

export const EVENT_BUS_ADAPTER_MODULE: MwhModule = {
  id: "event-bus-adapter",
  title: "Event Bus Adapter Middleware",
  summary:
    "Reusable eventing reference for provider-neutral event envelopes, topic routing, subscription filters, publish audit, and broker adapter tests.",
  version: "0.1.0",
  tags: ["eventing", "event-bus", "broker", "kafka", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
