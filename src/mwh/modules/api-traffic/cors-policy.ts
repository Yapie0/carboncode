import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: CORS Policy

## Purpose

Use this module as a reusable reference for API CORS handling: normalize route policies, validate origins, methods, and request headers, produce preflight responses, and keep credential rules explicit.

The module stays provider-neutral. It can be adapted to Express, Fastify, Hono, API gateways, serverless handlers, or edge middleware.

## When To Use

- Need route-scoped CORS policy instead of a single global wildcard.
- Need deterministic tests for preflight and actual request behavior.
- Need to prevent wildcard origins from being combined with credentials.
- Need a registry that maps route IDs to CORS policies.

## When Not To Use

- Do not use wildcard origins with cookies or credentials.
- Do not reflect arbitrary origins without an allowlist.
- Do not treat CORS as authentication or authorization.
- Do not allow all headers unless the API contract truly needs it.

## Implementation Variants

- Memory registry for tests and local prototypes.
- Express/Fastify/Hono middleware adapters.
- API gateway policy generator.
- Tenant-scoped SQL/config registry.
- Edge middleware adapter for Cloudflare Workers or Vercel Edge.

## Recommended Architecture

- core.ts: pure policy normalization, preflight/actual request evaluation, request-header parsing, and response header construction.
- memory-registry.ts: stateful route-policy registration, lookup, evaluate, remove, get, and list behavior.
- adapters/express.ts: maps HTTP request fields into CorsRequest and writes response headers.
- adapters/gateway.ts: emits provider-specific route policy config.
- integrations/config.ts: loads policies from remote config or tenant settings.

## Public API Sketch

\`\`\`ts
const registry = new MemoryCorsPolicyRegistry();
registry.register({
  routeId: "api.users",
  allowedOrigins: ["https://app.example.com"],
  allowedMethods: ["GET", "POST"],
  allowedHeaders: ["authorization", "content-type"],
  allowCredentials: true,
  maxAgeSeconds: 600,
});

const decision = registry.evaluate({
  routeId: "api.users",
  origin: "https://app.example.com",
  method: "POST",
  requestHeaders: ["authorization"],
  preflight: true,
});
\`\`\`

## Integration Rules

1. Keep CORS policy route-scoped where possible.
2. Use exact origin allowlists for credentialed requests.
3. Normalize method and header case before comparison.
4. Return preflight responses without invoking business handlers.
5. Add Vary: Origin whenever origin-specific headers are produced.
6. Test both preflight and actual requests.

## Failure Modes

- Wildcard plus credentials creates invalid and unsafe behavior.
- Reflecting arbitrary origins leaks APIs to untrusted sites.
- Missing Vary: Origin causes cache confusion.
- Preflight rejects valid headers because header casing differs.
- CORS is mistaken for authorization.

## Security Notes

- CORS controls browser access, not API identity.
- Keep auth checks independent from CORS allow decisions.
- Use narrow origins for cookie-backed APIs.
- Avoid broad allowedHeaders for sensitive endpoints.

## Verification Checklist

- Stateless tests cover policy normalization, wildcard credential rejection, preflight allow headers, actual exposed headers, origin/method/header rejection, no-origin server requests, and request-header parsing.
- Stateful tests cover register, evaluate, remove, get/list, unknown route rejection, and clone-safe policies.
- HTTP adapter tests should verify headers and handler short-circuiting.
- Gateway adapter tests should verify generated provider config.

## Source References

- Browser CORS preflight semantics.
- Express/Fastify/Hono CORS middleware patterns.
- API gateway CORS route policy patterns.
- Credentialed CORS allowlist guidance.
`;

export const CORS_POLICY_MODULE: MwhModule = {
  id: "cors-policy",
  title: "CORS Policy",
  summary:
    "Reusable api-traffic reference for route-scoped CORS policies, preflight decisions, credential-safe origin allowlists, and stateful registry tests.",
  version: "0.1.0",
  tags: ["api-traffic", "cors", "preflight", "origin", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
