import { describe, expect, it } from "vitest";
import {
  beginTransaction,
  commitTransaction,
  createSavepoint,
  createTransactionRegistry,
  expireTransactions,
  releaseSavepoint,
  rollbackToSavepoint,
  rollbackTransaction,
  transactionSnapshot,
} from "../src/mwh/modules/data-access/transaction-scope/core.js";
import { MemoryTransactionManager } from "../src/mwh/modules/data-access/transaction-scope/memory-transaction-manager.js";

describe("MWH transaction-scope stateless core", () => {
  it("begins a transaction and rejects a second active transaction on the same connection", () => {
    const started = beginTransaction(createTransactionRegistry(), {
      id: "tx-1",
      connectionId: "conn-1",
      ownerId: "request-1",
      nowMs: 1_000,
      timeoutMs: 500,
      isolationLevel: "serializable",
    });

    expect(started.transaction).toEqual(
      expect.objectContaining({
        id: "tx-1",
        connectionId: "conn-1",
        status: "active",
        expiresAtMs: 1_500,
        isolationLevel: "serializable",
      }),
    );
    expect(() =>
      beginTransaction(started.registry, {
        id: "tx-2",
        connectionId: "conn-1",
        ownerId: "request-2",
        nowMs: 1_010,
        timeoutMs: 500,
      }),
    ).toThrow("connection already has an active transaction");
  });

  it("handles savepoints, rollback-to-savepoint, release-savepoint, and commit", () => {
    let registry = beginTransaction(createTransactionRegistry(), {
      id: "tx-1",
      connectionId: "conn-1",
      ownerId: "request-1",
      nowMs: 1_000,
      timeoutMs: 1_000,
    }).registry;

    registry = createSavepoint(registry, {
      transactionId: "tx-1",
      name: "before_optional",
      nowMs: 1_010,
    }).registry;
    registry = createSavepoint(registry, {
      transactionId: "tx-1",
      name: "before_side_effect",
      nowMs: 1_020,
    }).registry;
    const rolledBack = rollbackToSavepoint(registry, {
      transactionId: "tx-1",
      name: "before_optional",
      nowMs: 1_030,
    });
    expect(rolledBack.transaction.savepoints.map((savepoint) => savepoint.name)).toEqual([
      "before_optional",
    ]);

    const released = releaseSavepoint(rolledBack.registry, {
      transactionId: "tx-1",
      name: "before_optional",
      nowMs: 1_040,
    });
    expect(released.transaction.savepoints).toEqual([]);

    const committed = commitTransaction(released.registry, {
      transactionId: "tx-1",
      nowMs: 1_050,
    });
    expect(committed.transaction.status).toBe("committed");
    expect(committed.transaction.events.map((event) => event.type)).toEqual([
      "begin",
      "savepoint",
      "savepoint",
      "rollback-to-savepoint",
      "release-savepoint",
      "commit",
    ]);
    expect(transactionSnapshot(committed.registry)).toEqual({
      total: 1,
      active: 0,
      committed: 1,
      rolledBack: 0,
      expired: 0,
    });
  });

  it("rolls back active transactions and expires abandoned transactions", () => {
    let registry = beginTransaction(createTransactionRegistry(), {
      id: "tx-1",
      connectionId: "conn-1",
      ownerId: "request-1",
      nowMs: 1_000,
      timeoutMs: 100,
    }).registry;
    registry = beginTransaction(registry, {
      id: "tx-2",
      connectionId: "conn-2",
      ownerId: "request-2",
      nowMs: 1_010,
      timeoutMs: 100,
    }).registry;

    const rolledBack = rollbackTransaction(registry, {
      transactionId: "tx-1",
      nowMs: 1_050,
      reason: "handler failed",
    });
    const expired = expireTransactions(rolledBack.registry, 1_110);

    expect(rolledBack.transaction.status).toBe("rolled-back");
    expect(expired.expired.map((transaction) => transaction.id)).toEqual(["tx-2"]);
    expect(transactionSnapshot(expired.registry)).toEqual({
      total: 2,
      active: 0,
      committed: 0,
      rolledBack: 1,
      expired: 1,
    });
  });
});

describe("MWH transaction-scope stateful memory manager", () => {
  it("commits, rolls back, and exposes clone-safe transaction reads", () => {
    let now = 1_000;
    const manager = new MemoryTransactionManager({ now: () => now });

    const tx1 = manager.begin({ connectionId: "conn-1", ownerId: "request-1" });
    manager.savepoint(tx1.id, "before_optional");
    now = 1_010;
    manager.commit(tx1.id);

    const tx2 = manager.begin({ connectionId: "conn-1", ownerId: "request-2" });
    manager.rollback(tx2.id, "handler failed");

    const transactions = manager.listTransactions();
    transactions[0]!.status = "active";
    expect(manager.listTransactions()[0]?.status).toBe("committed");
    expect(manager.snapshot()).toEqual({
      total: 2,
      active: 0,
      committed: 1,
      rolledBack: 1,
      expired: 0,
    });
  });

  it("expires active transactions and rejects commit after expiry", () => {
    let now = 1_000;
    const manager = new MemoryTransactionManager({ now: () => now, defaultTimeoutMs: 50 });
    const tx = manager.begin({ connectionId: "conn-1", ownerId: "request-1" });

    now = 1_050;
    expect(manager.expire().map((transaction) => transaction.id)).toEqual(["tx-1"]);
    expect(manager.snapshot().expired).toBe(1);
    expect(() => manager.commit(tx.id)).toThrow("transaction is not active");
  });

  it("runs scoped callbacks with automatic commit and rollback", async () => {
    const manager = new MemoryTransactionManager({ now: () => 1_000 });
    const value = await manager.runInTransaction({
      connectionId: "conn-1",
      ownerId: "request-1",
      run: (transaction) => `ok:${transaction.id}`,
    });
    expect(value).toBe("ok:tx-1");
    expect(manager.listTransactions()[0]).toEqual(
      expect.objectContaining({ id: "tx-1", status: "committed" }),
    );

    await expect(
      manager.runInTransaction({
        connectionId: "conn-1",
        ownerId: "request-2",
        run: () => {
          throw new Error("handler failed");
        },
      }),
    ).rejects.toThrow("handler failed");
    expect(manager.listTransactions()[1]).toEqual(
      expect.objectContaining({
        id: "tx-2",
        status: "rolled-back",
        events: expect.arrayContaining([
          expect.objectContaining({ type: "rollback", detail: "handler failed" }),
        ]),
      }),
    );
  });
});
