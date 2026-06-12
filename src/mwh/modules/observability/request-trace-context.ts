import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Request Trace Context Middleware

## Purpose

Use this module as a reusable reference when adding request tracing, log correlation, W3C trace context propagation, span timing, and lightweight in-process trace recording.

The module contains pure trace-context parsing/injection and span lifecycle helpers plus a deterministic memory recorder for tests. Production adapters can forward spans to OpenTelemetry, Jaeger, Zipkin, Datadog, Honeycomb, or provider-native observability pipelines.

## When To Use

- Propagate trace ids across HTTP calls and background jobs.
- Correlate logs, metrics, and errors by trace id and span id.
- Time request handlers, database calls, queue consumers, and tool executions.
- Add deterministic tracing behavior before wiring a full OpenTelemetry SDK.

## When Not To Use

- Do not treat the memory recorder as production telemetry storage.
- Do not accept arbitrary client trace ids for privileged internal trust decisions.
- Do not put secrets or full payloads into span attributes.

## Recommended Architecture

- core.ts: W3C traceparent parse/format, root/child context creation, header injection, span start/end.
- memory-recorder.ts: deterministic stateful span recorder for tests.
- adapters/opentelemetry.ts: bridge pure span records into OpenTelemetry spans.
- middleware/http.ts: extract incoming traceparent, create request span, inject outbound headers.
- logger.ts: bind traceId/spanId fields into structured logs.

## Public API Sketch

\`\`\`ts
const incoming = parseTraceparent(request.headers.traceparent);
const requestContext = createChildTraceContext({ parent: incoming });
const span = recorder.start(requestContext, "GET /api/users", {
  route: "/api/users",
});

const outboundHeaders = injectTraceHeaders(createChildTraceContext({ parent: requestContext }));
await fetch("https://service.local/users", { headers: outboundHeaders });
recorder.end(span.spanId, { status: "ok" });
\`\`\`

## Integration Rules

1. Parse W3C \`traceparent\` on inbound requests.
2. Create child spans for service work and outbound calls.
3. Inject \`traceparent\` into outbound HTTP, queue, and job payloads.
4. Add traceId/spanId to structured logs.
5. Record duration, status, route, peer service, and error class as attributes.
6. Keep high-cardinality payloads and secrets out of span attributes.

## Failure Modes

- Broken trace trees when outgoing calls do not receive the active span context.
- Excessive cardinality from raw URLs, user input, or payload fields in attributes.
- Missing spans when async work loses the active context.
- Incorrect duration when tests use wall-clock time instead of deterministic clocks.

## Security Notes

- Treat incoming trace ids as correlation hints, not authorization data.
- Redact sensitive attributes before exporting telemetry.
- Consider regenerating trace context at trust boundaries.

## Verification Checklist

- Stateless tests cover valid/invalid traceparent parsing, header formatting, child context creation, and span duration/status.
- Stateful tests cover root span, child span, end span, trace listing, and deterministic clocks.
- Adapter tests should verify exported spans preserve trace id, parent id, status, and attributes.
- HTTP integration tests should assert inbound extraction and outbound header injection.

## Source References

- W3C Trace Context: traceparent header format and sampled flag.
- OpenTelemetry trace semantic model: spans, context propagation, attributes, and exporters.
- Zipkin/Jaeger lineage: trace id/span id/parent id correlation model.
`;

export const REQUEST_TRACE_CONTEXT_MODULE: MwhModule = {
  id: "request-trace-context",
  title: "Request Trace Context Middleware",
  summary:
    "Reusable request tracing reference with W3C traceparent parsing, header injection, span lifecycle, and stateful recorder tests.",
  version: "0.1.0",
  tags: ["observability", "trace", "traceparent", "logging", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
