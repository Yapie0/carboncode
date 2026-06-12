import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Idempotency Key Middleware

## Purpose

Use this module as a reusable reference when building idempotent HTTP mutation endpoints such as payment creation, order submission, invite sending, webhook delivery, upload finalization, or AI task creation.

The module contains verified stateless request fingerprint and state-transition logic plus a stateful in-memory store used by tests. Production adapters should persist records in Redis, Postgres, DynamoDB, or another store with atomic create-if-absent semantics.

## When To Use

- Clients may retry POST/PATCH requests after network failures.
- Duplicate side effects are expensive or unsafe.
- The endpoint can return the same response for the same idempotency key and request fingerprint.

## When Not To Use

- Do not use idempotency keys to hide non-deterministic business operations.
- Do not replay a response when the same key is reused with a different body, route, actor, or method.
- Do not use the memory store across server replicas.

## Implementation Variants

1. Redis SET NX + hash payload
   - Good for API servers with short TTLs.
   - Use Lua or transactions for complete/update transitions.
2. Postgres unique key table
   - Good when business data and idempotency records need transactional consistency.
3. DynamoDB conditional put
   - Good for serverless mutation APIs.

## Recommended Architecture

- core.ts: pure request fingerprinting and idempotency state machine.
- memory-store.ts: deterministic local adapter for tests and demos.
- adapters/redis.ts: atomic reserve/complete/replay implementation.
- adapters/sql.ts: transaction-friendly implementation.
- middleware/express.ts: extracts Idempotency-Key, actor, route scope, and response snapshot.

## Public API Sketch

\`\`\`ts
const decision = store.evaluate(idempotencyKey, {
  method: "POST",
  route: "/orders",
  actor: user.id,
  body: req.body,
});

if (decision.kind === "replay") return send(decision.response);
if (decision.kind === "conflict") return send409(decision.reason);
if (decision.kind === "in-flight") return send409("request already processing");

const response = await createOrder();
store.complete(idempotencyKey, response);
\`\`\`

## Integration Rules

1. Require an idempotency key only on mutation routes where duplicate side effects matter.
2. Fingerprint method, route scope, authenticated actor, and canonical request body.
3. Return cached response only when the fingerprint matches.
4. Return conflict when the same key is reused for a different request.
5. Use TTLs to bound storage, but make them longer than normal client retry windows.
6. Persist the idempotency record before executing the side effect.

## Failure Modes

- Completing the business side effect before reserving the key can still duplicate work.
- Storing only the key without a fingerprint allows accidental cross-request replay.
- Storing only success responses can cause retry storms after ambiguous failures.
- Memory stores diverge across processes and lose state on restart.
- TTLs that are too short allow late retries to create duplicate side effects.

## Security Notes

- Include authenticated actor or tenant in the fingerprint.
- Do not store raw authorization headers in the fingerprint source.
- Bound key length and response body size before persisting.

## Verification Checklist

- Stateless tests cover stable fingerprints independent of JSON key order.
- Stateless tests cover start, replay, conflict, in-flight, and expired decisions.
- Stateful store tests cover reserve -> complete -> replay.
- Stateful store tests cover same key with different body producing conflict.
- Stateful store tests cover TTL expiry and pruning.

## Source References

- mahendraHegde/node-idempotency: framework-neutral Node idempotency API.
- stacks0x/idempotix: TypeScript idempotency middleware patterns.
- ibrahimcesar/middy-idempotent: serverless idempotency reference.
- Stripe API idempotency semantics: replay only for matching keys and requests.
`;

export const IDEMPOTENCY_KEY_MODULE: MwhModule = {
  id: "idempotency-key",
  title: "Idempotency Key Middleware",
  summary:
    "Reusable idempotency reference with request fingerprinting, replay/conflict decisions, TTL, and stateful tests.",
  version: "0.1.0",
  tags: ["idempotency", "http", "api-traffic", "redis", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
