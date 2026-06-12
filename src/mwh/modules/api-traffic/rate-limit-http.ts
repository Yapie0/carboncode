import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: HTTP Rate Limit Middleware

## Purpose

Use this module as a reusable reference when building HTTP request rate limiting for API servers, gateways, login endpoints, webhook endpoints, or expensive AI/tool-call routes.

The module contains verified stateless algorithms plus a stateful in-memory store used by tests. Production adapters should replace the in-memory store with Redis, Upstash, Cloudflare KV/Durable Objects, or a gateway-native limiter.

## When To Use

- Protect public APIs from abusive clients.
- Put stricter limits on auth, password reset, invite, upload, webhook, and AI inference routes.
- Add local/dev protection before adopting Kong, APISIX, Nginx, Envoy, or cloud gateway limits.

## When Not To Use

- Do not use the in-memory store across multiple server replicas.
- Do not rely on IP-only keys behind proxies unless trusted proxy headers are configured.
- Do not hide business quota decisions inside a generic transport limiter.

## Implementation Variants

1. Fixed window
   - Simple and deterministic.
   - Good for low-risk endpoints and local tests.
   - Boundary bursts are possible at the window edge.
2. Token bucket
   - Allows short bursts while enforcing a long-term average.
   - Good for user/API-key quotas.
3. Sliding window log
   - More accurate than fixed window.
   - Needs pruning and external storage for production.

## Recommended Architecture

- core.ts: pure limit algorithms with no timers, IO, or global state.
- memory-store.ts: deterministic stateful adapter for local use and tests.
- adapters/redis.ts: production adapter using atomic Lua or single-key transactions.
- middleware/express.ts: reads identity, evaluates limiter, writes standard headers.
- middleware/hono.ts: optional framework adapter with the same contract.

## Public API Sketch

\`\`\`ts
const store = new MemoryRateLimitStore();
const result = store.checkTokenBucket(userId, {
  capacity: 60,
  refillPerMs: 1 / 1000,
});
if (result.decision === "deny") {
  response.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
  response.statusCode = 429;
}
\`\`\`

## Integration Rules

1. Build the rate-limit key from stable identity: route scope + user id/API key/IP.
2. Emit \`RateLimit-Limit\`, \`RateLimit-Remaining\`, \`RateLimit-Reset\`, and \`Retry-After\` where possible.
3. Use stricter limits for unauthenticated routes.
4. Put authentication before per-user limits when the user id is required.
5. Use Redis atomic operations for multi-process deployments.
6. Add bypasses only for explicit internal service identities.

## Failure Modes

- In-memory counters reset on process restart and diverge across replicas.
- IP-based keys can over-limit NAT users and under-limit spoofed proxy headers.
- Fixed-window limiters allow double bursts at boundaries.
- Redis outages need an intentional fail-open/fail-closed policy.
- Missing test clocks create flaky retry/reset assertions.

## Security Notes

- Treat client-controlled headers as untrusted unless the reverse proxy chain is configured.
- Do not include raw tokens in rate-limit keys; hash them.
- Log limiter decisions with route scope and actor class, not secrets.

## Verification Checklist

- Stateless fixed-window tests cover allow, deny, retryAfter, and reset.
- Stateless token-bucket tests cover burst, refill, and insufficient token retry.
- Stateless sliding-window tests cover pruning and denial until oldest event expires.
- Stateful store tests cover independent keys and reset behavior.
- Framework adapter tests should assert 429 response and standard headers.

## Source References

- express-rate-limit/express-rate-limit: common Express middleware API shape.
- animir/node-rate-limiter-flexible: Redis-backed production patterns.
- spinlud/redis-sliding-rate-limiter: sliding-window Redis implementation reference.
- stacksjs/ts-rate-limiter: TypeScript limiter API reference.
`;

export const RATE_LIMIT_HTTP_MODULE: MwhModule = {
  id: "rate-limit-http",
  title: "HTTP Rate Limit Middleware",
  summary:
    "Reusable rate limiting reference with fixed-window, token-bucket, sliding-window, and stateful store tests.",
  version: "0.1.0",
  tags: ["rate-limit", "http", "api-traffic", "redis", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
