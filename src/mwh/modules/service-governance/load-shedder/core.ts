export type LoadDecisionReason =
  | "capacity-available"
  | "priority-override"
  | "min-priority"
  | "capacity-exhausted";

export interface LoadSheddingPolicy {
  scope: string;
  windowMs: number;
  maxRequests: number;
  minPriority: number;
  priorityOverrideAt: number;
  retryAfterMs: number;
}

export interface LoadSheddingWindow {
  windowStartMs: number;
  accepted: number;
  dropped: number;
}

export interface LoadSheddingState {
  policy: LoadSheddingPolicy;
  window: LoadSheddingWindow;
}

export interface LoadSheddingRequest {
  id: string;
  scope: string;
  priority: number;
  nowMs: number;
}

export interface LoadSheddingDecision {
  requestId: string;
  scope: string;
  accepted: boolean;
  reason: LoadDecisionReason;
  priority: number;
  retryAfterMs?: number;
  decidedAtMs: number;
  windowStartMs: number;
}

export interface LoadSheddingProjection {
  decision: LoadSheddingDecision;
  state: LoadSheddingState;
}

export function createLoadSheddingPolicy(input: {
  scope: string;
  windowMs: number;
  maxRequests: number;
  minPriority?: number;
  priorityOverrideAt?: number;
  retryAfterMs?: number;
}): LoadSheddingPolicy {
  assertNonEmpty(input.scope, "scope");
  assertPositiveInteger(input.windowMs, "windowMs");
  assertPositiveInteger(input.maxRequests, "maxRequests");
  assertNonNegativeInteger(input.minPriority ?? 0, "minPriority");
  assertNonNegativeInteger(input.priorityOverrideAt ?? 100, "priorityOverrideAt");
  assertPositiveInteger(input.retryAfterMs ?? input.windowMs, "retryAfterMs");
  if ((input.minPriority ?? 0) > (input.priorityOverrideAt ?? 100)) {
    throw new Error("minPriority must not exceed priorityOverrideAt");
  }
  return {
    scope: input.scope,
    windowMs: input.windowMs,
    maxRequests: input.maxRequests,
    minPriority: input.minPriority ?? 0,
    priorityOverrideAt: input.priorityOverrideAt ?? 100,
    retryAfterMs: input.retryAfterMs ?? input.windowMs,
  };
}

export function createLoadSheddingState(
  policy: LoadSheddingPolicy,
  input: { nowMs: number },
): LoadSheddingState {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    policy: { ...policy },
    window: {
      windowStartMs: alignWindowStart(input.nowMs, policy.windowMs),
      accepted: 0,
      dropped: 0,
    },
  };
}

export function evaluateLoadShedding(
  state: LoadSheddingState,
  request: LoadSheddingRequest,
): LoadSheddingProjection {
  return evaluateLoadSheddingInternal(state, request, { mutate: true });
}

export function previewLoadShedding(
  state: LoadSheddingState,
  request: LoadSheddingRequest,
): LoadSheddingProjection {
  return evaluateLoadSheddingInternal(state, request, { mutate: false });
}

export function retryAfterForLoadShedding(state: LoadSheddingState, nowMs: number): number {
  assertNonNegativeInteger(nowMs, "nowMs");
  const windowEndMs = state.window.windowStartMs + state.policy.windowMs;
  return Math.max(1, windowEndMs - nowMs);
}

function evaluateLoadSheddingInternal(
  state: LoadSheddingState,
  request: LoadSheddingRequest,
  input: { mutate: boolean },
): LoadSheddingProjection {
  assertNonEmpty(request.id, "request.id");
  assertNonEmpty(request.scope, "request.scope");
  assertNonNegativeInteger(request.priority, "priority");
  assertNonNegativeInteger(request.nowMs, "nowMs");
  if (request.scope !== state.policy.scope) {
    throw new Error("request scope does not match load-shedding policy scope");
  }
  const next = rollLoadSheddingWindow(state, { nowMs: request.nowMs });
  if (request.priority < next.policy.minPriority) {
    return applyDrop(next, request, "min-priority", input);
  }
  if (request.priority >= next.policy.priorityOverrideAt) {
    return applyAccept(next, request, "priority-override", input);
  }
  if (next.window.accepted < next.policy.maxRequests) {
    return applyAccept(next, request, "capacity-available", input);
  }
  return applyDrop(next, request, "capacity-exhausted", input);
}

export function rollLoadSheddingWindow(
  state: LoadSheddingState,
  input: { nowMs: number },
): LoadSheddingState {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const windowStartMs = alignWindowStart(input.nowMs, state.policy.windowMs);
  if (windowStartMs === state.window.windowStartMs) return cloneLoadSheddingState(state);
  return {
    policy: { ...state.policy },
    window: {
      windowStartMs,
      accepted: 0,
      dropped: 0,
    },
  };
}

export function loadSheddingSnapshot(state: LoadSheddingState): {
  scope: string;
  windowStartMs: number;
  accepted: number;
  dropped: number;
  capacityRemaining: number;
} {
  return {
    scope: state.policy.scope,
    windowStartMs: state.window.windowStartMs,
    accepted: state.window.accepted,
    dropped: state.window.dropped,
    capacityRemaining: Math.max(0, state.policy.maxRequests - state.window.accepted),
  };
}

export function cloneLoadSheddingState(state: LoadSheddingState): LoadSheddingState {
  return {
    policy: { ...state.policy },
    window: { ...state.window },
  };
}

function applyAccept(
  state: LoadSheddingState,
  request: LoadSheddingRequest,
  reason: LoadDecisionReason,
  input: { mutate: boolean },
): LoadSheddingProjection {
  const next = cloneLoadSheddingState(state);
  if (input.mutate) next.window.accepted += 1;
  return {
    decision: createDecision(next, request, true, reason),
    state: next,
  };
}

function applyDrop(
  state: LoadSheddingState,
  request: LoadSheddingRequest,
  reason: LoadDecisionReason,
  input: { mutate: boolean },
): LoadSheddingProjection {
  const next = cloneLoadSheddingState(state);
  if (input.mutate) next.window.dropped += 1;
  return {
    decision: createDecision(next, request, false, reason),
    state: next,
  };
}

function createDecision(
  state: LoadSheddingState,
  request: LoadSheddingRequest,
  accepted: boolean,
  reason: LoadDecisionReason,
): LoadSheddingDecision {
  return {
    requestId: request.id,
    scope: request.scope,
    accepted,
    reason,
    priority: request.priority,
    retryAfterMs: accepted
      ? undefined
      : Math.min(state.policy.retryAfterMs, retryAfterForLoadShedding(state, request.nowMs)),
    decidedAtMs: request.nowMs,
    windowStartMs: state.window.windowStartMs,
  };
}

function alignWindowStart(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
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
