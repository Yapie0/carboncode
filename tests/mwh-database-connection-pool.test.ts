import { describe, expect, it } from "vitest";
import {
  acquireConnection,
  cancelPoolWaiter,
  createPoolState,
  expirePoolWaiters,
  poolSnapshot,
  pruneIdleConnections,
  reapLeasedConnections,
  releaseConnection,
  resizePool,
} from "../src/mwh/modules/data-access/database-connection-pool/core.js";
import { MemoryConnectionPool } from "../src/mwh/modules/data-access/database-connection-pool/memory-pool.js";

describe("MWH database-connection-pool stateless core", () => {
  it("leases new connections and queues when the pool is saturated", () => {
    let state = createPoolState({ maxSize: 1 });
    const first = acquireConnection(state, {
      requesterId: "request-a",
      requestId: "req-a",
      connectionId: "conn-a",
      nowMs: 1_000,
      waitTimeoutMs: 500,
    });
    expect(first.kind).toBe("leased");
    if (first.kind !== "leased") throw new Error("expected leased connection");
    expect(first.connection).toEqual(
      expect.objectContaining({
        id: "conn-a",
        status: "leased",
        leasedBy: "request-a",
        useCount: 1,
      }),
    );

    state = first.state;
    const second = acquireConnection(state, {
      requesterId: "request-b",
      requestId: "req-b",
      connectionId: "conn-b",
      nowMs: 1_010,
      waitTimeoutMs: 500,
    });
    expect(second.kind).toBe("queued");
    if (second.kind !== "queued") throw new Error("expected queued request");
    expect(second.waiter).toEqual({
      id: "req-b",
      requesterId: "request-b",
      requestedAtMs: 1_010,
      expiresAtMs: 1_510,
    });
    expect(poolSnapshot(second.state)).toEqual({
      maxSize: 1,
      totalConnections: 1,
      idleConnections: 0,
      leasedConnections: 1,
      waitingRequests: 1,
    });
  });

  it("assigns the oldest waiter when a leased connection is released", () => {
    let state = createPoolState({ maxSize: 1 });
    const leased = acquireConnection(state, {
      requesterId: "request-a",
      requestId: "req-a",
      connectionId: "conn-a",
      nowMs: 1_000,
      waitTimeoutMs: 500,
    });
    if (leased.kind !== "leased") throw new Error("expected leased connection");
    state = leased.state;
    const queued = acquireConnection(state, {
      requesterId: "request-b",
      requestId: "req-b",
      nowMs: 1_010,
      waitTimeoutMs: 500,
    });
    if (queued.kind !== "queued") throw new Error("expected queued request");

    const released = releaseConnection(queued.state, { connectionId: "conn-a", nowMs: 1_020 });

    expect(released.assigned).toEqual({
      waiter: {
        id: "req-b",
        requesterId: "request-b",
        requestedAtMs: 1_010,
        expiresAtMs: 1_510,
      },
      connection: expect.objectContaining({
        id: "conn-a",
        status: "leased",
        leasedBy: "request-b",
        useCount: 2,
      }),
    });
    expect(poolSnapshot(released.state)).toEqual({
      maxSize: 1,
      totalConnections: 1,
      idleConnections: 0,
      leasedConnections: 1,
      waitingRequests: 0,
    });
  });

  it("expires waiters and prunes idle connections deterministically", () => {
    let state = createPoolState({ maxSize: 2 });
    const leased = acquireConnection(state, {
      requesterId: "request-a",
      requestId: "req-a",
      connectionId: "conn-a",
      nowMs: 1_000,
      waitTimeoutMs: 100,
    });
    if (leased.kind !== "leased") throw new Error("expected leased connection");
    state = releaseConnection(leased.state, { connectionId: "conn-a", nowMs: 1_050 }).state;
    const queuedState = {
      ...state,
      waiters: [
        {
          id: "req-b",
          requesterId: "request-b",
          requestedAtMs: 1_050,
          expiresAtMs: 1_100,
        },
      ],
    };

    const expired = expirePoolWaiters(queuedState, 1_100);
    expect(expired.expired.map((waiter) => waiter.id)).toEqual(["req-b"]);
    const pruned = pruneIdleConnections(expired.state, { nowMs: 1_200, idleTtlMs: 100 });
    expect(pruned.closed.map((connection) => connection.id)).toEqual(["conn-a"]);
    expect(poolSnapshot(pruned.state)).toEqual({
      maxSize: 2,
      totalConnections: 0,
      idleConnections: 0,
      leasedConnections: 0,
      waitingRequests: 0,
    });
  });

  it("cancels waiters, resizes idle capacity, and reaps leaked leases", () => {
    let state = createPoolState({ maxSize: 2 });
    const first = acquireConnection(state, {
      requesterId: "request-a",
      requestId: "req-a",
      connectionId: "conn-a",
      nowMs: 1_000,
      waitTimeoutMs: 500,
    });
    if (first.kind !== "leased") throw new Error("expected leased connection");
    state = first.state;
    const second = acquireConnection(state, {
      requesterId: "request-b",
      requestId: "req-b",
      connectionId: "conn-b",
      nowMs: 1_000,
      waitTimeoutMs: 500,
    });
    if (second.kind !== "leased") throw new Error("expected leased connection");
    state = second.state;
    const queued = acquireConnection(state, {
      requesterId: "request-c",
      requestId: "req-c",
      nowMs: 1_010,
      waitTimeoutMs: 500,
    });
    if (queued.kind !== "queued") throw new Error("expected queued request");

    const cancelled = cancelPoolWaiter(queued.state, "req-c");
    expect(cancelled.cancelled?.requesterId).toBe("request-c");
    state = releaseConnection(cancelled.state, { connectionId: "conn-a", nowMs: 1_020 }).state;
    const resized = resizePool(state, 1);
    expect(resized.closed.map((connection) => connection.id)).toEqual(["conn-a"]);
    expect(resized.state.maxSize).toBe(1);
    expect(() => resizePool(resized.state, 0)).toThrow("maxSize must be a positive integer");
    const reaped = reapLeasedConnections(resized.state, { nowMs: 2_000, leaseTimeoutMs: 500 });
    expect(reaped.reaped.map((connection) => connection.id)).toEqual(["conn-b"]);
    expect(poolSnapshot(reaped.state).totalConnections).toBe(0);
  });
});

describe("MWH database-connection-pool stateful memory pool", () => {
  it("tracks saturation, releases to queued requests, and keeps clone-safe reads", () => {
    let now = 1_000;
    const pool = new MemoryConnectionPool({ maxSize: 1, now: () => now });

    const first = pool.acquire({ requesterId: "request-a", requestId: "req-a" });
    expect(first.kind).toBe("leased");
    const second = pool.acquire({ requesterId: "request-b", requestId: "req-b" });
    expect(second.kind).toBe("queued");
    expect(pool.snapshot().waitingRequests).toBe(1);

    const connections = pool.listConnections();
    connections[0]!.status = "idle";
    expect(pool.listConnections()[0]?.status).toBe("leased");

    now = 1_100;
    const released = pool.release("conn-1");
    expect(released.assigned?.connection).toEqual(
      expect.objectContaining({ id: "conn-1", leasedBy: "request-b", useCount: 2 }),
    );
    expect(pool.snapshot()).toEqual({
      maxSize: 1,
      totalConnections: 1,
      idleConnections: 0,
      leasedConnections: 1,
      waitingRequests: 0,
    });
  });

  it("expires queued requests and prunes idle connections", () => {
    let now = 1_000;
    const pool = new MemoryConnectionPool({
      maxSize: 1,
      now: () => now,
      defaultWaitTimeoutMs: 50,
      idleTtlMs: 100,
    });
    const first = pool.acquire({ requesterId: "request-a" });
    if (first.kind !== "leased") throw new Error("expected leased connection");
    pool.acquire({ requesterId: "request-b", requestId: "req-b" });

    now = 1_060;
    expect(pool.expireWaiters().map((waiter) => waiter.id)).toEqual(["req-b"]);
    pool.release(first.connection.id);
    expect(pool.snapshot().idleConnections).toBe(1);

    now = 1_200;
    expect(pool.pruneIdle().map((connection) => connection.id)).toEqual(["conn-1"]);
    expect(pool.snapshot().totalConnections).toBe(0);
  });

  it("cancels waiters, resizes idle connections, and reaps leaked leases statefully", () => {
    let now = 1_000;
    const pool = new MemoryConnectionPool({ maxSize: 2, now: () => now });
    const first = pool.acquire({ requesterId: "request-a" });
    const second = pool.acquire({ requesterId: "request-b" });
    if (first.kind !== "leased" || second.kind !== "leased") throw new Error("expected leases");
    pool.acquire({ requesterId: "request-c", requestId: "req-c" });

    expect(pool.cancelWaiter("req-c")?.requesterId).toBe("request-c");
    pool.release(first.connection.id);
    expect(pool.resize(1).map((connection) => connection.id)).toEqual(["conn-1"]);
    now = 2_000;
    expect(pool.reapLeased(500).map((connection) => connection.id)).toEqual(["conn-2"]);
    expect(pool.snapshot()).toEqual({
      maxSize: 1,
      totalConnections: 0,
      idleConnections: 0,
      leasedConnections: 0,
      waitingRequests: 0,
    });
  });
});
