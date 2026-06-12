import { describe, expect, it } from "vitest";
import {
  admitBulkheadRequest,
  bulkheadSnapshot,
  cloneBulkheadState,
  createBulkheadPolicy,
  createBulkheadState,
  drainBulkheadState,
  pruneTimedOutQueued,
  releaseBulkheadRequest,
} from "../src/mwh/modules/service-governance/bulkhead-isolation/core.js";
import { MemoryBulkheadManager } from "../src/mwh/modules/service-governance/bulkhead-isolation/memory-bulkhead.js";

describe("MWH bulkhead-isolation middleware", () => {
  it("validates policies and admits running, queued, and rejected requests", () => {
    const policy = createBulkheadPolicy({
      scope: "tenant:t1:payments",
      maxConcurrent: 1,
      maxQueue: 1,
      queueTimeoutMs: 500,
    });
    let state = createBulkheadState(policy);

    const first = admitBulkheadRequest(state, { requestId: "r1", nowMs: 1_000 });
    state = first.state;
    expect(first.request).toEqual(
      expect.objectContaining({ id: "r1", status: "running", startedAtMs: 1_000 }),
    );

    const second = admitBulkheadRequest(state, { requestId: "r2", nowMs: 1_100 });
    state = second.state;
    expect(second.request).toEqual(expect.objectContaining({ id: "r2", status: "queued" }));

    const third = admitBulkheadRequest(state, { requestId: "r3", nowMs: 1_200 });
    state = third.state;
    expect(third.request).toEqual(
      expect.objectContaining({
        id: "r3",
        status: "rejected",
        reason: "bulkhead queue full",
      }),
    );
    expect(bulkheadSnapshot(state)).toEqual({
      scope: "tenant:t1:payments",
      maxConcurrent: 1,
      maxQueue: 1,
      running: 1,
      queued: 1,
      rejected: 1,
      completed: 0,
    });
    expect(() => admitBulkheadRequest(state, { requestId: "r1", nowMs: 1_300 })).toThrow(
      "duplicate bulkhead request id",
    );
  });

  it("releases running requests and promotes queued requests in FIFO order", () => {
    const policy = createBulkheadPolicy({
      scope: "api",
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeoutMs: 1_000,
    });
    let state = createBulkheadState(policy);
    state = admitBulkheadRequest(state, { requestId: "r1", nowMs: 1_000 }).state;
    state = admitBulkheadRequest(state, { requestId: "r2", nowMs: 1_100 }).state;
    state = admitBulkheadRequest(state, { requestId: "r3", nowMs: 1_200 }).state;

    const release = releaseBulkheadRequest(state, { requestId: "r1", nowMs: 1_300 });
    expect(release.completed).toEqual(
      expect.objectContaining({ id: "r1", status: "completed", completedAtMs: 1_300 }),
    );
    expect(release.promoted).toEqual(
      expect.objectContaining({ id: "r2", status: "running", startedAtMs: 1_300 }),
    );
    expect(release.state.running.map((request) => request.id)).toEqual(["r2"]);
    expect(release.state.queued.map((request) => request.id)).toEqual(["r3"]);
    expect(releaseBulkheadRequest(release.state, { requestId: "missing", nowMs: 1_400 })).toEqual(
      expect.objectContaining({ completed: null, promoted: null }),
    );
  });

  it("prunes timed-out queued requests and keeps state clone-safe", () => {
    const policy = createBulkheadPolicy({
      scope: "api",
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeoutMs: 500,
    });
    let state = createBulkheadState(policy);
    state = admitBulkheadRequest(state, { requestId: "r1", nowMs: 1_000 }).state;
    state = admitBulkheadRequest(state, { requestId: "r2", nowMs: 1_100 }).state;
    const cloned = cloneBulkheadState(state);
    cloned.queued[0]!.reason = "mutated";

    const pruned = pruneTimedOutQueued(state, { nowMs: 1_600 });
    expect(pruned.timedOut).toEqual([
      expect.objectContaining({
        id: "r2",
        status: "timed-out",
        completedAtMs: 1_600,
        reason: "bulkhead queue timeout",
      }),
    ]);
    expect(pruned.state.queued).toEqual([]);
    expect(pruned.state.completed.map((request) => request.id)).toEqual(["r2"]);
  });

  it("drains queued requests and optionally running requests for shutdown", () => {
    const policy = createBulkheadPolicy({
      scope: "api",
      maxConcurrent: 1,
      maxQueue: 2,
      queueTimeoutMs: 500,
    });
    let state = createBulkheadState(policy);
    state = admitBulkheadRequest(state, { requestId: "r1", nowMs: 1_000 }).state;
    state = admitBulkheadRequest(state, { requestId: "r2", nowMs: 1_100 }).state;
    state = admitBulkheadRequest(state, { requestId: "r3", nowMs: 1_200 }).state;

    const queuedOnly = drainBulkheadState(state, { nowMs: 1_300, reason: "deploy" });
    expect(queuedOnly.drained.map((request) => request.id)).toEqual(["r2", "r3"]);
    expect(queuedOnly.state.running.map((request) => request.id)).toEqual(["r1"]);
    expect(queuedOnly.state.rejected.map((request) => request.id)).toEqual(["r2", "r3"]);

    const all = drainBulkheadState(state, {
      nowMs: 1_400,
      reason: "shutdown",
      includeRunning: true,
    });
    expect(all.drained.map((request) => `${request.id}:${request.status}`)).toEqual([
      "r2:rejected",
      "r3:rejected",
      "r1:completed",
    ]);
    expect(all.state.running).toEqual([]);
    expect(all.state.completed.map((request) => request.id)).toEqual(["r1"]);
  });

  it("runs stateful multi-scope admission, release, prune, snapshots, and events", () => {
    let now = 1_000;
    const manager = new MemoryBulkheadManager({ now: () => now });
    manager.definePolicy({ scope: "api", maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 200 });
    manager.definePolicy({ scope: "worker", maxConcurrent: 2, maxQueue: 0, queueTimeoutMs: 200 });

    expect(manager.admit("missing", "x")).toBeNull();
    expect(manager.admit("api", "a1")?.request.status).toBe("running");
    now = 1_050;
    expect(manager.admit("api", "a2")?.request.status).toBe("queued");
    now = 1_100;
    expect(manager.admit("api", "a3")?.request.status).toBe("rejected");
    expect(manager.admit("worker", "w1")?.request.status).toBe("running");
    expect(manager.snapshots()).toEqual([
      expect.objectContaining({ scope: "api", running: 1, queued: 1, rejected: 1 }),
      expect.objectContaining({ scope: "worker", running: 1, queued: 0, rejected: 0 }),
    ]);

    now = 1_150;
    const release = manager.release("api", "a1");
    expect(release?.completed).toEqual(expect.objectContaining({ id: "a1", status: "completed" }));
    expect(release?.promoted).toEqual(expect.objectContaining({ id: "a2", status: "running" }));
    expect(manager.release("missing", "a1")).toBeNull();

    now = 1_500;
    expect(manager.prune("api")?.timedOut).toEqual([]);
    expect(manager.prune("missing")).toBeNull();
    expect(manager.drain("api", { includeRunning: true, reason: "shutdown" })?.drained).toEqual([
      expect.objectContaining({ id: "a2", status: "completed" }),
    ]);
    expect(manager.drain("missing")).toBeNull();
    expect(manager.listEvents().map((event) => event.type)).toEqual([
      "policy-defined",
      "policy-defined",
      "running",
      "queued",
      "rejected",
      "running",
      "completed",
      "promoted",
      "drained-running",
    ]);
  });
});
