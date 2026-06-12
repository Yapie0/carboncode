import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Request Retry Policy Middleware

## Purpose

Use this module as a reusable reference when implementing bounded retries for HTTP, RPC, fetch, axios, queue consumers, or service-to-service calls.

The module focuses on retry decisions, not transport code: classify retryable failures, respect methods and status codes, apply exponential backoff, honor Retry-After, cap delays, stop before deadlines, track execution state, and expose due retries and snapshots.

## When To Use

- Downstream calls fail transiently with network errors, timeouts, 429, 502, 503, or 504.
- Clients need consistent retry behavior across fetch/axios/RPC adapters.
- Retries must respect timeout budgets or request deadlines.
- Tests need retry scheduling without sleeping or calling external services.

## When Not To Use

- Do not retry non-idempotent writes unless paired with idempotency keys.
- Do not retry cancelled requests.
- Do not retry after the caller deadline would be exceeded.
- Do not hide persistent downstream failures behind unbounded retries.

## Implementation Variants

- memory-store: deterministic execution ledger for unit tests and adapter contracts.
- fetch adapter: wraps fetch and records failures/successes.
- axios adapter: maps axios errors and response status codes to RetryAttemptFailure.
- RPC adapter: maps grpc/unary status codes to retryable categories.

## Recommended Architecture

- core.ts: pure retry delay, failure classification, deadline checks, attempt recording, cancellation, and snapshots.
- memory-store.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/fetch.ts: executes attempts and sleeps through injected scheduler.
- adapters/axios.ts: maps response/error objects into retry failures.
- integration with request-timeout-budget: pass deadlineAtMs into createRetryExecution.

## Public API Sketch

\`\`\`ts
const store = new MemoryRetryExecutionStore({
  policy: {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 1_000,
    retryableStatusCodes: [429, 502, 503, 504],
    retryableMethods: ["GET", "PUT", "DELETE"],
  },
  now: () => clock.now,
});

store.start({ id: "req-1", deadlineAtMs: clock.now + 5_000 });
store.recordFailure("req-1", { kind: "http", statusCode: 503, method: "GET" });
const due = store.dueExecutions();
\`\`\`

## Integration Steps

1. Choose retryable methods and status codes per endpoint.
2. Start a retry execution before the first attempt.
3. Record network, timeout, HTTP, or cancellation failures.
4. Schedule the next attempt only when the policy returns active state and the execution is due.
5. Record success on the first successful response.
6. Send exhausted executions to alerting or a dead-letter workflow when needed.

## Failure Modes

- Retrying POST without idempotency duplicates mutations.
- Retry-After is ignored and the service is hammered.
- Retry delay exceeds the caller timeout budget.
- Jitter or exponential backoff is applied inconsistently across adapters.
- Execution state is mutated by callers and tests hide bugs.

## Security Notes

- Avoid logging full URLs when they contain tokens.
- Retry only operations that are safe or have idempotency protection.
- Cap attempts and delays to avoid resource exhaustion.
- Preserve trace headers across attempts.

## Verification Checklist

- Stateless tests cover retryable status codes, non-retryable 4xx, network/timeout failures, cancelled failures, Retry-After, max attempts, deadline cutoff, success, cancel, and snapshots.
- Stateful tests cover start, duplicate rejection, failure scheduling, due execution filtering, clone-safe reads, success, exhausted, and cancellation.
- Adapter tests should map real transport errors into RetryAttemptFailure without sleeping in unit tests.

## Source References

- HTTP retry and backoff patterns.
- Retry-After semantics for 429 and 503 responses.
- gRPC deadline and retry policy patterns.
- Idempotency-key patterns for retrying writes.
`;

export const REQUEST_RETRY_POLICY_MODULE: MwhModule = {
  id: "request-retry-policy",
  title: "Request Retry Policy Middleware",
  summary:
    "Reusable api-traffic reference for bounded request retries, retryable failure classification, Retry-After handling, deadline cutoffs, and execution ledgers.",
  version: "0.1.0",
  tags: ["api-traffic", "retry", "backoff", "timeout", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
