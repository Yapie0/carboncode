import { describe, expect, it } from "vitest";
import {
  type DatabaseNode,
  createWriteAffinity,
  inferQueryIntent,
  isWriteAffinityActive,
  routeQuery,
  splitterSnapshot,
  updateNodeStatus,
} from "../src/mwh/modules/data-access/read-write-splitter/core.js";
import { MemoryReadWriteSplitter } from "../src/mwh/modules/data-access/read-write-splitter/memory-splitter.js";

const nodes: DatabaseNode[] = [
  { id: "primary", role: "primary", status: "healthy", replicaLagMs: 0, weight: 1 },
  { id: "replica-a", role: "replica", status: "healthy", replicaLagMs: 20, weight: 1 },
  { id: "replica-b", role: "replica", status: "healthy", replicaLagMs: 40, weight: 1 },
];

describe("MWH read-write-splitter stateless core", () => {
  it("infers query intent conservatively and routes writes/transactions to primary", () => {
    expect(inferQueryIntent({ sql: "select * from users" })).toBe("read");
    expect(inferQueryIntent({ sql: "WITH recent AS (select 1) select * from recent" })).toBe(
      "read",
    );
    expect(inferQueryIntent({ sql: "update users set name = ?" })).toBe("write");
    expect(inferQueryIntent({ transactionId: "tx-1", sql: "select * from users" })).toBe(
      "transaction",
    );

    expect(
      routeQuery(
        nodes,
        { id: "q1", intent: "write" },
        { maxReplicaLagMs: 100, allowPrimaryReads: true },
      ),
    ).toEqual({
      requestId: "q1",
      intent: "write",
      nodeId: "primary",
      role: "primary",
      reason: "write queries use primary",
    });
    expect(
      routeQuery(
        nodes,
        { id: "q2", transactionId: "tx-1", sql: "select * from users" },
        { maxReplicaLagMs: 100, allowPrimaryReads: true },
      ).nodeId,
    ).toBe("primary");
  });

  it("routes reads to healthy replicas and filters by replica lag", () => {
    expect(
      routeQuery(
        nodes,
        { id: "q1", sql: "select * from users" },
        { maxReplicaLagMs: 100, allowPrimaryReads: true },
        { replicaCursor: 1 },
      ),
    ).toEqual({
      requestId: "q1",
      intent: "read",
      nodeId: "replica-b",
      role: "replica",
      reason: "healthy replica selected",
    });

    const degraded = updateNodeStatus(nodes, {
      nodeId: "replica-a",
      status: "healthy",
      replicaLagMs: 500,
    });
    expect(
      routeQuery(
        degraded,
        { id: "q2", sql: "select * from users" },
        { maxReplicaLagMs: 100, allowPrimaryReads: true },
      ).nodeId,
    ).toBe("replica-b");
  });

  it("falls back to primary for fresh reads and reports node snapshots", () => {
    const noReplica = nodes.map((node) =>
      node.role === "replica" ? { ...node, status: "down" as const } : node,
    );
    expect(
      routeQuery(
        nodes,
        { id: "q1", sql: "select * from users", requireFreshRead: true },
        { maxReplicaLagMs: 100, allowPrimaryReads: true },
      ).reason,
    ).toBe("fresh read requires primary");
    expect(
      routeQuery(
        noReplica,
        { id: "q2", sql: "select * from users" },
        { maxReplicaLagMs: 100, allowPrimaryReads: true },
      ).reason,
    ).toBe("no healthy replica available; primary read fallback");
    expect(() =>
      routeQuery(
        noReplica,
        { id: "q3", sql: "select * from users" },
        { maxReplicaLagMs: 100, allowPrimaryReads: false },
      ),
    ).toThrow("no healthy replica available");
    expect(splitterSnapshot(noReplica)).toEqual({
      totalNodes: 3,
      healthyPrimaries: 1,
      healthyReplicas: 0,
      degradedNodes: 0,
      downNodes: 2,
    });
  });

  it("models write affinity windows for read-your-writes routing", () => {
    const affinity = createWriteAffinity({ key: "user:u1", writtenAtMs: 1_000, ttlMs: 500 });
    expect(affinity).toEqual({ key: "user:u1", writtenAtMs: 1_000, expiresAtMs: 1_500 });
    expect(isWriteAffinityActive(affinity, 1_499)).toBe(true);
    expect(isWriteAffinityActive(affinity, 1_500)).toBe(false);
  });
});

describe("MWH read-write-splitter stateful memory splitter", () => {
  it("round-robins healthy replicas, records history, and keeps clone-safe reads", () => {
    const splitter = new MemoryReadWriteSplitter({
      nodes,
      policy: { maxReplicaLagMs: 100, allowPrimaryReads: true },
    });

    expect(splitter.route({ id: "q1", sql: "select * from users" }).nodeId).toBe("replica-a");
    expect(splitter.route({ id: "q2", sql: "select * from users" }).nodeId).toBe("replica-b");
    expect(splitter.route({ id: "q3", sql: "insert into users values (?)" }).nodeId).toBe(
      "primary",
    );
    expect(splitter.listHistory().map((decision) => decision.requestId)).toEqual([
      "q1",
      "q2",
      "q3",
    ]);

    const listedNodes = splitter.listNodes();
    listedNodes[1]!.status = "down";
    expect(splitter.listNodes()[1]?.status).toBe("healthy");
  });

  it("updates node health and falls back to primary when replicas are unavailable", () => {
    const splitter = new MemoryReadWriteSplitter({
      nodes,
      policy: { maxReplicaLagMs: 100, allowPrimaryReads: true },
    });

    splitter.updateNode({ nodeId: "replica-a", status: "down" });
    splitter.updateNode({ nodeId: "replica-b", status: "healthy", replicaLagMs: 200 });
    expect(splitter.route({ id: "q1", sql: "select * from users" })).toEqual({
      requestId: "q1",
      intent: "read",
      nodeId: "primary",
      role: "primary",
      reason: "no healthy replica available; primary read fallback",
    });
    expect(splitter.snapshot()).toEqual({
      totalNodes: 3,
      healthyPrimaries: 1,
      healthyReplicas: 1,
      degradedNodes: 0,
      downNodes: 1,
    });
  });

  it("pins reads to primary after writes and releases affinity after TTL", () => {
    let now = 1_000;
    const splitter = new MemoryReadWriteSplitter({
      nodes,
      now: () => now,
      readYourWritesTtlMs: 100,
      policy: { maxReplicaLagMs: 100, allowPrimaryReads: true },
    });

    expect(splitter.route({ id: "q1", sql: "select * from users", subject: "user:u1" }).role).toBe(
      "replica",
    );
    expect(splitter.recordWrite({ key: "user:u1" })).toEqual({
      key: "user:u1",
      writtenAtMs: 1_000,
      expiresAtMs: 1_100,
    });
    expect(splitter.route({ id: "q2", sql: "select * from users", subject: "user:u1" })).toEqual(
      expect.objectContaining({
        nodeId: "primary",
        reason: "read-your-writes requires primary",
      }),
    );
    expect(splitter.listWriteAffinities()).toHaveLength(1);
    now = 1_100;
    expect(splitter.listWriteAffinities()).toEqual([]);
    expect(splitter.route({ id: "q3", sql: "select * from users", subject: "user:u1" }).role).toBe(
      "replica",
    );
  });

  it("tracks explicit transaction lifecycles and exposes active transaction ids", () => {
    const splitter = new MemoryReadWriteSplitter({
      nodes,
      policy: { maxReplicaLagMs: 100, allowPrimaryReads: true },
    });

    splitter.beginTransaction("tx-1");
    expect(splitter.listTransactions()).toEqual(["tx-1"]);
    expect(splitter.route({ id: "q1", sql: "select * from users", transactionId: "tx-1" })).toEqual(
      expect.objectContaining({ nodeId: "primary", intent: "transaction" }),
    );
    expect(splitter.endTransaction("tx-1")).toBe(true);
    expect(splitter.listTransactions()).toEqual([]);
    expect(splitter.endTransaction("tx-1")).toBe(false);
  });
});
