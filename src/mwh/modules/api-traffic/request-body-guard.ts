import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Request Body Guard Middleware

## Purpose

Use this module as a reusable reference when implementing request body limits and payload validation at API gateway or route middleware boundaries.

The module defines provider-neutral body guard logic: content-type allowlists, max byte limits, JSON parse validation, JSON depth limits, JSON field-count limits, route policies, and audit records. Framework adapters can map decisions to 413, 415, or 400 responses.

## When To Use

- Public HTTP endpoints accept JSON or form payloads.
- A gateway needs consistent body size and content-type rejection.
- JSON depth or field-count limits should protect services from parser abuse.
- Tests need deterministic request validation without a running HTTP server.

## When Not To Use

- Do not treat body validation as schema validation.
- Do not buffer very large request bodies in production just to check size; enforce streaming limits in the adapter.
- Do not allow arbitrary content types on sensitive endpoints.
- Do not log full request bodies in audit records.

## Implementation Variants

- memory-guard: deterministic in-process route policy registry and audit log for tests.
- Express/Fastify adapter: maps decisions to HTTP responses before route handlers.
- Hono/Fetch adapter: validates Request headers and body text.
- Streaming adapter: rejects oversized payloads while reading chunks.

## Recommended Architecture

- core.ts: pure content-type normalization, byte length, JSON shape analysis, and decision generation.
- memory-guard.ts: stateful route policy registry and clone-safe audit records.
- adapters/express.ts: middleware that enforces max bytes before JSON parsing when possible.
- adapters/fetch.ts: Request wrapper for edge runtimes.

## Public API Sketch

\`\`\`ts
const guard = new MemoryRequestBodyGuard({
  policies: [{
    routeId: "POST /users",
    maxBytes: 32_000,
    allowedContentTypes: ["application/json"],
    maxJsonDepth: 8,
    maxJsonFields: 100,
  }],
});

const decision = guard.evaluate({
  routeId: "POST /users",
  contentType: "application/json",
  body: JSON.stringify({ name: "Ada" }),
});
\`\`\`

## Integration Steps

1. Define route-level body policies.
2. Enforce streaming byte limits in the framework adapter.
3. Use the pure guard decision before invoking route business logic.
4. Record only metadata in audit logs.
5. Pair with schema validation after the coarse body guard passes.

## Failure Modes

- Oversized body is buffered before rejection.
- Content-Type parameters are not normalized.
- Deep JSON payload causes parser or validation pressure.
- Body guard is mistaken for domain schema validation.
- Route policy is missing and requests bypass validation.

## Security Notes

- Do not store raw body text in guard audit logs.
- Keep limits tighter on unauthenticated endpoints.
- Reject unknown content types by default.
- Apply schema validation after coarse guard checks.

## Verification Checklist

- Stateless tests cover content-type normalization, byte length, allow, body-too-large, content-type rejection, invalid JSON, JSON depth limit, and field-count limit.
- Stateful tests cover policy lookup, policy update, audit records, and clone-safe reads.
- Adapter tests should verify streaming max-body behavior and correct HTTP status mapping.

## Source References

- API gateway request body size limit patterns.
- Express/Fastify body parser limit behavior.
- OWASP guidance around input size and parser abuse.
`;

export const REQUEST_BODY_GUARD_MODULE: MwhModule = {
  id: "request-body-guard",
  title: "Request Body Guard Middleware",
  summary:
    "Reusable API traffic reference for body size limits, content-type allowlists, JSON shape guards, route policies, and adapter tests.",
  version: "0.1.0",
  tags: ["api-traffic", "request-body", "content-type", "json", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
