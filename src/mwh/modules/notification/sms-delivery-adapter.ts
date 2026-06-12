import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: SMS Delivery Adapter

## Purpose

Use this module as a reusable reference for provider-neutral SMS delivery: normalize E.164 phone numbers, estimate SMS segments, enqueue delivery records, classify provider responses, retry transient failures, and dead-letter exhausted or permanent failures.

The module is a channel adapter that can sit behind notification-router or notification-hub. It keeps routing and consent policy outside the low-level SMS sender while providing a concrete tested boundary for Twilio, Vonage, AWS SNS, Alibaba Cloud SMS, Tencent Cloud SMS, or local fake providers.

## When To Use

- Need transactional SMS such as OTP, security notices, delivery updates, or billing alerts.
- Need deterministic tests for phone normalization, segment counting, retry, and dead-letter behavior.
- Need provider-neutral response classification before binding to a vendor SDK.
- Need an outbox-style SMS record for workers and audit.

## When Not To Use

- Do not use this adapter as the consent/preference system.
- Do not accept non-E.164 phone numbers at the delivery boundary.
- Do not retry provider-rejected permanent failures indefinitely.
- Do not log sensitive SMS bodies such as OTP codes.

## Implementation Variants

- Memory outbox for tests and local prototypes.
- SQL outbox table with worker leases, retry scheduling, and provider audit.
- Redis delayed queue for short-lived transactional SMS.
- Provider adapters for Twilio, Vonage, AWS SNS, Alibaba Cloud SMS, Tencent Cloud SMS, and local capture.
- OTP adapter that composes rate limits, template policy, and SMS delivery.

## Recommended Architecture

- core.ts: pure E.164 normalization, SMS segment estimation, message creation, delivery record transitions, due checks, and backoff calculation.
- memory-outbox.ts: stateful enqueue, due, deliver, get, and list behavior with injected provider.
- adapters/sql.ts: durable outbox rows, worker claim, retry scheduling, and dead-letter state.
- providers/: provider-specific mapping from SmsMessage to SDK calls.
- integrations/otp.ts: OTP-specific rate limit, code storage, and send policy.

## Public API Sketch

\`\`\`ts
const outbox = new MemorySmsDeliveryOutbox({
  provider: async (message) => sendWithTwilio(message),
});

outbox.enqueue({
  id: "sms-1",
  to: "+14155552671",
  body: "Your code is 123456",
  maxAttempts: 3,
});

for (const due of outbox.due()) {
  await outbox.deliver(due.id);
}
\`\`\`

## Integration Rules

1. Normalize phone numbers to E.164 before enqueue.
2. Enforce consent, unsubscribe, and regional policy before enqueue.
3. Persist delivery records before calling the provider.
4. Retry only transient failures and cap attempts.
5. Track SMS segment counts for cost and length controls.
6. Redact OTPs and sensitive SMS bodies in logs.

## Failure Modes

- Local phone formats reach provider SDKs and fail inconsistently.
- Long Unicode messages unexpectedly split into multiple billable segments.
- Permanent provider failures are retried until they create cost or compliance risk.
- Memory outbox loses pending delivery records on restart.
- Duplicate sends occur without provider idempotency or durable worker claims.

## Security Notes

- Treat phone numbers and SMS bodies as personal data.
- Keep OTP code lifecycle separate from provider delivery state.
- Avoid logging full SMS bodies for security-sensitive message types.
- Use provider idempotency or durable delivery IDs where available.

## Verification Checklist

- Stateless tests cover E.164 normalization, invalid phone rejection, GSM/Unicode segment estimation, message creation, due checks, success, retry, dead-letter, suppressed records, and backoff.
- Stateful tests cover enqueue, duplicate rejection, due ordering, provider success, retry scheduling, dead-letter after max attempts, non-due rejection, and clone-safe records.
- Provider adapter tests should run against local fakes or sandbox APIs.
- SQL/queue adapters should verify worker claim and idempotent retry behavior.

## Source References

- Transactional SMS outbox patterns.
- Twilio, Vonage, AWS SNS, Alibaba Cloud SMS, and Tencent Cloud SMS adapter boundaries.
- E.164 phone number normalization.
- GSM-7/UCS-2 SMS segment estimation.
- Exponential backoff and dead-letter delivery queues.
`;

export const SMS_DELIVERY_ADAPTER_MODULE: MwhModule = {
  id: "sms-delivery-adapter",
  title: "SMS Delivery Adapter",
  summary:
    "Reusable notification reference for E.164 SMS delivery, segment estimation, provider response classification, retry scheduling, and stateful outbox tests.",
  version: "0.1.0",
  tags: ["notification", "sms", "delivery", "outbox", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
