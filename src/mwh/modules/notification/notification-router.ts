import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Notification Router Middleware

## Purpose

Use this module as a reusable reference for notification routing across email, SMS, push, in-app, and webhook channels. It resolves user preferences, muted types, quiet hours, explicit channel overrides, and dedupe windows into a deterministic delivery decision.

This module is intentionally separate from webhook delivery queues and email/SMS provider SDKs. It decides what should be sent; adapters decide how to send it.

## When To Use

- Add user notification preferences to an app.
- Route one notification type to multiple channels.
- Respect muted notification types and quiet hours.
- Prevent duplicate notifications with a dedupe key.
- Build deterministic tests before integrating SendGrid, Twilio, APNs/FCM, webhooks, or in-app storage.

## When Not To Use

- Do not use in-memory dedupe for multi-instance production deployments.
- Do not put provider-specific API calls in the routing core.
- Do not rely on quiet hours for legal or safety-critical suppression.
- Do not send sensitive payloads to broad webhook channels without separate authorization.

## Implementation Variants

- Memory router for unit tests and single-process prototypes.
- SQL preference store with a notification delivery log.
- Redis dedupe store for short-lived duplicate suppression.
- Provider adapters for email, SMS, push, in-app, and webhook delivery.
- Worker queue integration that persists the route decision before dispatch.

## Recommended Architecture

- core.ts: pure message validation, preference normalization, quiet-hour checks, dedupe key generation, and route decisions.
- memory-router.ts: stateful preferences, routed record history, TTL dedupe, and pruning for tests.
- adapters/sql.ts: durable preferences and notification log.
- adapters/redis-dedupe.ts: SET NX EX dedupe windows.
- dispatchers/: channel-specific senders that consume route decisions.

## Public API Sketch

\`\`\`ts
const router = new MemoryNotificationRouter({ dedupeTtlMs: 300_000 });
router.setPreferences({
  userId: "u1",
  enabled: true,
  channels: ["in-app", "email"],
  mutedTypes: ["marketing"],
  quietHours: { startHour: 22, endHour: 8, timezoneOffsetMinutes: 480 },
});

const decision = router.route({
  id: "n1",
  userId: "u1",
  type: "billing.invoice_failed",
  title: "Payment failed",
  body: "Update your payment method.",
  priority: "high",
  dedupeKey: "invoice:inv_1:failed",
});
if (!decision.skipped) dispatch(decision.channels);
\`\`\`

## Integration Rules

1. Keep routing deterministic and provider-neutral.
2. Store user preferences separately from provider delivery logs.
3. Use dedupe keys for repeated domain events.
4. Route by low-cardinality notification type, not arbitrary text.
5. Persist route decisions before async channel dispatch when delivery matters.
6. Use Redis or SQL uniqueness for dedupe in distributed deployments.

## Failure Modes

- Duplicate notifications when dedupe state is process-local.
- User preference changes not reflected by long-lived workers.
- Quiet-hour timezone mistakes suppress or send at the wrong local time.
- Channel adapters fail after the route decision unless delivery is queued durably.
- Overly broad muted types hide important product or security notifications.

## Security Notes

- Check user/channel authorization before routing to webhooks or push tokens.
- Do not store secrets in notification body or routing metadata.
- Treat notification preferences as user data.
- Keep audit logs for high-risk notification categories.

## Verification Checklist

- Stateless tests cover message creation, preference normalization, quiet hours, muted types, channel intersection, dedupe keys, and skip reasons.
- Stateful tests cover preference storage, routing, dedupe replay, TTL pruning, default in-app routing, and decision history.
- Provider adapter tests should verify retries, permanent failures, and payload redaction.
- SQL/Redis adapter tests should verify concurrent dedupe behavior.

## Source References

- Multi-channel notification service patterns.
- Redis SET NX EX dedupe windows.
- User preference and quiet-hour notification models.
- Durable notification outbox and worker dispatch patterns.
`;

export const NOTIFICATION_ROUTER_MODULE: MwhModule = {
  id: "notification-router",
  title: "Notification Router Middleware",
  summary:
    "Reusable notification routing reference with user preferences, quiet hours, channel filtering, dedupe windows, and stateful tests.",
  version: "0.1.0",
  tags: ["notification", "routing", "preferences", "dedupe", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
