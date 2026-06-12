export type CircuitState = "closed" | "open" | "half-open";
export type CircuitOutcome = "success" | "failure";

export interface CircuitBreakerState {
  state: CircuitState;
  events: readonly CircuitEvent[];
  openedAtMs?: number;
  halfOpenStartedAtMs?: number;
  halfOpenInFlight: number;
}

export interface CircuitEvent {
  atMs: number;
  outcome: CircuitOutcome;
}

export interface CircuitBreakerPolicy {
  windowMs: number;
  minimumRequests: number;
  failureRateThreshold: number;
  openDurationMs: number;
  halfOpenMaxInFlight: number;
}

export interface CircuitAllowResult {
  allowed: boolean;
  state: CircuitBreakerState;
  reason: "closed" | "open" | "half-open-probe" | "half-open-saturated";
  retryAfterMs: number;
}

export function initialCircuitState(): CircuitBreakerState {
  return { state: "closed", events: [], halfOpenInFlight: 0 };
}

export function allowCircuitRequest(
  state: CircuitBreakerState,
  input: { nowMs: number; policy: CircuitBreakerPolicy },
): CircuitAllowResult {
  assertPolicy(input.policy);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const current = normalizeCircuitState(state, input.nowMs, input.policy);

  if (current.state === "open") {
    const retryAfterMs = Math.max(
      0,
      (current.openedAtMs ?? input.nowMs) + input.policy.openDurationMs - input.nowMs,
    );
    return { allowed: false, state: current, reason: "open", retryAfterMs };
  }

  if (current.state === "half-open") {
    if (current.halfOpenInFlight >= input.policy.halfOpenMaxInFlight) {
      return {
        allowed: false,
        state: current,
        reason: "half-open-saturated",
        retryAfterMs: 0,
      };
    }
    return {
      allowed: true,
      state: { ...current, halfOpenInFlight: current.halfOpenInFlight + 1 },
      reason: "half-open-probe",
      retryAfterMs: 0,
    };
  }

  return { allowed: true, state: current, reason: "closed", retryAfterMs: 0 };
}

export function recordCircuitOutcome(
  state: CircuitBreakerState,
  input: { nowMs: number; outcome: CircuitOutcome; policy: CircuitBreakerPolicy },
): CircuitBreakerState {
  assertPolicy(input.policy);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  let current = normalizeCircuitState(state, input.nowMs, input.policy);

  if (current.state === "half-open") {
    if (input.outcome === "success") {
      const nextInFlight = Math.max(0, current.halfOpenInFlight - 1);
      return {
        state: nextInFlight === 0 ? "closed" : "half-open",
        events: nextInFlight === 0 ? [] : current.events,
        halfOpenStartedAtMs: nextInFlight === 0 ? undefined : current.halfOpenStartedAtMs,
        halfOpenInFlight: nextInFlight,
      };
    }
    return {
      ...current,
      state: "open",
      openedAtMs: input.nowMs,
      halfOpenStartedAtMs: undefined,
      halfOpenInFlight: 0,
    };
  }

  if (current.state === "open") return current;

  const events = pruneCircuitEvents(
    [...current.events, { atMs: input.nowMs, outcome: input.outcome }],
    input.nowMs,
    input.policy.windowMs,
  );
  current = { ...current, events };
  const stats = circuitStats(current, input.nowMs, input.policy.windowMs);
  if (
    stats.total >= input.policy.minimumRequests &&
    stats.failureRate >= input.policy.failureRateThreshold
  ) {
    return { ...current, state: "open", openedAtMs: input.nowMs, halfOpenInFlight: 0 };
  }
  return current;
}

export function normalizeCircuitState(
  state: CircuitBreakerState,
  nowMs: number,
  policy: CircuitBreakerPolicy,
): CircuitBreakerState {
  assertPolicy(policy);
  assertNonNegativeInteger(nowMs, "nowMs");
  if (
    state.state === "open" &&
    state.openedAtMs !== undefined &&
    nowMs >= state.openedAtMs + policy.openDurationMs
  ) {
    return {
      state: "half-open",
      events: [],
      halfOpenStartedAtMs: nowMs,
      halfOpenInFlight: 0,
    };
  }
  return {
    ...state,
    events: pruneCircuitEvents(state.events, nowMs, policy.windowMs),
  };
}

export function circuitStats(
  state: CircuitBreakerState,
  nowMs: number,
  windowMs: number,
): { total: number; failures: number; failureRate: number } {
  assertPositiveInteger(windowMs, "windowMs");
  const events = pruneCircuitEvents(state.events, nowMs, windowMs);
  const failures = events.filter((event) => event.outcome === "failure").length;
  return {
    total: events.length,
    failures,
    failureRate: events.length === 0 ? 0 : failures / events.length,
  };
}

export function pruneCircuitEvents(
  events: readonly CircuitEvent[],
  nowMs: number,
  windowMs: number,
): CircuitEvent[] {
  assertNonNegativeInteger(nowMs, "nowMs");
  assertPositiveInteger(windowMs, "windowMs");
  const cutoff = nowMs - windowMs;
  return events.filter((event) => event.atMs > cutoff);
}

export function cloneCircuitBreakerState(state: CircuitBreakerState): CircuitBreakerState {
  return {
    ...state,
    events: state.events.map((event) => ({ ...event })),
  };
}

export function cloneCircuitAllowResult(result: CircuitAllowResult): CircuitAllowResult {
  return {
    ...result,
    state: cloneCircuitBreakerState(result.state),
  };
}

function assertPolicy(policy: CircuitBreakerPolicy): void {
  assertPositiveInteger(policy.windowMs, "windowMs");
  assertPositiveInteger(policy.minimumRequests, "minimumRequests");
  assertPositiveInteger(policy.openDurationMs, "openDurationMs");
  assertPositiveInteger(policy.halfOpenMaxInFlight, "halfOpenMaxInFlight");
  if (
    !Number.isFinite(policy.failureRateThreshold) ||
    policy.failureRateThreshold <= 0 ||
    policy.failureRateThreshold > 1
  ) {
    throw new Error("failureRateThreshold must be > 0 and <= 1");
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
