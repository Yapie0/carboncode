import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Push Delivery Adapter

## Purpose

Use this module as a reusable reference for provider-neutral push notification delivery: register device targets, plan APNs/FCM/Web push messages, normalize payload data, honor collapse keys and TTL, classify provider responses, retry transient failures, and dead-letter invalid-token or exhausted sends.

The module is a channel adapter that can sit behind notification-router or notification-hub. It keeps user preferences, consent, and app-level notification routing outside the low-level provider boundary.

## When To Use

- Need mobile or browser push notifications through APNs, FCM, Web Push, Expo, or a local fake provider.
- Need deterministic tests for target planning, TTL expiry, invalid-token handling, retry, and dead-letter behavior.
- Need an outbox-style delivery record for async push workers.
- Need provider-neutral response classification before binding to a vendor SDK.

## When Not To Use

- Do not use this adapter as the notification preference or consent system.
- Do not keep invalid device tokens active after provider rejection.
- Do not retry permanent invalid-token failures.
- Do not put sensitive data in push payload fields.

## Implementation Variants

- Memory outbox for tests and local prototypes.
- SQL outbox table with worker leases, retry scheduling, and provider audit.
- Redis delayed queue for high-volume push retries.
- Provider adapters for APNs, FCM, Web Push, Expo, and local capture.
- Device registry adapter for token rotation, invalidation, and user-device indexing.

## Recommended Architecture

- core.ts: pure target validation, message planning, payload normalization, delivery record transitions, TTL expiry, due checks, and backoff calculation.
- memory-outbox.ts: stateful target registry plus enqueue, due, deliver, get, and list behavior with injected provider.
- adapters/sql.ts: durable outbox rows, worker claim, retry scheduling, and dead-letter state.
- providers/: provider-specific mapping from PushMessage to SDK calls.
- integrations/device-registry.ts: token lifecycle and invalid-token cleanup.

## Public API Sketch

\`\`\`ts
const outbox = new MemoryPushDeliveryOutbox({
  provider: async (message) => sendWithFcm(message),
});

outbox.setTarget({
  userId: "u1",
  platform: "fcm",
  token: "device-token",
});

outbox.enqueue({
  id: "push-1",
  userId: "u1",
  title: "Build finished",
  body: "Your deploy is live.",
  collapseKey: "deploy-status",
  ttlMs: 300_000,
});
\`\`\`

## Integration Rules

1. Keep provider SDK calls behind an adapter interface.
2. Persist delivery records before calling the provider.
3. Remove or disable tokens after invalid-token provider responses.
4. Use collapse keys for replaceable notifications.
5. Use TTL to avoid sending stale push events.
6. Avoid sensitive data in payload fields; fetch details after app open.

## Failure Modes

- Invalid tokens remain active and cause repeated provider failures.
- TTL is ignored and stale notifications reach users.
- Collapse keys are missing and users receive noisy duplicate updates.
- Memory outbox loses pending delivery records on restart.
- Duplicate sends occur without provider idempotency or durable worker claims.

## Security Notes

- Treat device tokens as sensitive user-linked identifiers.
- Do not place secrets, OTPs, or personal details in push data payloads.
- Keep authorization checks outside the provider adapter and before enqueue.
- Use provider feedback to disable invalid tokens promptly.

## Verification Checklist

- Stateless tests cover target creation, message planning, payload normalization, TTL due checks, success, retry, invalid-token dead-letter, suppressed records, and backoff.
- Stateful tests cover target storage, enqueue, missing-target suppression, provider success, retry scheduling, TTL expiry, invalid-token dead-letter, non-due rejection, and clone-safe records.
- Provider adapter tests should run against local fakes or sandbox APIs.
- SQL/queue adapters should verify worker claim and idempotent retry behavior.

## Source References

- APNs, FCM, Web Push, and Expo provider adapter boundaries.
- Device token registry and invalid-token cleanup patterns.
- Push collapse-key and TTL delivery semantics.
- Exponential backoff and dead-letter delivery queues.
`;

export const PUSH_DELIVERY_ADAPTER_MODULE: MwhModule = {
  id: "push-delivery-adapter",
  title: "Push Delivery Adapter",
  summary:
    "Reusable notification reference for APNs/FCM/Web push targets, collapse keys, TTL expiry, provider response classification, retry scheduling, and stateful outbox tests.",
  version: "0.1.0",
  tags: ["notification", "push", "delivery", "apns", "fcm", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
