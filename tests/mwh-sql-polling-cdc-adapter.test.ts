import { describe, expect, it } from "vitest";
import {
  type SqlPollingSource,
  advanceSqlPollingCheckpoint,
  buildSqlPollingPlan,
  commitSqlPollingBatch,
  createSqlPollingBatch,
  createSqlPollingCheckpoint,
  rowsToCdcChanges,
} from "../src/mwh/modules/data-access/sql-polling-cdc-adapter/core.js";
import { MemorySqlPollingCdcAdapter } from "../src/mwh/modules/data-access/sql-polling-cdc-adapter/memory-adapter.js";

const source: SqlPollingSource = {
  table: "orders",
  sourceTable: "orders_cdc",
  sequenceColumn: "sequence",
  primaryKeyColumn: "primary_key",
  operationColumn: "operation",
  occurredAtColumn: "occurred_at_ms",
  beforeColumn: "before_json",
  afterColumn: "after_json",
};

describe("MWH sql-polling-cdc-adapter middleware", () => {
  it("builds safe polling plans and rejects unsafe identifiers", () => {
    const checkpoint = createSqlPollingCheckpoint({
      consumerId: "cache",
      table: "orders",
      lastSequence: 7,
      nowMs: 1_000,
    });

    expect(buildSqlPollingPlan(source, checkpoint, { limit: 50 })).toEqual({
      sql: "select sequence, primary_key, operation, occurred_at_ms, before_json, after_json from orders_cdc where sequence > ? order by sequence asc limit ?",
      params: [7, 50],
    });
    expect(() =>
      buildSqlPollingPlan({ ...source, sourceTable: "orders;drop" }, checkpoint, { limit: 1 }),
    ).toThrow("sourceTable must be a safe SQL identifier");
    expect(() =>
      buildSqlPollingPlan(source, { ...checkpoint, table: "users" }, { limit: 1 }),
    ).toThrow("checkpoint table must match polling source table");
  });

  it("maps rows into sorted CDC changes and creates limited checkpoint batches", () => {
    const checkpoint = createSqlPollingCheckpoint({
      consumerId: "indexer",
      table: "orders",
      lastSequence: 1,
      nowMs: 1_000,
    });
    const rows = [
      {
        sequence: 3,
        primaryKey: "o3",
        operation: "delete" as const,
        before: { id: "o3" },
        occurredAtMs: 1_300,
      },
      {
        sequence: 2,
        primaryKey: "o2",
        operation: "insert" as const,
        after: { id: "o2" },
        occurredAtMs: 1_200,
      },
    ];

    expect(rowsToCdcChanges(source, rows).map((change) => change.sequence)).toEqual([2, 3]);
    expect(createSqlPollingBatch(source, checkpoint, rows, { limit: 1, nowMs: 1_500 })).toEqual({
      checkpoint,
      changes: [
        expect.objectContaining({
          sequence: 2,
          table: "orders",
          primaryKey: "o2",
          operation: "insert",
        }),
      ],
      nextCheckpoint: {
        consumerId: "indexer",
        table: "orders",
        lastSequence: 2,
        updatedAtMs: 1_500,
      },
      hasMore: true,
    });
    const batch = createSqlPollingBatch(source, checkpoint, rows, { limit: 2, nowMs: 1_500 });
    expect(commitSqlPollingBatch(checkpoint, batch)).toEqual({
      consumerId: "indexer",
      table: "orders",
      lastSequence: 3,
      updatedAtMs: 1_500,
    });
    expect(() =>
      commitSqlPollingBatch(
        { consumerId: "indexer", table: "orders", lastSequence: 0, updatedAtMs: 1_000 },
        batch,
      ),
    ).toThrow("batch checkpoint is stale");
    expect(() =>
      advanceSqlPollingCheckpoint(
        { consumerId: "indexer", table: "orders", lastSequence: 3, updatedAtMs: 1_000 },
        { sequence: 2, nowMs: 1_100 },
      ),
    ).toThrow("cannot move SQL polling checkpoint backwards");
  });

  it("runs stateful append, poll, ack, resume, multiple consumers, and clone-safe rows", () => {
    let now = 1_000;
    const adapter = new MemorySqlPollingCdcAdapter({ source, now: () => now });
    adapter.append({
      primaryKey: "o1",
      operation: "insert",
      after: { id: "o1", status: "created" },
    });
    now = 1_100;
    adapter.append({
      primaryKey: "o2",
      operation: "insert",
      after: { id: "o2", status: "created" },
    });

    const firstPoll = adapter.poll({ consumerId: "cache", limit: 1 });
    expect(firstPoll.changes.map((change) => change.primaryKey)).toEqual(["o1"]);
    expect(firstPoll.hasMore).toBe(true);
    expect(
      adapter.poll({ consumerId: "cache", limit: 10 }).changes.map((change) => change.primaryKey),
    ).toEqual(["o1", "o2"]);

    adapter.ack({ consumerId: "cache", sequence: firstPoll.nextCheckpoint!.lastSequence });
    expect(adapter.lag("cache")).toBe(1);
    expect(
      adapter.poll({ consumerId: "cache", limit: 10 }).changes.map((change) => change.primaryKey),
    ).toEqual(["o2"]);
    expect(
      adapter.poll({ consumerId: "search", limit: 10 }).changes.map((change) => change.primaryKey),
    ).toEqual(["o1", "o2"]);
    const searchBatch = adapter.poll({ consumerId: "search", limit: 10 });
    expect(adapter.ackBatch(searchBatch)).toEqual(
      expect.objectContaining({ consumerId: "search", lastSequence: 2 }),
    );
    expect(adapter.lag("search")).toBe(0);

    const rows = adapter.listRows();
    (rows[0]!.after as { status: string }).status = "mutated";
    expect(adapter.listRows()[0]?.after).toEqual({ id: "o1", status: "created" });
    expect(adapter.listCheckpoints()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ consumerId: "cache", lastSequence: 1 }),
        expect.objectContaining({ consumerId: "search", lastSequence: 2 }),
      ]),
    );
  });
});
