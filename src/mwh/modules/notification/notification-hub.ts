import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Notification Hub Middleware

## Purpose

Use this module as a reusable reference when implementing multi-channel notification delivery for email, SMS, push, in-app, and webhook channels.

This module is intentionally separate from notification-router. notification-router decides which channels should receive a message based on preferences, quiet hours, and dedupe. notification-hub takes those chosen channels, resolves contact destinations, creates per-channel delivery records, and advances delivery state through sent, retryable, dead-lettered, or suppressed.

## When To Use

- A product needs a provider-neutral notification delivery log.
- Different channels share the same message envelope but have separate delivery states.
- Missing or disabled contact destinations should suppress only that channel.
- Provider failures need retry and dead-letter handling.

## When Not To Use

- Do not use the memory hub as a production delivery store.
- Do not put user preference routing rules in the delivery hub.
- Do not treat provider success as guaranteed user visibility.
- Do not store secrets or raw provider credentials in delivery metadata.

## Implementation Variants

1. Memory hub
   - Deterministic tests and single-process demos.
2. SQL delivery log
   - Durable per-channel records with status, attempt, providerMessageId, and lastError.
3. Queue-backed workers
   - Delivery records are persisted first, then workers send due records.
4. Channel adapters
   - SendGrid/Postmark email, Twilio SMS, APNs/FCM push, in-app table, webhook dispatcher bridge.

## Recommended Architecture

- core.ts: pure envelope/contact validation, delivery planning, retry backoff, due checks, sent/failure transitions.
- memory-hub.ts: stateful contact store, enqueue, due selection, sent/failed updates, delivery listing.
- adapters/sql.ts: durable notification_deliveries table.
- adapters/channel-*.ts: provider-specific senders that consume due deliveries.
- worker.ts: polls due deliveries, sends via adapter, records provider result.

## Public API Sketch

\`\`\`ts
const hub = new MemoryNotificationHub();
hub.setContact({ userId: "u1", channel: "email", destination: "u1@example.com" });
hub.setContact({ userId: "u1", channel: "in-app", destination: "u1" });
hub.enqueue({
  id: "n1",
  userId: "u1",
  type: "billing.failed",
  title: "Payment failed",
  body: "Update your card.",
  channels: ["email", "in-app"],
});
for (const delivery of hub.due()) {
  hub.sent(delivery.id, "provider-id");
}
\`\`\`

## Integration Rules

1. Run notification-router before notification-hub when preferences or quiet hours matter.
2. Persist one delivery record per chosen channel.
3. Suppress missing or disabled contacts explicitly instead of silently dropping channels.
4. Retry only provider or transport failures that are actually retryable.
5. Keep provider response IDs for support and reconciliation.
6. Move exhausted deliveries to a dead-letter state with lastError.

## Failure Modes

- Missing contacts can silently drop important notifications without suppressed records.
- Process-local delivery state loses retries on restart.
- Provider-specific errors need classification before retry.
- Duplicated worker sends require idempotency at adapter or provider layer.
- Channel credentials and payloads can leak if logged directly.

## Security Notes

- Store channel destinations and provider IDs as user data.
- Do not log credentials, tokens, or sensitive notification bodies.
- Redact payloads for high-risk notification types.
- Verify webhook channel authorization separately.

## Verification Checklist

- Stateless tests cover envelope/contact validation, per-channel planning, missing/disabled contact suppression, due checks, sent/failure transitions, backoff, and dead-letter.
- Stateful tests cover contact storage, enqueue, due selection, provider success, retry delay, dead-letter, per-message listing, and clone-safe delivery reads.
- SQL adapter tests should verify durable status transitions and concurrent worker safety.
- Provider adapter tests should verify retryable/permanent failure classification.

## Source References

- Multi-channel notification service architecture.
- Durable notification delivery log patterns.
- Provider retry and dead-letter worker patterns.
- SendGrid/Twilio/APNs/FCM style provider message identifiers.
`;

export const NOTIFICATION_HUB_MODULE: MwhModule = {
  id: "notification-hub",
  title: "Notification Hub Middleware",
  summary:
    "Reusable notification delivery hub with per-channel records, contact resolution, retry/dead-letter state, suppression, and stateful tests.",
  version: "0.1.0",
  tags: ["notification", "delivery", "email", "sms", "push", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
