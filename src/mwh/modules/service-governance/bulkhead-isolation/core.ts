export type BulkheadRequestStatus = "running" | "queued" | "rejected" | "completed" | "timed-out";

export interface BulkheadPolicy {
  scope: string;
  maxConcurrent: number;
  maxQueue: number;
  queueTimeoutMs: number;
}

export interface BulkheadRequest {
  id: string;
  scope: string;
  status: BulkheadRequestStatus;
  enqueuedAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  reason?: string;
}

export interface BulkheadState {
  policy: BulkheadPolicy;
  running: BulkheadRequest[];
  queued: BulkheadRequest[];
  rejected: BulkheadRequest[];
  completed: BulkheadRequest[];
}

export interface BulkheadAdmissionResult {
  request: BulkheadRequest;
  state: BulkheadState;
}

export interface BulkheadReleaseResult {
  completed: BulkheadRequest | null;
  promoted: BulkheadRequest | null;
  state: BulkheadState;
}

export interface BulkheadPruneResult {
  timedOut: BulkheadRequest[];
  state: BulkheadState;
}

export interface BulkheadDrainResult {
  drained: BulkheadRequest[];
  state: BulkheadState;
}

export function createBulkheadPolicy(input: {
  scope: string;
  maxConcurrent: number;
  maxQueue: number;
  queueTimeoutMs: number;
}): BulkheadPolicy {
  assertNonEmpty(input.scope, "scope");
  assertPositiveInteger(input.maxConcurrent, "maxConcurrent");
  assertNonNegativeInteger(input.maxQueue, "maxQueue");
  assertPositiveInteger(input.queueTimeoutMs, "queueTimeoutMs");
  return { ...input };
}

export function createBulkheadState(policy: BulkheadPolicy): BulkheadState {
  return {
    policy: { ...policy },
    running: [],
    queued: [],
    rejected: [],
    completed: [],
  };
}

export function admitBulkheadRequest(
  state: BulkheadState,
  input: { requestId: string; nowMs: number },
): BulkheadAdmissionResult {
  assertNonEmpty(input.requestId, "requestId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  ensureUniqueRequestId(state, input.requestId);
  const base: BulkheadRequest = {
    id: input.requestId,
    scope: state.policy.scope,
    status: "queued",
    enqueuedAtMs: input.nowMs,
  };
  const next = cloneBulkheadState(state);
  if (next.running.length < next.policy.maxConcurrent) {
    const request = { ...base, status: "running" as const, startedAtMs: input.nowMs };
    next.running.push(request);
    return { request: { ...request }, state: sortBulkheadState(next) };
  }
  if (next.queued.length < next.policy.maxQueue) {
    next.queued.push(base);
    return { request: { ...base }, state: sortBulkheadState(next) };
  }
  const rejected = { ...base, status: "rejected" as const, reason: "bulkhead queue full" };
  next.rejected.push(rejected);
  return { request: { ...rejected }, state: sortBulkheadState(next) };
}

export function releaseBulkheadRequest(
  state: BulkheadState,
  input: { requestId: string; nowMs: number },
): BulkheadReleaseResult {
  assertNonEmpty(input.requestId, "requestId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const next = cloneBulkheadState(state);
  const runningIndex = next.running.findIndex((request) => request.id === input.requestId);
  if (runningIndex === -1) {
    return { completed: null, promoted: null, state: sortBulkheadState(next) };
  }
  const [running] = next.running.splice(runningIndex, 1);
  if (!running) return { completed: null, promoted: null, state: sortBulkheadState(next) };
  const completed: BulkheadRequest = {
    ...running,
    status: "completed",
    completedAtMs: input.nowMs,
  };
  next.completed.push(completed);
  const promoted = promoteNextQueued(next, input.nowMs);
  return {
    completed: { ...completed },
    promoted: promoted ? { ...promoted } : null,
    state: sortBulkheadState(next),
  };
}

export function pruneTimedOutQueued(
  state: BulkheadState,
  input: { nowMs: number },
): BulkheadPruneResult {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const next = cloneBulkheadState(state);
  const timedOut: BulkheadRequest[] = [];
  next.queued = next.queued.filter((request) => {
    const expired = input.nowMs - request.enqueuedAtMs >= next.policy.queueTimeoutMs;
    if (!expired) return true;
    timedOut.push({
      ...request,
      status: "timed-out",
      completedAtMs: input.nowMs,
      reason: "bulkhead queue timeout",
    });
    return false;
  });
  next.completed.push(...timedOut);
  return { timedOut: timedOut.map((request) => ({ ...request })), state: sortBulkheadState(next) };
}

export function drainBulkheadState(
  state: BulkheadState,
  input: { nowMs: number; reason?: string; includeRunning?: boolean },
): BulkheadDrainResult {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const next = cloneBulkheadState(state);
  const drainedQueued = next.queued.map((request) => ({
    ...request,
    status: "rejected" as const,
    completedAtMs: input.nowMs,
    reason: input.reason ?? "bulkhead drained",
  }));
  next.queued = [];
  next.rejected.push(...drainedQueued);

  const drainedRunning = input.includeRunning
    ? next.running.map((request) => ({
        ...request,
        status: "completed" as const,
        completedAtMs: input.nowMs,
        reason: input.reason ?? "bulkhead drained",
      }))
    : [];
  if (input.includeRunning) {
    next.running = [];
    next.completed.push(...drainedRunning);
  }

  return {
    drained: [...drainedQueued, ...drainedRunning].map((request) => ({ ...request })),
    state: sortBulkheadState(next),
  };
}

export function bulkheadSnapshot(state: BulkheadState): {
  scope: string;
  maxConcurrent: number;
  maxQueue: number;
  running: number;
  queued: number;
  rejected: number;
  completed: number;
} {
  return {
    scope: state.policy.scope,
    maxConcurrent: state.policy.maxConcurrent,
    maxQueue: state.policy.maxQueue,
    running: state.running.length,
    queued: state.queued.length,
    rejected: state.rejected.length,
    completed: state.completed.length,
  };
}

export function cloneBulkheadState(state: BulkheadState): BulkheadState {
  return {
    policy: { ...state.policy },
    running: state.running.map((request) => ({ ...request })),
    queued: state.queued.map((request) => ({ ...request })),
    rejected: state.rejected.map((request) => ({ ...request })),
    completed: state.completed.map((request) => ({ ...request })),
  };
}

function promoteNextQueued(state: BulkheadState, nowMs: number): BulkheadRequest | null {
  if (state.running.length >= state.policy.maxConcurrent) return null;
  const nextQueued = state.queued.shift();
  if (!nextQueued) return null;
  const promoted: BulkheadRequest = {
    ...nextQueued,
    status: "running",
    startedAtMs: nowMs,
  };
  state.running.push(promoted);
  return promoted;
}

function sortBulkheadState(state: BulkheadState): BulkheadState {
  state.running.sort((a, b) => a.startedAtMs! - b.startedAtMs! || a.id.localeCompare(b.id));
  state.queued.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id));
  state.rejected.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id));
  state.completed.sort(
    (a, b) => (a.completedAtMs ?? 0) - (b.completedAtMs ?? 0) || a.id.localeCompare(b.id),
  );
  return state;
}

function ensureUniqueRequestId(state: BulkheadState, requestId: string): void {
  const exists = [...state.running, ...state.queued, ...state.rejected, ...state.completed].some(
    (request) => request.id === requestId,
  );
  if (exists) throw new Error(`duplicate bulkhead request id: ${requestId}`);
}

function assertNonEmpty(value: string, name: string): void {
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
