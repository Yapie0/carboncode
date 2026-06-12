import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: CSRF Token Guard

## Purpose

Use this module as a reusable reference for CSRF protection in cookie/session-backed APIs: issue HMAC-signed tokens, bind them to sessions, validate request tokens, support one-time consume flows, revoke compromised tokens, and prune expired records.

This module complements CORS. CORS controls browser cross-origin reads and preflights; CSRF tokens protect state-changing requests that include ambient credentials such as cookies.

## When To Use

- Need CSRF protection for cookie-backed forms or JSON APIs.
- Need deterministic tests for token signing, validation, mismatch, expiry, consume, and revoke behavior.
- Need a simple in-memory store before adding Redis, SQL, or session-backed persistence.
- Need one-time token support for high-risk actions.

## When Not To Use

- Do not use CSRF tokens as authentication.
- Do not rely on CORS alone for cookie-backed write endpoints.
- Do not store raw tokens in durable stores.
- Do not reuse one-time tokens after successful consumption.

## Implementation Variants

- Memory store for tests and local prototypes.
- Session-backed token store for server-rendered apps.
- Redis store with TTL and consume/delete semantics.
- SQL token table with status transitions and audit fields.
- Framework adapters for Express, Fastify, Hono, Next.js, or Remix actions.

## Recommended Architecture

- core.ts: pure nonce generation, HMAC token signing, token hashing, record creation, validation, consume, revoke, and clone helpers.
- memory-store.ts: stateful issue, validate, consume, revoke, pruneExpired, get, and list behavior.
- adapters/redis.ts: TTL records and atomic consume.
- adapters/session.ts: session-bound reusable token pattern.
- middleware/http.ts: reads token from header/body and maps validation failures to HTTP responses.

## Public API Sketch

\`\`\`ts
const store = new MemoryCsrfTokenStore({ secret: process.env.CSRF_SECRET! });
const issued = store.issue({
  id: "csrf-1",
  sessionId: "session-1",
  ttlMs: 900_000,
});

const result = store.consume("csrf-1", {
  sessionId: "session-1",
  token: issued.token,
});
if (!result.valid) throw new Error("invalid CSRF token");
\`\`\`

## Integration Rules

1. Bind tokens to a session or user-specific context.
2. Store hashes or signed token metadata, not raw token values.
3. Validate CSRF tokens on state-changing requests.
4. Use one-time consume for high-risk actions.
5. Keep token TTL short enough for the interaction.
6. Rotate secrets through secret IDs when needed.

## Failure Modes

- Token is not bound to a session and can be replayed across users.
- Raw token storage leaks active write authorization.
- Expired or consumed tokens remain accepted.
- CSRF protection is skipped for JSON APIs with cookie credentials.
- Secret rotation invalidates all active forms without a compatibility plan.

## Security Notes

- Use HTTPS and SameSite cookies alongside CSRF tokens.
- Treat token mismatch as a security signal.
- Never put CSRF tokens in URLs that can leak through logs or referrers.
- Keep authentication and authorization checks independent from CSRF validation.

## Verification Checklist

- Stateless tests cover nonce generation, signing, hashing, record creation, valid validation, missing token, missing record, session mismatch, token mismatch, expiry, consume, revoke, and clone safety.
- Stateful tests cover issue, duplicate rejection, validate, consume once, expired persistence, revoke, pruneExpired, session filtering, and clone-safe records.
- Redis/SQL adapters should test atomic consume and TTL cleanup.
- HTTP middleware tests should verify header/body token extraction and failure responses.

## Source References

- CSRF synchronizer-token and double-submit-token patterns.
- HMAC-signed anti-CSRF token patterns.
- SameSite cookie and session-backed CSRF guidance.
- Redis/SQL TTL token storage patterns.
`;

export const CSRF_TOKEN_GUARD_MODULE: MwhModule = {
  id: "csrf-token-guard",
  title: "CSRF Token Guard",
  summary:
    "Reusable api-traffic reference for session-bound HMAC CSRF tokens, validation, one-time consume, revoke, TTL expiry, and stateful store tests.",
  version: "0.1.0",
  tags: ["api-traffic", "csrf", "security", "token", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
