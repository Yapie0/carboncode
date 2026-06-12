import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Email Delivery Adapter

## Purpose

Use this module as a reusable reference for provider-neutral email delivery: render templates, normalize recipients, enqueue delivery records, classify provider responses, retry transient failures, and dead-letter permanent or exhausted sends.

The module is intentionally smaller than a full notification platform. It is the channel adapter that can sit behind notification-router or notification-hub when an app needs a concrete email implementation boundary.

## When To Use

- Need to integrate SendGrid, Amazon SES, Resend, Mailgun, SMTP, or a local test email sink.
- Need deterministic tests for template rendering, recipient validation, retry, and dead-letter behavior.
- Need an outbox-style delivery record before async workers call provider SDKs.
- Need provider-neutral response classification.

## When Not To Use

- Do not put user notification preference routing in this adapter.
- Do not send emails without validating recipient scope and unsubscribe policy.
- Do not retry permanent provider failures indefinitely.
- Do not log full email bodies when they may contain personal data.

## Implementation Variants

- Memory outbox for tests and local prototypes.
- SQL outbox table with worker leases and provider result audit.
- Redis delayed retry queue for short-lived transactional email.
- Provider adapters for SES, SendGrid, Resend, Mailgun, SMTP, and local capture.
- Template registry adapter that loads versioned templates from MWH or app config.

## Recommended Architecture

- core.ts: pure template rendering, recipient normalization, message creation, delivery record transitions, due checks, and backoff calculation.
- memory-outbox.ts: stateful enqueue, due, deliver, get, and list behavior with injected provider.
- adapters/sql.ts: durable outbox rows, worker claim, retry scheduling, and dead-letter state.
- providers/: provider-specific mapping from EmailMessage to SDK calls.
- templates/: versioned template source and preview fixtures.

## Public API Sketch

\`\`\`ts
const outbox = new MemoryEmailDeliveryOutbox({
  provider: async (message) => sendWithSes(message),
});

outbox.enqueue({
  id: "email-1",
  to: "user@example.com",
  subject: "Reset your password",
  text: "Use this link: ...",
  maxAttempts: 3,
});

for (const due of outbox.due()) {
  await outbox.deliver(due.id);
}
\`\`\`

## Integration Rules

1. Keep provider SDK calls behind an adapter interface.
2. Persist delivery records before calling the provider.
3. Retry only transient failures and cap attempts.
4. Store provider message IDs for audit and support.
5. Normalize and dedupe recipients before enqueue.
6. Redact or avoid logging personal email content.

## Failure Modes

- Provider timeout leaves a message unknown without idempotency keys.
- Permanent failures are retried until they create noise or account risk.
- Template variables remain unresolved and reach users.
- Duplicate recipients receive the same transactional email multiple times.
- Memory outbox loses pending delivery records on restart.

## Security Notes

- Treat email addresses and bodies as personal data.
- Keep unsubscribe and consent rules outside the low-level adapter but enforce them before enqueue.
- Never place secrets in template variables that may be logged.
- Use provider idempotency where available.

## Verification Checklist

- Stateless tests cover template rendering, missing variables, recipient normalization, message creation, due checks, success, retry, dead-letter, suppressed records, and backoff.
- Stateful tests cover enqueue, duplicate rejection, due ordering, provider success, retry scheduling, dead-letter after max attempts, non-due rejection, and clone-safe records.
- Provider adapter tests should run against local fakes or sandbox APIs.
- SQL/queue adapters should verify worker claim and idempotent retry behavior.

## Source References

- Transactional email outbox patterns.
- SendGrid, SES, Resend, Mailgun, and SMTP provider adapter boundaries.
- Exponential backoff and dead-letter delivery queues.
- Email template rendering and preview workflows.
`;

export const EMAIL_DELIVERY_ADAPTER_MODULE: MwhModule = {
  id: "email-delivery-adapter",
  title: "Email Delivery Adapter",
  summary:
    "Reusable notification reference for email template rendering, recipient normalization, provider response classification, retry scheduling, and stateful outbox tests.",
  version: "0.1.0",
  tags: ["notification", "email", "delivery", "outbox", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
