import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Webhook Delivery Middleware

## Purpose

Use this module as a reusable reference when building outbound webhook delivery workflows around endpoint policies, HTTP attempt results, retry scheduling, and dead-letter handling.

This module sits above a low-level dispatcher. It models endpoint retry policy, due-delivery selection, attempt classification, exponential backoff, terminal success, and DLQ transitions. Real HTTP clients and durable persistence should be adapter-owned.

## When To Use

- A product needs reliable outbound webhook delivery to customer endpoints.
- Delivery workers need deterministic retry and dead-letter behavior.
- Endpoint-specific policies should control retryable status codes and max attempts.
- Tests need delivery orchestration without real HTTP calls.

## When Not To Use

- Do not use process memory as the durable queue for production webhooks.
- Do not retry every HTTP status. Client errors are often permanent.
- Do not treat webhook delivery as exactly once.
- Do not skip receiver idempotency; retries can produce duplicates.

## Implementation Variants

- memory-delivery: deterministic in-process workflow for unit tests and adapter contracts.
- SQL adapter: stores deliveries and attempts in durable tables.
- queue adapter: schedules retry jobs in BullMQ, SQS, or a delayed job queue.
- HTTP adapter: executes signed requests and feeds status/error results back into the state machine.

## Recommended Architecture

- core.ts: pure create, due, classify, retry-delay, record-attempt, DLQ, and snapshot logic.
- memory-delivery.ts: stateful reference workflow with endpoint policies and clone-safe reads.
- adapters/sql.ts: durable delivery and attempt records.
- adapters/http.ts: maps transport results to recordWebhookAttempt.
- adapters/queue.ts: schedules nextAttemptAtMs through delayed jobs.

## Public API Sketch

\`\`\`ts
const delivery = new MemoryWebhookDelivery({
  endpoints: [{
    endpointId: "ep_1",
    url: "https://example.com/webhook",
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 60_000,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  }],
});

delivery.enqueue({ id: "d1", endpointId: "ep_1", eventType: "invoice.paid", payload: {} });
const due = delivery.due();
delivery.record({ deliveryId: due[0].id, statusCode: 500 });
\`\`\`

## Integration Steps

1. Persist delivery rows before acknowledging the domain event.
2. Select due deliveries by nextAttemptAtMs and endpoint policy.
3. Execute the HTTP request in an adapter and feed status/error into recordWebhookAttempt.
4. Schedule retry jobs when the attempt outcome is retry.
5. Surface dead-lettered deliveries in an operator-visible queue.

## Failure Modes

- Permanent client error: move to DLQ instead of retrying forever.
- Retryable outage: schedule exponential backoff up to max attempts.
- Worker crash: durable adapter should leave the delivery due for another worker.
- Missing endpoint policy: fail fast before enqueueing.
- Silent DLQ growth: alert on dead-letter counts.

## Security Notes

- Sign webhook payloads in the HTTP adapter.
- Do not log secrets or sensitive payload fields.
- Redact endpoint URLs if they contain credentials.
- Receivers must verify signatures and dedupe by delivery id.

## Verification Checklist

- Stateless tests cover enqueue, due selection, status classification, retry delay, successful attempt, retry scheduling, DLQ transition, and snapshots.
- Stateful tests cover endpoint policy lookup, due flow, retry after time advance, clone-safe reads, success, and dead-lettering.
- Adapter tests should verify durable attempt records and HTTP result mapping.

## Source References

- Stripe and GitHub webhook redelivery behavior.
- Svix-style endpoint delivery logs and retry schedules.
- Delayed job queue retry/DLQ patterns.
`;

export const WEBHOOK_DELIVERY_MODULE: MwhModule = {
  id: "webhook-delivery",
  title: "Webhook Delivery Middleware",
  summary:
    "Reusable notification reference for webhook endpoint policies, attempt classification, retry scheduling, DLQ transitions, and adapter tests.",
  version: "0.1.0",
  tags: ["notification", "webhook", "delivery", "retry", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
