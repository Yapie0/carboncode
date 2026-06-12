import { describe, expect, it } from "vitest";
import {
  type RequestRetryPolicy,
  cancelRetryExecution,
  createRetryExecution,
  decideRetry,
  nextRetryAtMs,
  recordRetryFailure,
  recordRetrySuccess,
  retryDelayMs,
  retryExecutionSnapshot,
} from "../src/mwh/modules/api-traffic/request-retry-policy/core.js";
import { MemoryRetryExecutionStore } from "../src/mwh/modules/api-traffic/request-retry-policy/memory-store.js";

const policy: RequestRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
  retryableStatusCodes: [429, 502, 503, 504],
  retryableMethods: ["GET", "PUT"],
  jitterRatio: 0.1,
};

describe("request-retry-policy MWH module", () => {
  it("decides retry behavior for transient and terminal failures", () => {
    expect(retryDelayMs(2, policy)).toBe(220);
    expect(
      decideRetry({
        policy,
        failure: { kind: "http", statusCode: 503, method: "GET" },
        attempt: 1,
        nowMs: 1000,
        deadlineAtMs: 2000,
      }),
    ).toEqual({
      retry: true,
      attempt: 1,
      nextAttempt: 2,
      delayMs: 110,
      reason: "scheduled by retry policy",
    });
    expect(
      decideRetry({
        policy,
        failure: { kind: "http", statusCode: 503, method: "GET", retryAfterMs: 500 },
        attempt: 1,
        nowMs: 1000,
        deadlineAtMs: 2000,
      }).delayMs,
    ).toBe(500);
    expect(
      decideRetry({
        policy,
        failure: { kind: "http", statusCode: 400, method: "GET" },
        attempt: 1,
        nowMs: 1000,
      }).reason,
    ).toBe("failure is not retryable");
    expect(
      decideRetry({
        policy,
        failure: { kind: "network", method: "POST" },
        attempt: 1,
        nowMs: 1000,
      }).reason,
    ).toBe("method is not retryable");
    expect(
      decideRetry({
        policy,
        failure: { kind: "cancelled", method: "GET" },
        attempt: 1,
        nowMs: 1000,
      }).reason,
    ).toBe("failure is not retryable");
    expect(
      decideRetry({
        policy,
        failure: { kind: "timeout", method: "GET" },
        attempt: 1,
        nowMs: 1950,
        deadlineAtMs: 2000,
      }).reason,
    ).toBe("retry would exceed deadline");
  });

  it("records failure, success, exhaustion, cancellation, and snapshots", () => {
    let execution = createRetryExecution({ id: "req-1", nowMs: 1000, deadlineAtMs: 5000 });
    execution = recordRetryFailure(execution, {
      failure: { kind: "http", statusCode: 503, method: "GET" },
      nowMs: 1010,
      policy,
    });
    expect(execution.status).toBe("active");
    expect(nextRetryAtMs(execution)).toBe(1120);

    const succeeded = recordRetrySuccess(execution, 1130);
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.attempts).toHaveLength(2);

    let exhausted = createRetryExecution({ id: "req-2", nowMs: 1000 });
    exhausted = recordRetryFailure(exhausted, {
      failure: { kind: "network", method: "GET" },
      nowMs: 1010,
      policy,
    });
    exhausted = recordRetryFailure(exhausted, {
      failure: { kind: "network", method: "GET" },
      nowMs: 1200,
      policy,
    });
    exhausted = recordRetryFailure(exhausted, {
      failure: { kind: "network", method: "GET" },
      nowMs: 1500,
      policy,
    });
    expect(exhausted.status).toBe("exhausted");

    const cancelled = cancelRetryExecution(createRetryExecution({ id: "req-3", nowMs: 1000 }), {
      nowMs: 1010,
    });
    expect(retryExecutionSnapshot([succeeded, exhausted, cancelled])).toEqual({
      active: 0,
      succeeded: 1,
      failed: 0,
      exhausted: 1,
      cancelled: 1,
    });
  });

  it("runs stateful retry executions with due filtering and clone-safe reads", () => {
    let now = 1000;
    const store = new MemoryRetryExecutionStore({ policy, now: () => now });

    store.start({ id: "req-1", deadlineAtMs: 5000 });
    expect(() => store.start({ id: "req-1" })).toThrow("retry execution already exists");

    store.recordFailure("req-1", { kind: "http", statusCode: 503, method: "GET" });
    expect(store.dueExecutions()).toHaveLength(0);

    const leaked = store.list();
    (leaked[0]!.attempts[0]!.failure as { error?: string }).error = "mutated";

    now = 1120;
    expect(store.dueExecutions()).toHaveLength(1);
    expect(store.list()[0]!.attempts[0]!.failure).not.toMatchObject({ error: "mutated" });

    store.recordSuccess("req-1");
    expect(store.snapshot()).toEqual({
      active: 0,
      succeeded: 1,
      failed: 0,
      exhausted: 0,
      cancelled: 0,
    });
  });

  it("tracks non-retryable failures and cancellation in the memory store", () => {
    let now = 1000;
    const store = new MemoryRetryExecutionStore({ policy, now: () => now });

    store.start({ id: "req-2" });
    const failed = store.recordFailure("req-2", { kind: "http", statusCode: 404, method: "GET" });
    expect(failed.status).toBe("failed");

    now = 1100;
    store.start({ id: "req-3" });
    expect(store.cancel("req-3").status).toBe("cancelled");
    expect(store.snapshot()).toEqual({
      active: 0,
      succeeded: 0,
      failed: 1,
      exhausted: 0,
      cancelled: 1,
    });
  });
});
