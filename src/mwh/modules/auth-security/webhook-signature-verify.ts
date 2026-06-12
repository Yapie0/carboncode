import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Webhook Signature Verify Middleware

## Purpose

Use this module as a reusable reference for incoming webhook authentication. It verifies timestamped HMAC signatures, rejects stale requests, and prevents nonce replay.

This module is separate from outbound webhook delivery. Outbound dispatchers sign requests and handle retries; incoming verification protects API endpoints that receive third-party webhooks.

## When To Use

- Accept webhooks from payment, auth, repository, messaging, or automation providers.
- Need deterministic HMAC verification with timestamp tolerance.
- Need replay protection for signed webhook deliveries.
- Need an adapter-ready contract before wiring Express, Hono, Next.js, Fastify, or serverless handlers.

## When Not To Use

- Do not use this module as a substitute for provider-specific event validation.
- Do not parse or mutate the raw body before signature verification.
- Do not store replay nonces only in memory when multiple API instances receive webhooks.
- Do not treat a valid signature as proof that the event should be processed twice.

## Implementation Variants

- Memory replay store for local tests and single-process prototypes.
- Redis nonce store with TTL for horizontally scaled API workers.
- SQL nonce table with unique key for audit-friendly replay protection.
- Framework middleware adapters for Express, Hono, Next.js route handlers, Fastify, or serverless functions.

## Recommended Architecture

- core.ts: pure signing payload, header parsing, HMAC verification, timestamp tolerance, and replay status decisions.
- memory-store.ts: stateful nonce remember/check/prune behavior for tests.
- adapters/express.ts: raw-body capture and response mapping.
- adapters/redis.ts: distributed nonce SET NX EX replay protection.
- adapters/sql.ts: nonce insert with unique constraint.

## Public API Sketch

\`\`\`ts
const store = new MemoryWebhookSignatureReplayStore();
const result = store.verifyAndRemember({
  providerId: "stripe",
  endpointId: "payments",
  secret: process.env.STRIPE_WEBHOOK_SECRET!,
  toleranceMs: 300_000,
  body: rawBody,
  headers: {
    timestamp: req.headers["x-webhook-timestamp"],
    nonce: req.headers["x-webhook-nonce"],
    signature: req.headers["x-webhook-signature"],
  },
});
if (result.status !== "valid") throw new Error(\`webhook rejected: \${result.status}\`);
\`\`\`

## Integration Rules

1. Verify the exact raw request body bytes or string used by the sender.
2. Include timestamp, nonce, and body in the signing payload.
3. Reject timestamps outside a small tolerance window.
4. Remember nonce only after signature verification succeeds.
5. Use providerId and endpointId in the replay key so providers cannot collide.
6. In distributed deployments, use Redis SET NX EX or a SQL unique constraint.

## Failure Modes

- Body parsers can change whitespace or encoding and break signatures.
- Missing nonce storage allows replay attacks within the timestamp window.
- Process-local replay stores diverge across multiple API instances.
- Clock skew rejects legitimate requests when tolerance is too narrow.
- Overly broad tolerance increases replay exposure.

## Security Notes

- Use timing-safe comparison for signatures.
- Keep webhook secrets separate per provider and endpoint when possible.
- Log rejection reason and provider metadata, not raw secrets or full payloads.
- Treat replay records as security state; expire them after the tolerance window.

## Verification Checklist

- Stateless tests cover signing payload, header parsing, valid signature, wrong secret, wrong body, missing headers, invalid format, stale timestamp, and replay status.
- Stateful tests cover remember-on-valid, replay rejection, rejected requests not remembered, provider/endpoint key isolation, and TTL pruning.
- Redis adapter tests should verify SET NX behavior and TTL.
- Framework adapter tests should verify raw body handling before JSON parsing.

## Source References

- Stripe-style signed webhook timestamp tolerance.
- GitHub/Slack-style HMAC webhook verification patterns.
- Redis SET NX EX nonce replay protection.
- SQL unique-key idempotency and replay tracking patterns.
`;

export const WEBHOOK_SIGNATURE_VERIFY_MODULE: MwhModule = {
  id: "webhook-signature-verify",
  title: "Webhook Signature Verify Middleware",
  summary:
    "Reusable incoming webhook verification reference with timestamped HMAC, nonce replay protection, and stateful TTL tests.",
  version: "0.1.0",
  tags: ["auth-security", "webhook", "hmac", "replay-protection", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
