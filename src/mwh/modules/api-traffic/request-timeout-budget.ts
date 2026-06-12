import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Request Timeout Budget Middleware

## Purpose

Use this module as a reusable reference when implementing request deadline propagation, timeout budgeting, and child-call budget derivation in API gateways, service clients, or route middleware.

The module defines provider-neutral timeout budget logic: inbound header parsing, deadline capping, remaining budget calculation, outbound header propagation, child budget derivation, expiry, cancellation, completion, and state snapshots.

## When To Use

- API routes need strict request deadlines instead of unbounded awaits.
- Downstream calls should inherit the caller deadline.
- Circuit breakers and retry middleware need timeout results before recording outcomes.
- Tests need deterministic budget expiry without real timers.

## When Not To Use

- Do not rely on this without actual abort/cancel support in the HTTP or database adapter.
- Do not allow child calls to exceed the parent deadline.
- Do not retry after the remaining budget is exhausted.
- Do not trust unbounded external timeout headers without capping them at ingress.

## Implementation Variants

- memory-registry: deterministic in-process registry for unit tests and adapter contracts.
- Express/Fastify middleware: parses inbound deadline headers and attaches a request budget.
- HTTP client adapter: derives child budgets and sends timeout/deadline headers downstream.
- AbortController adapter: maps remaining budget to cancellation signals.

## Recommended Architecture

- core.ts: pure budget creation, header parsing, remaining time, child derivation, expiry, completion, cancellation, and snapshots.
- memory-registry.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/http.ts: maps budget headers to outbound calls and abort signals.
- adapters/framework.ts: installs ingress caps and request-scoped budget storage.

## Public API Sketch

\`\`\`ts
const registry = new MemoryTimeoutBudgetRegistry({ defaultTimeoutMs: 5_000 });
const requestBudget = registry.create({ id: "req-1" });
const child = registry.derive(requestBudget.id, { id: "payments-call", timeoutMs: 2_000 });
const headers = timeoutBudgetHeaders(child, Date.now());
\`\`\`

## Integration Steps

1. Cap inbound deadlines at the API edge.
2. Attach one request budget to each request context.
3. Derive child budgets for downstream calls and propagate headers.
4. Use AbortController or driver timeouts to enforce the remaining budget.
5. Mark budgets completed, cancelled, or expired for metrics.

## Failure Modes

- Child budget outlives parent deadline.
- Retry loops ignore remaining time.
- Expired calls are recorded as ordinary downstream failures.
- External clients send unrealistic timeout headers.
- Timer cleanup is missed after request completion.

## Security Notes

- Treat inbound timeout headers as hints and cap them.
- Do not expose internal request ids in public headers unless intended.
- Avoid logging sensitive route params inside budget ids.

## Verification Checklist

- Stateless tests cover budget creation, parent deadline capping, child derivation, remaining time, headers, parsing, expiry, completion, cancellation, and snapshots.
- Stateful tests cover memory registry create/fromHeaders/derive/complete/cancel/expire and clone-safe reads.
- Adapter tests should verify AbortController cancellation and downstream header propagation.

## Source References

- Deadline propagation patterns in distributed systems.
- gRPC deadline and timeout propagation concepts.
- HTTP client timeout and AbortController patterns.
`;

export const REQUEST_TIMEOUT_BUDGET_MODULE: MwhModule = {
  id: "request-timeout-budget",
  title: "Request Timeout Budget Middleware",
  summary:
    "Reusable API traffic reference for deadline propagation, remaining timeout budgets, child-call caps, expiry, and adapter tests.",
  version: "0.1.0",
  tags: ["api-traffic", "timeout", "deadline", "request-budget", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
