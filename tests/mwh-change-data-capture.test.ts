import { describe, expect, it } from "vitest";
import {
  ackCdcCursor,
  cdcEnvelope,
  cdcSnapshot,
  commitCdcBatch,
  createCdcBatch,
  createCdcChange,
  createCdcCursor,
  readCdcBatch,
} from "../src/mwh/modules/data-access/change-data-capture/core.js";
import { MemoryCdcLog } from "../src/mwh/modules/data-access/change-data-capture/memory-log.js";

describe("MWH change-data-capture middleware", () => {
  it("creates validated changes and maps them to envelopes", () => {
    const insert = createCdcChange({
      sequence: 1,
      table: "orders",
      primaryKey: "order-1",
      operation: "insert",
      after: { id: "order-1", status: "created" },
      occurredAtMs: 1_000,
    });
    const update = createCdcChange({
      sequence: 2,
      table: "orders",
      primaryKey: "order-1",
      operation: "update",
      before: { status: "created" },
      after: { status: "paid" },
      occurredAtMs: 1_100,
    });

    expect(cdcEnvelope(insert)).toEqual({
      id: "orders:order-1:1",
      topic: "cdc.orders",
      key: "order-1",
      change: insert,
    });
    expect(cdcEnvelope(update, { topicPrefix: "db" }).topic).toBe("db.orders");
    expect(() =>
      createCdcChange({
        sequence: 3,
        table: "orders",
        primaryKey: "order-2",
        operation: "insert",
        occurredAtMs: 1_200,
      }),
    ).toThrow("insert change requires after");
    expect(() =>
      createCdcChange({
        sequence: 4,
        table: "orders",
        primaryKey: "order-2",
        operation: "delete",
        occurredAtMs: 1_300,
      }),
    ).toThrow("delete change requires before");
  });

  it("reads ordered batches by cursor and rejects cursor rewind", () => {
    const changes = [
      createCdcChange({
        sequence: 2,
        table: "orders",
        primaryKey: "o2",
        operation: "insert",
        after: { id: "o2" },
        occurredAtMs: 1_200,
      }),
      createCdcChange({
        sequence: 1,
        table: "users",
        primaryKey: "u1",
        operation: "insert",
        after: { id: "u1" },
        occurredAtMs: 1_100,
      }),
      createCdcChange({
        sequence: 3,
        table: "orders",
        primaryKey: "o3",
        operation: "delete",
        before: { id: "o3" },
        occurredAtMs: 1_300,
      }),
    ];
    const cursor = createCdcCursor({ consumerId: "projection", nowMs: 1_000 });

    expect(
      readCdcBatch(changes, cursor, { limit: 2 }).map((event) => event.change.sequence),
    ).toEqual([1, 2]);
    expect(
      readCdcBatch(changes, cursor, { limit: 10, tables: ["orders"] }).map(
        (event) => event.change.sequence,
      ),
    ).toEqual([2, 3]);
    const acked = ackCdcCursor(cursor, { sequence: 2, nowMs: 1_500 });
    expect(acked).toEqual({
      consumerId: "projection",
      lastAckedSequence: 2,
      updatedAtMs: 1_500,
    });
    expect(() => ackCdcCursor(acked, { sequence: 1, nowMs: 1_600 })).toThrow(
      "cannot move CDC cursor backwards",
    );
  });

  it("creates batch metadata and commits batches with stale cursor protection", () => {
    const changes = [
      createCdcChange({
        sequence: 1,
        table: "orders",
        primaryKey: "o1",
        operation: "insert",
        after: { id: "o1" },
        occurredAtMs: 1_100,
      }),
      createCdcChange({
        sequence: 2,
        table: "orders",
        primaryKey: "o2",
        operation: "insert",
        after: { id: "o2" },
        occurredAtMs: 1_200,
      }),
    ];
    const cursor = createCdcCursor({ consumerId: "projection", nowMs: 1_000 });
    const batch = createCdcBatch(changes, cursor, { limit: 1 });

    expect(batch.envelopes.map((event) => event.change.sequence)).toEqual([1]);
    expect(batch.nextCursor).toEqual({
      consumerId: "projection",
      lastAckedSequence: 1,
      updatedAtMs: 1_000,
    });
    expect(batch.hasMore).toBe(true);
    expect(commitCdcBatch(cursor, batch, { nowMs: 1_300 })).toEqual({
      consumerId: "projection",
      lastAckedSequence: 1,
      updatedAtMs: 1_300,
    });
    expect(() =>
      commitCdcBatch(
        { consumerId: "projection", lastAckedSequence: 1, updatedAtMs: 1_200 },
        batch,
        { nowMs: 1_300 },
      ),
    ).toThrow("batch cursor is stale");
  });

  it("creates deterministic snapshots and keeps payloads clone-safe", () => {
    const change = createCdcChange({
      sequence: 1,
      table: "orders",
      primaryKey: "o1",
      operation: "insert",
      after: { nested: { value: 1 } },
      occurredAtMs: 1_000,
    });
    (change.after as { nested: { value: number } }).nested.value = 2;
    const original = createCdcChange({
      sequence: 2,
      table: "orders",
      primaryKey: "o2",
      operation: "insert",
      after: { nested: { value: 1 } },
      occurredAtMs: 1_100,
    });

    expect(
      cdcSnapshot([change, original], [createCdcCursor({ consumerId: "b", nowMs: 1_000 })]),
    ).toEqual({
      totalChanges: 2,
      minSequence: 1,
      maxSequence: 2,
      cursors: [{ consumerId: "b", lastAckedSequence: 0, updatedAtMs: 1_000 }],
    });
    expect(cdcEnvelope(original).change.after).toEqual({ nested: { value: 1 } });
  });

  it("runs stateful append, read, ack, table filtering, multiple consumers, and clone-safe flows", () => {
    let now = 1_000;
    const log = new MemoryCdcLog({ now: () => now });
    const first = log.append({
      table: "orders",
      primaryKey: "o1",
      operation: "insert",
      after: { id: "o1", status: "created" },
    });
    now = 1_100;
    log.append({
      table: "users",
      primaryKey: "u1",
      operation: "insert",
      after: { id: "u1" },
    });

    expect(
      log.read({ consumerId: "cache", limit: 10 }).map((event) => event.change.sequence),
    ).toEqual([1, 2]);
    expect(log.ack({ consumerId: "cache", sequence: first.sequence })).toEqual(
      expect.objectContaining({ consumerId: "cache", lastAckedSequence: 1 }),
    );
    expect(
      log.read({ consumerId: "cache", limit: 10 }).map((event) => event.change.sequence),
    ).toEqual([2]);
    expect(log.read({ consumerId: "search", limit: 10, tables: ["orders"] })).toEqual([
      expect.objectContaining({ topic: "cdc.orders" }),
    ]);
    expect(log.lag("cache")).toBe(1);
    expect(log.lag("search", ["orders"])).toBe(1);
    const batch = log.batch({ consumerId: "search", limit: 10, tables: ["orders"] });
    expect(batch.hasMore).toBe(false);
    expect(log.ackBatch(batch)).toEqual(
      expect.objectContaining({ consumerId: "search", lastAckedSequence: 1 }),
    );
    expect(log.lag("search", ["orders"])).toBe(0);

    const read = log.listChanges();
    (read[0]!.after as { status: string }).status = "mutated";
    expect(log.listChanges()[0]?.after).toEqual({ id: "o1", status: "created" });
    expect(log.snapshot()).toEqual(
      expect.objectContaining({
        totalChanges: 2,
        minSequence: 1,
        maxSequence: 2,
        cursors: expect.arrayContaining([
          expect.objectContaining({ consumerId: "cache", lastAckedSequence: 1 }),
          expect.objectContaining({ consumerId: "search", lastAckedSequence: 1 }),
        ]),
      }),
    );
  });
});
