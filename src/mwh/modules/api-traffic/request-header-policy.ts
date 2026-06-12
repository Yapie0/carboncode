import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Request Header Policy Middleware

## Purpose

Use this module as a reusable reference for route-level HTTP request header policy enforcement at API gateway, edge runtime, or framework middleware boundaries.

The module defines provider-neutral header rules: required headers, exact/one-of value checks, allowed header names, blocked sensitive headers, per-header byte limits, total header byte limits, route policies, and audit records.

## When To Use

- Public HTTP endpoints need consistent header validation before route handlers.
- A gateway must block spoofed internal headers such as x-forwarded-user or x-internal-role.
- Requests need required tenant, idempotency, trace, content negotiation, or version headers.
- Tests need deterministic header policy decisions without a running HTTP server.

## When Not To Use

- Do not treat header policy as authentication or authorization.
- Do not trust user-supplied forwarding headers unless they come from a trusted proxy adapter.
- Do not log sensitive header values in production audit sinks.
- Do not use broad allowlists until framework-required headers are included.

## Implementation Variants

- memory-guard: deterministic route policy registry and audit log for tests.
- Express/Fastify adapter: maps decisions to HTTP 400/431 responses before handlers.
- Fetch/Hono adapter: validates Request.headers in edge runtimes.
- Gateway export adapter: renders Nginx, Envoy, APISIX, or Kong policy fragments.

## Recommended Architecture

- core.ts: pure header normalization, byte measurement, required/allowed/blocked decisions, and status mapping.
- memory-guard.ts: stateful route policy registry, update operations, audit records, and clone-safe reads.
- adapters/express.ts: request middleware that validates headers before body parsing.
- adapters/fetch.ts: Request wrapper for edge runtimes.
- adapters/gateway.ts: gateway config rendering.

## Public API Sketch

\`\`\`ts
const guard = new MemoryRequestHeaderPolicy({
  policies: [{
    routeId: "POST /orders",
    requiredHeaders: [{ name: "x-tenant-id" }],
    allowedHeaderNames: ["content-type", "x-tenant-id", "idempotency-key"],
    blockedHeaderNames: ["x-internal-role"],
    maxHeaderBytes: 256,
    maxTotalHeaderBytes: 4096,
  }],
});

const decision = guard.evaluate({
  routeId: "POST /orders",
  headers: { "x-tenant-id": "tenant-1", "content-type": "application/json" },
});
\`\`\`

## Integration Rules

1. Normalize header names to lowercase.
2. Check required headers before invoking route business logic.
3. Block spoofable internal headers at the first trusted boundary.
4. Apply per-header and total header byte limits.
5. Record only metadata or redacted values in audit logs.
6. Pair this module with auth, CORS, body guard, and idempotency middleware.

## Failure Modes

- Header name case is treated as significant.
- Internal identity headers are accepted from the public internet.
- Allowlist omits framework-required headers and breaks legitimate clients.
- Oversized headers are accepted until the app server rejects unpredictably.
- Header policy audit logs leak authorization or cookie values.

## Verification Checklist

- Stateless tests cover normalization, byte measurement, allow, missing required header, value mismatch, blocked header, allowlist rejection, per-header size, and total size rejection.
- Stateful tests cover policy lookup, policy update, audit records, and clone-safe reads.
- Adapter tests should verify correct HTTP status mapping and redacted audit output.

## Source References

- API gateway header validation patterns.
- HTTP 431 Request Header Fields Too Large behavior.
- Reverse proxy spoofed-header hardening guidance.
- OWASP secure header and trusted proxy guidance.
`;

export const REQUEST_HEADER_POLICY_MODULE: MwhModule = {
  id: "request-header-policy",
  title: "Request Header Policy Middleware",
  summary:
    "Reusable API traffic reference for required headers, allowed/blocked names, spoofed internal header protection, byte limits, route policies, and adapter tests.",
  version: "0.1.0",
  tags: ["api-traffic", "request-header", "headers", "gateway", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
