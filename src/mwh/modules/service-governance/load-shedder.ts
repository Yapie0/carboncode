import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Load Shedder Middleware

## Purpose

Use this module as a reusable reference for overload protection: fixed-window request budgets, priority-aware admission, low-priority dropping, emergency priority override, retry-after hints, snapshots, and decision history.

This module complements bulkhead-isolation. Bulkheads isolate execution capacity after admission; load shedding rejects work before it consumes queue or worker capacity.

## When To Use

- Need to protect a service, tenant, route, or downstream dependency during overload.
- Need deterministic priority-based drop decisions.
- Need a simple local state machine before wiring API middleware, Redis counters, or gateway policies.
- Need explicit retry-after hints for dropped requests.

## When Not To Use

- Do not use local memory for global multi-instance production admission control.
- Do not shed critical safety or correctness traffic without a policy exception.
- Do not use untrusted client-supplied priority without validation.
- Do not rely on load shedding alone when downstream calls also need timeouts, retries, and bulkheads.

## Implementation Variants

- Memory shedder for unit tests, local CLIs, and single-process services.
- Express/Fastify middleware that maps routes and tenants to shedding scopes.
- Redis counter adapter for distributed fixed-window or sliding-window decisions.
- API gateway adapter for APISIX/Kong/Envoy local rate and overload rules.
- Queue adapter that sheds producer work before enqueueing.

## Recommended Architecture

- core.ts: pure policy validation, fixed-window rolling, request evaluation, priority override, drop decisions, retry-after hints, snapshots, and clone helpers.
- memory-shedder.ts: stateful policy definition, decide, roll, snapshots, and decision history.
- adapters/http.ts: middleware mapping request metadata to scope and priority.
- adapters/redis.ts: distributed counter with atomic window updates.
- integrations/bulkhead.ts: shed before bulkhead admission.

## Public API Sketch

\`\`\`ts
const shedder = new MemoryLoadShedder();
shedder.definePolicy({
  scope: "api:search",
  windowMs: 1_000,
  maxRequests: 100,
  minPriority: 10,
  priorityOverrideAt: 90,
  retryAfterMs: 250,
});

const decision = shedder.decide({
  scope: "api:search",
  requestId: "req-1",
  priority: 20,
});
\`\`\`

## Integration Rules

1. Normalize scopes before applying policies.
2. Validate request priority server-side.
3. Shed before queueing or expensive dependency calls.
4. Return retry-after hints for retryable clients.
5. Keep decision history or metrics for tuning.
6. Use distributed counters when multiple instances share a capacity budget.

## Failure Modes

- Local-only counters allow aggregate traffic to exceed global capacity.
- Incorrect priority mapping drops important traffic.
- Window boundaries create short bursts unless smoothed by a sliding-window adapter.
- Retrying clients amplify overload without backoff.
- Missing observability hides excessive shedding until users report failures.

## Security Notes

- Do not trust client priority headers directly.
- Avoid exposing per-tenant capacity to unrelated tenants.
- Rate-limit dropped clients separately to reduce retry storms.
- Audit policy changes for critical traffic classes.

## Verification Checklist

- Stateless tests cover policy validation, window rolling, accept/drop decisions, capacity exhaustion, min-priority rejection, priority override, retry-after hints, snapshots, and clone safety.
- Stateful tests cover multiple scopes, missing policies, window reset, decision history, snapshots, and clone-safe state reads.
- Redis adapters should test atomic counters, TTL expiry, clock boundaries, and concurrent calls.
- HTTP adapters should test priority extraction and response status/retry-after mapping.

## Source References

- Overload protection and load shedding patterns.
- Fixed-window and sliding-window admission control.
- API gateway overload and local rate limiting patterns.
- Priority-based request admission in service reliability engineering.
`;

export const LOAD_SHEDDER_MODULE: MwhModule = {
  id: "load-shedder",
  title: "Load Shedder Middleware",
  summary:
    "Reusable service-governance reference with fixed-window budgets, priority-aware admission, overload drops, retry-after hints, and stateful decision tests.",
  version: "0.1.0",
  tags: ["service-governance", "load-shedding", "overload", "priority", "admission", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
