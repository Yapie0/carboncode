export type RetryFailureKind = "network" | "timeout" | "http" | "cancelled";

export interface RequestRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: readonly number[];
  retryableMethods: readonly string[];
  jitterRatio?: number;
}

export interface RetryAttemptFailure {
  kind: RetryFailureKind;
  statusCode?: number;
  method: string;
  retryAfterMs?: number;
  error?: string;
}

export interface RetryDecision {
  retry: boolean;
  attempt: number;
  nextAttempt: number;
  delayMs: number;
  reason: string;
}

export interface RetryExecution {
  id: string;
  startedAtMs: number;
  deadlineAtMs?: number;
  attempts: readonly RetryExecutionAttempt[];
  status: "active" | "succeeded" | "failed" | "exhausted" | "cancelled";
  completedAtMs?: number;
}

export interface RetryExecutionAttempt {
  attempt: number;
  atMs: number;
  outcome: "failure" | "success";
  failure?: RetryAttemptFailure;
  nextAttemptAtMs?: number;
}

export interface RetryExecutionSnapshot {
  active: number;
  succeeded: number;
  failed: number;
  exhausted: number;
  cancelled: number;
}

export function createRetryExecution(input: {
  id: string;
  nowMs: number;
  deadlineAtMs?: number;
}): RetryExecution {
  assertText(input.id, "id");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.deadlineAtMs !== undefined) {
    assertNonNegativeInteger(input.deadlineAtMs, "deadlineAtMs");
    if (input.deadlineAtMs <= input.nowMs) throw new Error("deadlineAtMs must be after nowMs");
  }
  return {
    id: input.id,
    startedAtMs: input.nowMs,
    deadlineAtMs: input.deadlineAtMs,
    attempts: [],
    status: "active",
  };
}

export function decideRetry(input: {
  policy: RequestRetryPolicy;
  failure: RetryAttemptFailure;
  attempt: number;
  nowMs: number;
  deadlineAtMs?: number;
}): RetryDecision {
  assertPolicy(input.policy);
  assertFailure(input.failure);
  assertPositiveInteger(input.attempt, "attempt");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.deadlineAtMs !== undefined)
    assertNonNegativeInteger(input.deadlineAtMs, "deadlineAtMs");

  if (input.attempt >= input.policy.maxAttempts) {
    return exhausted(input.attempt, "max attempts reached");
  }
  if (!input.policy.retryableMethods.includes(input.failure.method.toUpperCase())) {
    return exhausted(input.attempt, "method is not retryable");
  }
  if (!isRetryableFailure(input.failure, input.policy)) {
    return exhausted(input.attempt, "failure is not retryable");
  }

  const rawDelayMs = input.failure.retryAfterMs ?? retryDelayMs(input.attempt, input.policy);
  const delayMs = Math.min(rawDelayMs, input.policy.maxDelayMs);
  if (input.deadlineAtMs !== undefined && input.nowMs + delayMs >= input.deadlineAtMs) {
    return exhausted(input.attempt, "retry would exceed deadline");
  }
  return {
    retry: true,
    attempt: input.attempt,
    nextAttempt: input.attempt + 1,
    delayMs,
    reason: input.failure.retryAfterMs === undefined ? "scheduled by retry policy" : "retry-after",
  };
}

export function recordRetryFailure(
  execution: RetryExecution,
  input: {
    failure: RetryAttemptFailure;
    nowMs: number;
    policy: RequestRetryPolicy;
  },
): RetryExecution {
  assertActiveExecution(execution);
  const attempt = execution.attempts.length + 1;
  const decision = decideRetry({
    policy: input.policy,
    failure: input.failure,
    attempt,
    nowMs: input.nowMs,
    deadlineAtMs: execution.deadlineAtMs,
  });
  const nextAttemptAtMs = decision.retry ? input.nowMs + decision.delayMs : undefined;
  return cloneRetryExecution({
    ...execution,
    attempts: [
      ...execution.attempts,
      {
        attempt,
        atMs: input.nowMs,
        outcome: "failure",
        failure: cloneFailure(input.failure),
        nextAttemptAtMs,
      },
    ],
    status: decision.retry
      ? "active"
      : decision.reason === "max attempts reached"
        ? "exhausted"
        : "failed",
    completedAtMs: decision.retry ? undefined : input.nowMs,
  });
}

export function recordRetrySuccess(execution: RetryExecution, nowMs: number): RetryExecution {
  assertActiveExecution(execution);
  assertNonNegativeInteger(nowMs, "nowMs");
  const attempt = execution.attempts.length + 1;
  return cloneRetryExecution({
    ...execution,
    attempts: [...execution.attempts, { attempt, atMs: nowMs, outcome: "success" }],
    status: "succeeded",
    completedAtMs: nowMs,
  });
}

export function cancelRetryExecution(
  execution: RetryExecution,
  input: { nowMs: number },
): RetryExecution {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (execution.status !== "active") return cloneRetryExecution(execution);
  return cloneRetryExecution({ ...execution, status: "cancelled", completedAtMs: input.nowMs });
}

export function nextRetryAtMs(execution: RetryExecution): number | undefined {
  const lastAttempt = execution.attempts.at(-1);
  return lastAttempt?.nextAttemptAtMs;
}

export function retryExecutionSnapshot(
  executions: readonly RetryExecution[],
): RetryExecutionSnapshot {
  return {
    active: executions.filter((execution) => execution.status === "active").length,
    succeeded: executions.filter((execution) => execution.status === "succeeded").length,
    failed: executions.filter((execution) => execution.status === "failed").length,
    exhausted: executions.filter((execution) => execution.status === "exhausted").length,
    cancelled: executions.filter((execution) => execution.status === "cancelled").length,
  };
}

export function retryDelayMs(attempt: number, policy: RequestRetryPolicy): number {
  assertPolicy(policy);
  assertPositiveInteger(attempt, "attempt");
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jitterRatio = policy.jitterRatio ?? 0;
  return Math.floor(exponential * (1 + jitterRatio));
}

export function cloneRetryExecution(execution: RetryExecution): RetryExecution {
  return {
    ...execution,
    attempts: execution.attempts.map((attempt) => ({
      ...attempt,
      failure: attempt.failure ? cloneFailure(attempt.failure) : undefined,
    })),
  };
}

function isRetryableFailure(failure: RetryAttemptFailure, policy: RequestRetryPolicy): boolean {
  if (failure.kind === "network" || failure.kind === "timeout") return true;
  if (failure.kind === "cancelled") return false;
  return (
    failure.statusCode !== undefined && policy.retryableStatusCodes.includes(failure.statusCode)
  );
}

function exhausted(attempt: number, reason: string): RetryDecision {
  return { retry: false, attempt, nextAttempt: attempt, delayMs: 0, reason };
}

function cloneFailure(failure: RetryAttemptFailure): RetryAttemptFailure {
  return { ...failure, method: failure.method.toUpperCase() };
}

function assertActiveExecution(execution: RetryExecution): void {
  if (execution.status !== "active") throw new Error("retry execution is not active");
}

function assertFailure(failure: RetryAttemptFailure): void {
  assertText(failure.method, "method");
  if (failure.kind === "http") {
    const statusCode = failure.statusCode;
    if (
      !Number.isInteger(statusCode) ||
      statusCode === undefined ||
      statusCode < 100 ||
      statusCode > 599
    ) {
      throw new Error("statusCode must be a valid HTTP status");
    }
  }
  if (failure.retryAfterMs !== undefined)
    assertPositiveInteger(failure.retryAfterMs, "retryAfterMs");
}

function assertPolicy(policy: RequestRetryPolicy): void {
  assertPositiveInteger(policy.maxAttempts, "maxAttempts");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  if (policy.baseDelayMs > policy.maxDelayMs) throw new Error("baseDelayMs exceeds maxDelayMs");
  if (policy.retryableStatusCodes.length === 0) throw new Error("retryableStatusCodes is required");
  if (policy.retryableMethods.length === 0) throw new Error("retryableMethods is required");
  if (policy.jitterRatio !== undefined && (policy.jitterRatio < 0 || policy.jitterRatio > 1)) {
    throw new Error("jitterRatio must be between 0 and 1");
  }
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
