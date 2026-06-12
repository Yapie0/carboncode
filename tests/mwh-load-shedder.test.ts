import { describe, expect, it } from "vitest";
import {
  cloneLoadSheddingState,
  createLoadSheddingPolicy,
  createLoadSheddingState,
  evaluateLoadShedding,
  loadSheddingSnapshot,
  previewLoadShedding,
  retryAfterForLoadShedding,
  rollLoadSheddingWindow,
} from "../src/mwh/modules/service-governance/load-shedder/core.js";
import { MemoryLoadShedder } from "../src/mwh/modules/service-governance/load-shedder/memory-shedder.js";

describe("MWH load-shedder middleware", () => {
  it("validates policies and accepts requests while capacity remains", () => {
    const policy = createLoadSheddingPolicy({
      scope: "api:search",
      windowMs: 1_000,
      maxRequests: 2,
      minPriority: 10,
      priorityOverrideAt: 90,
      retryAfterMs: 250,
    });
    let state = createLoadSheddingState(policy, { nowMs: 1_050 });

    expect(state.window.windowStartMs).toBe(1_000);
    const first = evaluateLoadShedding(state, {
      id: "r1",
      scope: "api:search",
      priority: 20,
      nowMs: 1_100,
    });
    state = first.state;
    const second = evaluateLoadShedding(state, {
      id: "r2",
      scope: "api:search",
      priority: 20,
      nowMs: 1_200,
    });

    expect(first.decision).toEqual(
      expect.objectContaining({ accepted: true, reason: "capacity-available" }),
    );
    expect(second.decision).toEqual(
      expect.objectContaining({ accepted: true, reason: "capacity-available" }),
    );
    expect(loadSheddingSnapshot(second.state)).toEqual({
      scope: "api:search",
      windowStartMs: 1_000,
      accepted: 2,
      dropped: 0,
      capacityRemaining: 0,
    });
  });

  it("drops low-priority and over-capacity requests with retry-after hints", () => {
    const policy = createLoadSheddingPolicy({
      scope: "api",
      windowMs: 1_000,
      maxRequests: 1,
      minPriority: 10,
      retryAfterMs: 300,
    });
    let state = createLoadSheddingState(policy, { nowMs: 1_000 });

    const low = evaluateLoadShedding(state, {
      id: "low",
      scope: "api",
      priority: 1,
      nowMs: 1_010,
    });
    state = low.state;
    const accepted = evaluateLoadShedding(state, {
      id: "ok",
      scope: "api",
      priority: 10,
      nowMs: 1_020,
    });
    state = accepted.state;
    const overloaded = evaluateLoadShedding(state, {
      id: "over",
      scope: "api",
      priority: 10,
      nowMs: 1_030,
    });

    expect(low.decision).toEqual(
      expect.objectContaining({ accepted: false, reason: "min-priority", retryAfterMs: 300 }),
    );
    expect(overloaded.decision).toEqual(
      expect.objectContaining({
        accepted: false,
        reason: "capacity-exhausted",
        retryAfterMs: 300,
      }),
    );
    expect(overloaded.state.window).toEqual({ windowStartMs: 1_000, accepted: 1, dropped: 2 });
  });

  it("previews shedding decisions without mutating counters and computes retry-after by window", () => {
    const policy = createLoadSheddingPolicy({
      scope: "api",
      windowMs: 1_000,
      maxRequests: 1,
      retryAfterMs: 900,
    });
    let state = createLoadSheddingState(policy, { nowMs: 1_000 });
    state = evaluateLoadShedding(state, {
      id: "r1",
      scope: "api",
      priority: 0,
      nowMs: 1_100,
    }).state;

    const preview = previewLoadShedding(state, {
      id: "r2",
      scope: "api",
      priority: 0,
      nowMs: 1_750,
    });
    expect(preview.decision).toEqual(
      expect.objectContaining({
        accepted: false,
        reason: "capacity-exhausted",
        retryAfterMs: 250,
      }),
    );
    expect(preview.state.window).toEqual({ windowStartMs: 1_000, accepted: 1, dropped: 0 });
    expect(retryAfterForLoadShedding(state, 1_999)).toBe(1);
  });

  it("allows priority override and rolls windows deterministically", () => {
    const policy = createLoadSheddingPolicy({
      scope: "api",
      windowMs: 1_000,
      maxRequests: 1,
      priorityOverrideAt: 90,
    });
    let state = createLoadSheddingState(policy, { nowMs: 1_000 });
    state = evaluateLoadShedding(state, {
      id: "r1",
      scope: "api",
      priority: 10,
      nowMs: 1_010,
    }).state;

    const override = evaluateLoadShedding(state, {
      id: "vip",
      scope: "api",
      priority: 100,
      nowMs: 1_020,
    });
    expect(override.decision).toEqual(
      expect.objectContaining({ accepted: true, reason: "priority-override" }),
    );
    expect(override.state.window.accepted).toBe(2);

    const rolled = rollLoadSheddingWindow(override.state, { nowMs: 2_000 });
    expect(rolled.window).toEqual({ windowStartMs: 2_000, accepted: 0, dropped: 0 });

    const cloned = cloneLoadSheddingState(rolled);
    cloned.window.accepted = 99;
    expect(rolled.window.accepted).toBe(0);
  });

  it("runs stateful multi-scope decisions, snapshots, history, missing policy, and clone safety", () => {
    let now = 1_000;
    const shedder = new MemoryLoadShedder({ now: () => now });
    shedder.definePolicy({ scope: "api", windowMs: 1_000, maxRequests: 1, minPriority: 10 });
    shedder.definePolicy({ scope: "worker", windowMs: 500, maxRequests: 2 });

    expect(shedder.decide({ scope: "missing", requestId: "x", priority: 10 })).toBeNull();
    expect(shedder.decide({ scope: "api", requestId: "a1", priority: 10 })).toEqual(
      expect.objectContaining({ accepted: true }),
    );
    expect(shedder.preview({ scope: "api", requestId: "preview", priority: 10 })).toEqual(
      expect.objectContaining({ accepted: false, reason: "capacity-exhausted" }),
    );
    expect(shedder.decide({ scope: "api", requestId: "a2", priority: 10 })).toEqual(
      expect.objectContaining({ accepted: false, reason: "capacity-exhausted" }),
    );
    expect(shedder.decide({ scope: "worker", requestId: "w1", priority: 0 })).toEqual(
      expect.objectContaining({ accepted: true }),
    );

    expect(shedder.snapshots()).toEqual([
      expect.objectContaining({ scope: "api", accepted: 1, dropped: 1 }),
      expect.objectContaining({ scope: "worker", accepted: 1, dropped: 0 }),
    ]);
    now = 2_000;
    expect(shedder.roll("api")).toEqual(
      expect.objectContaining({ window: { windowStartMs: 2_000, accepted: 0, dropped: 0 } }),
    );
    shedder.updatePolicy({ scope: "api", windowMs: 1_000, maxRequests: 2, minPriority: 0 });
    expect(shedder.getState("api")?.policy.maxRequests).toBe(2);
    expect(shedder.roll("missing")).toBeNull();

    const state = shedder.getState("api");
    if (!state) throw new Error("state missing");
    state.window.accepted = 99;
    expect(shedder.getState("api")?.window.accepted).toBe(0);
    expect(shedder.listDecisions().map((decision) => decision.requestId)).toEqual([
      "a1",
      "a2",
      "w1",
    ]);
  });
});
