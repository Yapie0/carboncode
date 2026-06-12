import { describe, expect, it } from "vitest";
import {
  type SchemaMigration,
  acquireMigrationLock,
  createMigrationState,
  markMigrationApplied,
  markMigrationFailed,
  migrationSnapshot,
  planMigrations,
  releaseMigrationLock,
} from "../src/mwh/modules/data-access/schema-migration-runner/core.js";
import { MemorySchemaMigrationRunner } from "../src/mwh/modules/data-access/schema-migration-runner/memory-runner.js";

const migrations: SchemaMigration[] = [
  { id: "001_create_users", checksum: "sha256:a", description: "create users" },
  { id: "002_add_email", checksum: "sha256:b", description: "add email" },
];

describe("MWH schema-migration-runner stateless core", () => {
  it("acquires migration locks, rejects contention, and allows acquisition after expiry", () => {
    let state = createMigrationState();
    const first = acquireMigrationLock(state, { ownerId: "runner-a", nowMs: 1_000, ttlMs: 100 });
    expect(first.acquired).toBe(true);
    expect(first.lock).toEqual({
      ownerId: "runner-a",
      acquiredAtMs: 1_000,
      expiresAtMs: 1_100,
      fencingToken: 1,
    });

    state = first.state;
    const contested = acquireMigrationLock(state, {
      ownerId: "runner-b",
      nowMs: 1_050,
      ttlMs: 100,
    });
    expect(contested.acquired).toBe(false);
    expect(contested.lock.ownerId).toBe("runner-a");

    const afterExpiry = acquireMigrationLock(state, {
      ownerId: "runner-b",
      nowMs: 1_100,
      ttlMs: 100,
    });
    expect(afterExpiry.acquired).toBe(true);
    expect(afterExpiry.lock).toEqual(
      expect.objectContaining({ ownerId: "runner-b", fencingToken: 2 }),
    );
  });

  it("plans, applies, releases, and detects checksum mismatch", () => {
    let state = createMigrationState();
    state = acquireMigrationLock(state, { ownerId: "runner-a", nowMs: 1_000, ttlMs: 500 }).state;
    expect(planMigrations(state, migrations).pending.map((migration) => migration.id)).toEqual([
      "001_create_users",
      "002_add_email",
    ]);

    state = markMigrationApplied(state, {
      migration: migrations[0]!,
      runnerId: "runner-a",
      nowMs: 1_010,
    });
    expect(planMigrations(state, migrations).pending.map((migration) => migration.id)).toEqual([
      "002_add_email",
    ]);
    expect(() =>
      planMigrations(state, [
        { id: "001_create_users", checksum: "sha256:changed", description: "changed" },
      ]),
    ).toThrow("checksum mismatch");

    state = releaseMigrationLock(state, { ownerId: "runner-a" });
    expect(state.lock).toBeUndefined();
  });

  it("records failed migrations and requires an active lock before marking state", () => {
    let state = createMigrationState();
    expect(() =>
      markMigrationApplied(state, {
        migration: migrations[0]!,
        runnerId: "runner-a",
        nowMs: 1_000,
      }),
    ).toThrow("active migration lock required");

    state = acquireMigrationLock(state, { ownerId: "runner-a", nowMs: 1_000, ttlMs: 50 }).state;
    expect(() =>
      markMigrationFailed(state, {
        migration: migrations[0]!,
        runnerId: "runner-a",
        nowMs: 1_050,
        error: "boom",
      }),
    ).toThrow("active migration lock required");

    state = acquireMigrationLock(state, { ownerId: "runner-a", nowMs: 1_060, ttlMs: 50 }).state;
    state = markMigrationFailed(state, {
      migration: migrations[0]!,
      runnerId: "runner-a",
      nowMs: 1_070,
      error: "syntax error",
    });
    expect(migrationSnapshot(state, migrations)).toEqual({
      applied: 0,
      failed: 1,
      pending: 2,
      lockOwner: "runner-a",
    });
  });
});

describe("MWH schema-migration-runner stateful memory runner", () => {
  it("applies pending migrations and keeps clone-safe state reads", () => {
    let now = 1_000;
    const runner = new MemorySchemaMigrationRunner({
      runnerId: "runner-a",
      migrations,
      now: () => now,
      lockTtlMs: 500,
    });

    expect(runner.acquireLock().acquired).toBe(true);
    expect(runner.applyNext()?.id).toBe("001_create_users");
    now = 1_010;
    expect(runner.applyNext()?.id).toBe("002_add_email");
    expect(runner.applyNext()).toBeNull();

    const applied = runner.listApplied();
    applied[0]!.status = "failed";
    expect(runner.listApplied()[0]?.status).toBe("applied");
    expect(runner.snapshot()).toEqual({
      applied: 2,
      failed: 0,
      pending: 0,
      lockOwner: "runner-a",
    });
  });

  it("records failed migration attempts and releases the lock", () => {
    const runner = new MemorySchemaMigrationRunner({
      runnerId: "runner-a",
      migrations,
      now: () => 1_000,
      lockTtlMs: 500,
    });
    runner.acquireLock();
    expect(runner.failNext("syntax error")).toEqual(
      expect.objectContaining({
        id: "001_create_users",
        status: "failed",
        error: "syntax error",
      }),
    );
    runner.releaseLock();
    expect(runner.stateView().lock).toBeUndefined();
  });

  it("runs pending migrations through an executor and stops on failure", async () => {
    let now = 1_000;
    const executed: string[] = [];
    const runner = new MemorySchemaMigrationRunner({
      runnerId: "runner-a",
      migrations,
      now: () => now,
      lockTtlMs: 500,
    });

    const first = await runner.runPending((migration, lock) => {
      executed.push(`${lock.fencingToken}:${migration.id}`);
      now += 10;
    });
    expect(first.applied.map((entry) => entry.id)).toEqual(["001_create_users", "002_add_email"]);
    expect(first.failed).toBeUndefined();
    expect(executed).toEqual(["1:001_create_users", "1:002_add_email"]);

    const failingRunner = new MemorySchemaMigrationRunner({
      runnerId: "runner-b",
      migrations,
      now: () => now,
      lockTtlMs: 500,
    });
    const failed = await failingRunner.runPending((migration) => {
      if (migration.id === "002_add_email") throw new Error("ddl rejected");
      now += 10;
    });
    expect(failed.applied.map((entry) => entry.id)).toEqual(["001_create_users"]);
    expect(failed.failed).toEqual(
      expect.objectContaining({
        id: "002_add_email",
        status: "failed",
        error: "ddl rejected",
      }),
    );
    expect(failingRunner.snapshot()).toEqual({
      applied: 1,
      failed: 1,
      pending: 1,
      lockOwner: "runner-b",
    });
  });
});
