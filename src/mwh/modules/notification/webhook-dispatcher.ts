import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Webhook Dispatcher Middleware

## Purpose

Use this module as a reusable reference when building outbound webhook delivery for SaaS products, integrations, payment-like event notifications, audit exports, or internal event fan-out.

The module includes pure delivery state transitions, HMAC signing, retry backoff, worker claims, and a deterministic memory dispatcher for tests. Production adapters should replace the memory store with a durable database table, queue, or transactional outbox integration.

## When To Use

- Deliver domain events to customer-owned HTTP endpoints.
- Add retry, dead-letter, and delivery audit behavior around outbound integrations.
- Sign webhook requests so receivers can verify authenticity.
- Coordinate multiple workers without double-delivering the same event.

## When Not To Use

- Do not use process memory as the durable delivery queue.
- Do not treat webhooks as exactly-once delivery; receivers must still be idempotent.
- Do not skip delivery persistence for business-critical external notifications.

## Recommended Architecture

- core.ts: pure delivery creation, signing, claim, completion, failure, backoff, and stale claim release.
- memory-store.ts: deterministic stateful dispatcher for unit tests and local demos.
- adapters/sql.ts: durable table with status, availableAt, claim owner, and claim expiry columns.
- adapters/queue.ts: queue-backed worker adapter when retry scheduling is delegated to infrastructure.
- receiver.ts: optional helper for inbound signature verification.

## Public API Sketch

\`\`\`ts
const dispatcher = new MemoryWebhookDispatcher({
  backoff: { baseDelayMs: 1_000, maxDelayMs: 60_000 },
});

dispatcher.enqueue({
  id: "delivery-1",
  endpointId: "endpoint-1",
  url: "https://example.com/webhooks",
  eventType: "invoice.paid",
  payload: { invoiceId: "inv_1" },
});

const delivery = dispatcher.claimNext("worker-a");
if (delivery) {
  const body = JSON.stringify(delivery.payload);
  const headers = signWebhook({ secret, timestampMs: Date.now(), body });
  await post(delivery.url, body, headers);
  dispatcher.complete(delivery.id, "worker-a");
}
\`\`\`

## Integration Rules

1. Persist deliveries before returning success for the domain operation.
2. Include event id, delivery id, event type, timestamp, and signature headers in every request.
3. Use HMAC over \`timestamp.body\` and compare signatures with constant-time comparison.
4. Retry only transport failures and explicit retryable HTTP statuses.
5. Stop retrying after max attempts and keep dead-letter entries inspectable.
6. Require receivers to handle duplicate deliveries idempotently.

## Failure Modes

- Duplicate deliveries after worker crash or claim expiry.
- Lost events when enqueue is not transactional with the domain write.
- Webhook storms when retry backoff lacks caps or jitter.
- Signature bypasses from raw string comparison or unsigned timestamps.
- Dead-letter queues growing silently without operational alerts.

## Security Notes

- Store webhook secrets encrypted at rest.
- Do not log raw secrets, full authorization headers, or sensitive payload fields.
- Reject inbound signatures with stale timestamps to reduce replay risk.
- Rotate endpoint secrets with overlapping old/new verification windows.

## Verification Checklist

- Stateless tests cover HMAC signing/verification, claim conflicts, retry backoff, delivery completion, and dead-letter transition.
- Stateful tests cover enqueue, claim, complete, fail, delayed retry, max-attempt dead-letter, and stale claim takeover.
- Adapter tests should verify atomic claim acquisition under concurrent workers.
- Integration tests should assert receiver idempotency using the delivery id.

## Source References

- Stripe webhook signing model: timestamped HMAC payload signatures.
- Svix webhook delivery patterns: retries, signatures, and endpoint delivery logs.
- GitHub webhooks: event type headers, delivery ids, and redelivery behavior.
`;

export const WEBHOOK_DISPATCHER_MODULE: MwhModule = {
  id: "webhook-dispatcher",
  title: "Webhook Dispatcher Middleware",
  summary:
    "Reusable outbound webhook dispatcher with HMAC signatures, worker claims, retry backoff, and delivery-state tests.",
  version: "0.1.0",
  tags: ["webhook", "notification", "hmac", "retry", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
