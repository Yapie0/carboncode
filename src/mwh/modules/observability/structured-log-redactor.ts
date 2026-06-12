import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Structured Log Redactor Middleware

## Purpose

Use this module as a reusable reference when implementing structured application logging with consistent redaction before logs reach stdout, files, OpenTelemetry logs, SIEM pipelines, or audit archives.

The module focuses on log safety: create structured log events, redact sensitive keys and paths, redact string patterns, cap nested depth, serialize stable JSON, store redacted logs in a clone-safe sink, and expose level/redaction snapshots.

## When To Use

- Services log request context, headers, user metadata, or third-party payloads.
- Authorization headers, tokens, passwords, cookies, API keys, or secrets must never leave process memory unredacted.
- Multiple logging adapters need the same redaction policy.
- Tests need deterministic log entries without writing to stdout or external log systems.

## When Not To Use

- Do not rely on log redaction as the only secret-handling control.
- Do not store raw payloads before redaction.
- Do not use regex patterns that accidentally remove required diagnostic IDs.
- Do not log full request bodies unless retention and privacy policy allow it.

## Implementation Variants

- memory-sink: deterministic in-process sink for unit tests and adapter contracts.
- stdout adapter: writes stable JSON lines after redaction.
- OpenTelemetry adapter: maps redacted events to OTel log records.
- SIEM adapter: batches redacted JSON to external log ingestion.

## Recommended Architecture

- core.ts: pure event creation, recursive redaction, pattern redaction, depth truncation, snapshots, and stable JSON.
- memory-sink.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/pino.ts: redacts before passing records to pino.
- adapters/winston.ts: redacts before format/transport execution.
- adapters/otel.ts: maps redacted context to attributes.

## Public API Sketch

\`\`\`ts
const sink = new MemoryStructuredLogSink({
  policy: {
    redactedKeys: ["password", "authorization", "token"],
    redactedPaths: ["request.headers.cookie"],
    redactedPatterns: [/sk_live_[a-z0-9]+/gi],
  },
});

sink.append({
  id: "log-1",
  level: "info",
  message: "request completed",
  context: { request: { headers: { authorization: "Bearer secret" } } },
});
\`\`\`

## Integration Steps

1. Define a shared redaction policy at process startup.
2. Redact before logs reach stdout, files, transports, or telemetry exporters.
3. Preserve trace ids, route names, status codes, and non-sensitive diagnostics.
4. Use stable JSON for deterministic tests and hashable log records.
5. Monitor redacted count as a signal that sensitive data is reaching log boundaries.

## Failure Modes

- Nested secrets are missed because only top-level keys are redacted.
- Authorization headers leak through alternate casing.
- Regex patterns with global flags behave inconsistently across calls.
- Test assertions inspect mutable log objects and mask adapter bugs.
- Redaction removes too much diagnostic context and makes incidents harder to debug.

## Security Notes

- Redaction should happen before any transport boundary.
- Prefer allowlisted diagnostic context for high-risk payloads.
- Treat logs as production data with retention and access controls.
- Review regex patterns for catastrophic backtracking.

## Verification Checklist

- Stateless tests cover key redaction, path redaction, pattern redaction, arrays, nested objects, max-depth truncation, stable JSON, and snapshots.
- Stateful tests cover duplicate id rejection, append/list by level, clone-safe reads, redacted count, and deterministic timestamps.
- Adapter tests should verify stdout/Pino/Winston/OTel integrations never receive unredacted records.

## Source References

- Structured logging redaction patterns from Pino/Winston middleware.
- OpenTelemetry log attribute safety practices.
- Security logging guidance for secret and token handling.
`;

export const STRUCTURED_LOG_REDACTOR_MODULE: MwhModule = {
  id: "structured-log-redactor",
  title: "Structured Log Redactor Middleware",
  summary:
    "Reusable observability reference for structured log redaction, sensitive field/path/pattern filtering, stable JSON, and clone-safe log sinks.",
  version: "0.1.0",
  tags: ["observability", "logging", "redaction", "structured-logs", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
