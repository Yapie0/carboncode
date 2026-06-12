import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: HTTP Metrics Recorder Middleware

## Purpose

Use this module as a reusable reference for HTTP request metrics, route-level latency aggregation, status-class counters, error counts, and dashboard/API health snapshots.

The module contains stateless metric normalization and aggregation logic plus a stateful in-memory recorder for tests. Production adapters can export the same samples to Prometheus, OpenTelemetry Metrics, StatsD, ClickHouse, Postgres, or a Carbon Code dashboard.

## When To Use

- Add route-level latency and error-rate visibility to an HTTP service.
- Need deterministic unit tests for metrics before wiring Prometheus or OpenTelemetry.
- Need a small in-process snapshot for local dashboards or CLI health checks.
- Want framework-neutral request metric contracts for Express, Fastify, Hono, Next.js, or serverless handlers.

## When Not To Use

- Do not use in-memory samples as long-term production telemetry storage.
- Do not record raw URLs with user ids, tokens, or unbounded query strings as route labels.
- Do not use metrics as the only source for security audit trails.
- Do not mix trace spans and metric counters into one state model.

## Implementation Variants

- Memory recorder for local tests and single-process dashboards.
- Prometheus adapter using counters and histograms.
- OpenTelemetry Metrics adapter using MeterProvider instruments.
- StatsD adapter for simple counter/timing export.
- SQL/ClickHouse adapter for retained analytics snapshots.

## Recommended Architecture

- core.ts: pure sample creation, route/method/status normalization, percentile calculation, and bucket aggregation.
- memory-recorder.ts: stateful record, snapshot, bounded sample retention, and time pruning.
- adapters/prometheus.ts: export request_total, request_errors_total, and duration histograms.
- middleware/http.ts: wrap request lifecycle and record route templates instead of raw URLs.
- dashboard.ts: read snapshots and render local health panels.

## Public API Sketch

\`\`\`ts
const recorder = new MemoryHttpMetricsRecorder({ maxSamples: 10_000 });
recorder.record({
  method: "GET",
  route: "/api/users/:id",
  statusCode: 200,
  durationMs: 42,
});

const snapshot = recorder.snapshot();
for (const bucket of snapshot.buckets) {
  console.log(bucket.key.method, bucket.key.route, bucket.count, bucket.p95DurationMs);
}
\`\`\`

## Integration Rules

1. Record normalized route templates, not raw request URLs.
2. Use method, route, and status class as low-cardinality dimensions.
3. Treat 5xx as errors by default, but allow explicit error overrides.
4. Bound in-memory retention so metrics do not leak memory.
5. Export histograms/counters to production telemetry backends.
6. Keep trace ids in logs/spans; keep metrics aggregated and low cardinality.

## Failure Modes

- Raw URLs create high-cardinality metric labels.
- In-memory samples disappear on restart and diverge across instances.
- Unbounded sample arrays leak memory.
- Percentiles from tiny in-memory windows can mislead production decisions.
- Missing route templates make metrics hard to compare across releases.

## Security Notes

- Never put secrets, tokens, emails, or raw query strings in metric labels.
- Treat route labels as public operational metadata.
- Use separate audit logging for sensitive user actions.

## Verification Checklist

- Stateless tests cover sample normalization, status class mapping, percentile calculation, bucket aggregation, and invalid input rejection.
- Stateful tests cover record, snapshot, bounded retention, explicit error overrides, and time pruning.
- Prometheus adapter tests should verify metric names, labels, and histogram buckets.
- HTTP middleware tests should verify route templates are captured instead of raw URLs.

## Source References

- Prometheus HTTP request counter and histogram conventions.
- OpenTelemetry Metrics semantic conventions for HTTP server duration.
- RED metrics: rate, errors, duration.
- Low-cardinality label design for production telemetry.
`;

export const HTTP_METRICS_RECORDER_MODULE: MwhModule = {
  id: "http-metrics-recorder",
  title: "HTTP Metrics Recorder Middleware",
  summary:
    "Reusable HTTP metrics reference with route/status aggregation, duration percentiles, bounded memory snapshots, and stateful tests.",
  version: "0.1.0",
  tags: ["observability", "metrics", "http", "prometheus", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
