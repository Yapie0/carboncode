import { describe, expect, it } from "vitest";
import {
  allowCircuitRequest,
  circuitStats,
  cloneCircuitAllowResult,
  cloneCircuitBreakerState,
  initialCircuitState,
  normalizeCircuitState,
  recordCircuitOutcome,
} from "../src/mwh/modules/api-traffic/circuit-breaker/core.js";
import { MemoryCircuitBreakerStore } from "../src/mwh/modules/api-traffic/circuit-breaker/memory-store.js";

describe("MWH circuit-breaker middleware", () => {
  const policy = {
    windowMs: 1_000,
    minimumRequests: 4,
    failureRateThreshold: 0.5,
    openDurationMs: 500,
    halfOpenMaxInFlight: 1,
  };

  it("allows closed circuits and opens when failure rate crosses threshold", () => {
    let state = initialCircuitState();
    expect(allowCircuitRequest(state, { nowMs: 1_000, policy })).toEqual(
      expect.objectContaining({ allowed: true, reason: "closed" }),
    );

    state = recordCircuitOutcome(state, { nowMs: 1_000, outcome: "success", policy });
    state = recordCircuitOutcome(state, { nowMs: 1_100, outcome: "failure", policy });
    state = recordCircuitOutcome(state, { nowMs: 1_200, outcome: "success", policy });
    state = recordCircuitOutcome(state, { nowMs: 1_300, outcome: "failure", policy });

    expect(state).toEqual(expect.objectContaining({ state: "open", openedAtMs: 1_300 }));
    expect(circuitStats(state, 1_300, policy.windowMs)).toEqual({
      total: 4,
      failures: 2,
      failureRate: 0.5,
    });
    const clonedState = cloneCircuitBreakerState(state);
    clonedState.events[0]!.outcome = "failure";
    expect(state.events[0]?.outcome).toBe("success");
  });

  it("short-circuits open circuits then transitions to half-open", () => {
    const open = {
      ...initialCircuitState(),
      state: "open" as const,
      openedAtMs: 1_000,
    };

    expect(allowCircuitRequest(open, { nowMs: 1_200, policy })).toEqual(
      expect.objectContaining({ allowed: false, reason: "open", retryAfterMs: 300 }),
    );
    expect(normalizeCircuitState(open, 1_500, policy)).toEqual(
      expect.objectContaining({
        state: "half-open",
        halfOpenStartedAtMs: 1_500,
        halfOpenInFlight: 0,
      }),
    );
  });

  it("limits half-open probes and closes on successful probe", () => {
    const halfOpen = {
      ...initialCircuitState(),
      state: "half-open" as const,
      halfOpenStartedAtMs: 1_500,
    };

    const allowed = allowCircuitRequest(halfOpen, { nowMs: 1_500, policy });
    expect(allowed).toEqual(expect.objectContaining({ allowed: true, reason: "half-open-probe" }));
    const clonedAllowed = cloneCircuitAllowResult(allowed);
    clonedAllowed.state.halfOpenInFlight = 999;
    expect(allowed.state.halfOpenInFlight).toBe(1);
    expect(allowCircuitRequest(allowed.state, { nowMs: 1_501, policy })).toEqual(
      expect.objectContaining({ allowed: false, reason: "half-open-saturated" }),
    );
    expect(
      recordCircuitOutcome(allowed.state, { nowMs: 1_550, outcome: "success", policy }),
    ).toEqual(expect.objectContaining({ state: "closed", events: [] }));
  });

  it("reopens immediately on half-open failure", () => {
    const halfOpen = {
      ...initialCircuitState(),
      state: "half-open" as const,
      halfOpenStartedAtMs: 1_500,
      halfOpenInFlight: 1,
    };

    expect(recordCircuitOutcome(halfOpen, { nowMs: 1_550, outcome: "failure", policy })).toEqual(
      expect.objectContaining({ state: "open", openedAtMs: 1_550, halfOpenInFlight: 0 }),
    );
  });

  it("prunes old events outside the rolling window", () => {
    let state = initialCircuitState();
    state = recordCircuitOutcome(state, { nowMs: 1_000, outcome: "failure", policy });
    state = recordCircuitOutcome(state, { nowMs: 2_001, outcome: "success", policy });
    expect(circuitStats(state, 2_001, policy.windowMs)).toEqual({
      total: 1,
      failures: 0,
      failureRate: 0,
    });
  });

  it("runs a stateful per-key allow, record, half-open, close, and reset flow", () => {
    let now = 1_000;
    const store = new MemoryCircuitBreakerStore({ now: () => now, policy });

    expect(store.allow("payments")).toEqual(expect.objectContaining({ allowed: true }));
    store.record("payments", "failure");
    now = 1_100;
    store.record("payments", "failure");
    now = 1_200;
    store.record("payments", "success");
    now = 1_300;
    expect(store.record("payments", "failure")).toEqual(expect.objectContaining({ state: "open" }));
    const leaked = store.get("payments");
    leaked.events[0]!.outcome = "success";
    expect(store.get("payments").events[0]?.outcome).toBe("failure");
    expect(store.get("search")).toEqual(initialCircuitState());
    expect(store.allow("payments")).toEqual(expect.objectContaining({ allowed: false }));

    now = 1_800;
    const probe = store.allow("payments");
    expect(probe).toEqual(expect.objectContaining({ allowed: true, reason: "half-open-probe" }));
    expect(store.record("payments", "success")).toEqual(
      expect.objectContaining({ state: "closed" }),
    );
    store.reset("payments");
    expect(store.get("payments")).toEqual(initialCircuitState());
  });
});
