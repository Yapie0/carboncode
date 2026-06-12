import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: API Key Auth Middleware

## Purpose

Use this module as a reusable reference for API key authentication in internal APIs, developer platforms, MCP servers, webhooks, admin tools, and service-to-service integrations.

The module contains pure API key hashing, verification, scope checks, expiry/revocation decisions, and key rotation logic plus a deterministic in-memory key store for tests. Production adapters can use SQL, Redis, KMS-backed secrets, or provider-specific credential stores.

## When To Use

- Need simple service-to-service or developer API authentication.
- Need scoped API keys with wildcard permissions.
- Need key disable, revoke, rotate, expiry, and last-used tracking.
- Need deterministic tests before integrating SQL, Redis, or a secrets manager.

## When Not To Use

- Do not store raw API keys after creation.
- Do not use API keys as user session tokens for browser users.
- Do not rely on process-local memory for production credential storage.
- Do not skip rate limiting, audit logging, or key rotation for public APIs.

## Implementation Variants

- Memory store for local tests and single-process prototypes.
- SQL credential table with hashed keys, prefix index, scopes, status, and audit columns.
- Redis-backed key lookup for high-throughput internal APIs.
- KMS/secrets-manager backed adapter for centrally managed credentials.
- Framework middleware adapters for Express, Fastify, Hono, Next.js, or MCP servers.

## Recommended Architecture

- core.ts: pure key hashing, timing-safe verification, prefix extraction, status classification, scope matching, revoke, disable, rotate, and authentication decisions.
- memory-store.ts: stateful create, authenticate, mark last-used, enable/disable, revoke, rotate, get, and list behavior.
- adapters/sql.ts: durable hashed key storage and prefix lookup.
- adapters/redis.ts: cached prefix lookup with invalidation.
- middleware/http.ts: extracts Authorization or x-api-key headers and maps decisions to HTTP responses.

## Public API Sketch

\`\`\`ts
const store = new MemoryApiKeyStore();
store.create({
  id: "key_1",
  ownerId: "svc-billing",
  rawKey: "cc_live_secret_123",
  scopes: ["invoice:*", "customer:read"],
});

const decision = store.authenticate("cc_live_secret_123", "invoice:write");
if (!decision.allowed) throw new Error(decision.reason);
\`\`\`

## Integration Rules

1. Show the raw API key only once at creation time.
2. Store only a hash plus a short prefix for lookup.
3. Use timing-safe comparison for secret verification.
4. Require scopes for sensitive operations.
5. Track last-used timestamps for audit and cleanup.
6. Support disable/revoke/rotate without changing callers of the auth middleware.

## Failure Modes

- Raw key leakage if credentials are logged or stored in plaintext.
- Prefix-only lookup can return multiple candidates; verify the hash before accepting.
- Missing scope checks turn API keys into full-access credentials.
- Process-local stores lose revocation and rotation state on restart.
- Long-lived keys accumulate without expiry or last-used cleanup.

## Security Notes

- Treat API keys as bearer secrets.
- Hash keys with a strong one-way hash or KMS-backed HMAC in production.
- Keep audit logs for create, use, disable, revoke, and rotate events.
- Pair API key auth with rate limiting and request logging.

## Verification Checklist

- Stateless tests cover prefix/hash/verify, wildcard scopes, active/disabled/revoked/expired decisions, scope denied, revoke, disable, and rotate.
- Stateful tests cover create, authenticate, last-used update, owner listing, disable, revoke, rotation invalidating the old key, and expiry rejection.
- SQL/Redis adapter tests should verify prefix lookup, multiple prefix candidates, and revocation propagation.
- HTTP middleware tests should verify missing key, invalid key, scope denied, and accepted requests.

## Source References

- API key bearer credential patterns.
- Prefix + hashed secret lookup design.
- Timing-safe secret comparison.
- Scoped token and credential rotation practices.
`;

export const API_KEY_AUTH_MODULE: MwhModule = {
  id: "api-key-auth",
  title: "API Key Auth Middleware",
  summary:
    "Reusable API key authentication reference with hashed secrets, prefixes, scopes, expiry, revocation, rotation, and stateful tests.",
  version: "0.1.0",
  tags: ["auth-security", "api-key", "scopes", "credentials", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
