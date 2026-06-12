import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: OpenTelemetry Express Node Middleware

## Purpose

Use this module as a reusable reference when adding OpenTelemetry-style tracing to Express or Node HTTP APIs. It models request span creation, traceparent propagation, semantic HTTP attributes, error status mapping, sampling decisions, and an in-memory exporter for tests.

This module complements request-trace-context and http-metrics-recorder. request-trace-context owns W3C trace header primitives; http-metrics-recorder owns aggregate metrics; this module owns request middleware lifecycle and span export behavior.

## When To Use

- Express routes need request spans with route, method, status, and error attributes.
- APIs must propagate W3C traceparent response/request headers.
- Tests need deterministic spans without running an OTLP collector.
- A project wants a clean adapter contract before wiring OpenTelemetry SDK packages.

## When Not To Use

- Do not use the memory exporter as production telemetry storage.
- Do not record sensitive headers, cookies, tokens, or full request bodies as span attributes.
- Do not rely on tracing as a security audit log.
- Do not sample critical error traces out unless a separate error pipeline exists.

## Implementation Variants

1. Memory exporter
   - Deterministic unit tests and local demos.
2. OpenTelemetry SDK adapter
   - Wraps @opentelemetry/sdk-node and HTTP/Express instrumentation.
3. Manual Express middleware
   - Starts a span on request, finishes on response close/finish, records errors.
4. Edge/runtime adapter
   - Same span contract, different transport/runtime hooks.

## Recommended Architecture

- core.ts: pure request span start, finish, sampling, route normalization, and traceparent response headers.
- memory-exporter.ts: stateful pending/finished span lifecycle for tests.
- adapters/express.ts: middleware that begins a span, attaches context, and finishes on response events.
- adapters/otel-sdk.ts: OpenTelemetry SDK bootstrap and OTLP exporter configuration.
- policy.ts: attribute allow-list and sampling rules.

## Public API Sketch

\`\`\`ts
const exporter = new MemoryOtelExpressExporter({ now: () => Date.now() });
const started = exporter.beginRequest("req_1", {
  method: "GET",
  route: "/api/users/:id",
  traceparent: req.headers.traceparent,
});
res.setHeader("traceparent", started.responseHeaders.traceparent);
// later, on finish:
exporter.finishRequest({ requestId: "req_1", statusCode: res.statusCode });
\`\`\`

## Integration Rules

1. Prefer framework route templates such as /users/:id instead of raw URLs.
2. Start spans before route handler execution and finish on response finish/close.
3. Record 5xx and thrown errors as error spans.
4. Propagate traceparent for downstream calls and response debugging.
5. Keep attribute names compatible with OpenTelemetry HTTP semantic conventions.
6. Bound memory exporters in tests; use OTLP/collector exporters in production.

## Failure Modes

- Raw URL attributes can leak IDs or high-cardinality paths.
- Missing finish handlers leave spans pending forever.
- Recording request bodies can leak secrets.
- Clock issues can create negative durations.
- Incorrect parent propagation breaks distributed traces.

## Security Notes

- Apply an allow-list to span attributes.
- Never record authorization headers, cookies, API keys, or secrets.
- Treat trace IDs as correlation metadata, not access control.
- Sanitize error messages before exposing traces to end users.

## Verification Checklist

- Stateless tests cover route normalization, span creation, traceparent propagation, status/error finish behavior, invalid status rejection, and deterministic sampling.
- Stateful tests cover begin, duplicate pending rejection, finish, pending cleanup, flush, and clone-safe exports.
- Express adapter tests should simulate success, thrown errors, aborted responses, and route template extraction.
- SDK adapter tests should verify resource attributes, exporter configuration, and disabled telemetry mode.

## Source References

- OpenTelemetry HTTP semantic conventions.
- OpenTelemetry JS SDK Node setup patterns.
- Express middleware lifecycle: request handler, response finish, close, and error paths.
`;

export const OTEL_EXPRESS_NODE_MODULE: MwhModule = {
  id: "otel-express-node",
  title: "OpenTelemetry Express Node Middleware",
  summary:
    "Reusable observability reference for Express request spans, traceparent propagation, HTTP attributes, sampling, and test exporter lifecycle.",
  version: "0.1.0",
  tags: ["observability", "opentelemetry", "express", "tracing", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
