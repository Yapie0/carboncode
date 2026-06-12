import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Circuit Breaker Middleware

## Purpose

Use this module as a reusable reference when protecting API calls, database calls, AI/tool invocations, webhook targets, or downstream services with circuit breaker behavior.

The module contains pure circuit state transitions plus a deterministic memory store for tests. Production adapters can persist state in Redis, gateway memory, service mesh filters, or process-local stores depending on the failure domain.

## When To Use

- Short-circuit calls to a failing downstream service.
- Avoid request pileups during dependency outages.
- Probe recovery with controlled half-open requests.
- Combine with retry, timeout, rate limit, and fallback middleware.

## When Not To Use

- Do not use a circuit breaker without request timeouts.
- Do not share circuit state across unrelated tenants or routes.
- Do not treat circuit breaking as a replacement for backpressure or capacity planning.

## Recommended Architecture

- core.ts: pure closed/open/half-open transitions, failure-rate window, request allowance, outcome recording, and stats.
- memory-store.ts: deterministic stateful store for tests and local demos.
- adapters/redis.ts: shared circuit state for horizontally scaled callers.
- middleware/http.ts: route/downstream scoped request wrapper.
- fallback.ts: optional stale-cache or static fallback response handling.

## Public API Sketch

\`\`\`ts
const breaker = new MemoryCircuitBreakerStore({
  policy: {
    windowMs: 60_000,
    minimumRequests: 10,
    failureRateThreshold: 0.5,
    openDurationMs: 30_000,
    halfOpenMaxInFlight: 1,
  },
});

const allowed = breaker.allow("payments-api");
if (!allowed.allowed) return cachedFallback();
try {
  const response = await callPayments();
  breaker.record("payments-api", "success");
  return response;
} catch (error) {
  breaker.record("payments-api", "failure");
  throw error;
}
\`\`\`

## Integration Rules

1. Scope circuit keys by downstream service, route, tenant class, or operation.
2. Place timeout handling before outcome recording.
3. Record only dependency failures that should affect circuit health.
4. Use half-open probes sparingly.
5. Emit metrics for state transitions, short-circuits, and probe results.
6. Pair with fallbacks where user-facing behavior needs graceful degradation.

## Failure Modes

- False opens when business validation errors are counted as dependency failures.
- Excessive half-open probes during recovery.
- Cascading latency when calls lack strict timeouts.
- One noisy tenant opening the circuit for all tenants.
- Process-local state diverging across replicas.

## Verification Checklist

- Stateless tests cover closed allowance, failure-rate opening, open short-circuit, half-open transition, half-open success close, half-open failure reopen, and window pruning.
- Stateful tests cover per-key isolation, allow/record persistence, reset, and deterministic time.
- Adapter tests should verify atomic state transitions under concurrent callers.
- HTTP wrapper tests should assert fallback behavior and metrics labels.

## Source References

- Michael Nygard circuit breaker pattern.
- Envoy outlier detection and ejection concepts.
- Resilience4j circuit breaker state machine.
`;

export const CIRCUIT_BREAKER_MODULE: MwhModule = {
  id: "circuit-breaker",
  title: "Circuit Breaker Middleware",
  summary:
    "Reusable API traffic circuit breaker with failure-rate windows, open/half-open transitions, probes, and stateful tests.",
  version: "0.1.0",
  tags: ["api-traffic", "circuit-breaker", "resilience", "fallback", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
