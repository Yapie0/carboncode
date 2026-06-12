import { describe, expect, it } from "vitest";
import {
  claimCronTask,
  completeCronTask,
  createCronTask,
  cronSchedulerSummary,
  cronTaskDue,
  failCronTask,
  nextCronRunAt,
  parseCronExpression,
  releaseExpiredCronLease,
  setCronTaskEnabled,
} from "../src/mwh/modules/async-jobs/cron-scheduler/core.js";
import { MemoryCronScheduler } from "../src/mwh/modules/async-jobs/cron-scheduler/memory-scheduler.js";

describe("MWH cron-scheduler middleware", () => {
  it("parses minimal cron expressions and calculates next run times", () => {
    expect(parseCronExpression("*/15 *")).toEqual({ minute: "*/15", hour: "*" });
    expect(parseCronExpression("0 1")).toEqual({ minute: "0", hour: "1" });
    expect(() => parseCronExpression("* * *")).toThrow(
      "cron expression must contain minute and hour fields",
    );

    const atOne = Date.UTC(2026, 0, 1, 1, 0, 0);
    const atOneThirty = Date.UTC(2026, 0, 1, 1, 30, 0);
    expect(nextCronRunAt({ minute: "*/15", hour: "*" }, atOne)).toBe(
      Date.UTC(2026, 0, 1, 1, 15, 0),
    );
    expect(nextCronRunAt({ minute: "0", hour: "2" }, atOneThirty)).toBe(
      Date.UTC(2026, 0, 1, 2, 0, 0),
    );
  });

  it("creates, claims, completes, and schedules the next cron run", () => {
    const now = Date.UTC(2026, 0, 1, 1, 0, 0);
    const task = createCronTask({
      id: "cleanup",
      name: "Cleanup",
      expression: "*/15 *",
      payload: { table: "sessions" },
      nowMs: now,
    });
    expect(task).toEqual(
      expect.objectContaining({
        status: "enabled",
        nextRunAtMs: Date.UTC(2026, 0, 1, 1, 15, 0),
      }),
    );
    expect(cronTaskDue(task, Date.UTC(2026, 0, 1, 1, 14, 59))).toBe(false);
    expect(cronTaskDue(task, Date.UTC(2026, 0, 1, 1, 15, 0))).toBe(true);

    const claimed = claimCronTask(task, {
      nowMs: Date.UTC(2026, 0, 1, 1, 15, 0),
      workerId: "w1",
      leaseMs: 1_000,
    });
    expect(claimed).toEqual(
      expect.objectContaining({
        status: "running",
        runningBy: "w1",
        leaseUntilMs: Date.UTC(2026, 0, 1, 1, 15, 1),
      }),
    );
    expect(
      completeCronTask(claimed!, { nowMs: Date.UTC(2026, 0, 1, 1, 15, 30), workerId: "w1" }),
    ).toEqual(
      expect.objectContaining({
        status: "enabled",
        lastRunAtMs: Date.UTC(2026, 0, 1, 1, 15, 30),
        nextRunAtMs: Date.UTC(2026, 0, 1, 1, 30, 0),
      }),
    );
  });

  it("fails tasks, supports retry delay, releases stale leases, and toggles enabled state", () => {
    const task = createCronTask({
      id: "sync",
      name: "Sync",
      expression: "* *",
      payload: {},
      nowMs: 1_000,
    });
    const claimed = claimCronTask(task, { nowMs: task.nextRunAtMs, workerId: "w1", leaseMs: 100 });
    expect(releaseExpiredCronLease(claimed!, task.nextRunAtMs + 99)).toEqual(
      expect.objectContaining({ status: "running" }),
    );
    expect(releaseExpiredCronLease(claimed!, task.nextRunAtMs + 100)).toEqual(
      expect.objectContaining({ status: "enabled", lastError: "lease expired" }),
    );
    expect(
      failCronTask(claimed!, {
        nowMs: task.nextRunAtMs + 10,
        workerId: "w1",
        error: "network",
        retryDelayMs: 500,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "enabled",
        nextRunAtMs: task.nextRunAtMs + 510,
        lastError: "network",
      }),
    );
    expect(setCronTaskEnabled(task, false, 2_000)).toEqual(
      expect.objectContaining({ status: "disabled", updatedAtMs: 2_000 }),
    );
    expect(cronSchedulerSummary([task], { nowMs: task.nextRunAtMs })).toEqual({
      enabled: 1,
      disabled: 0,
      running: 0,
      failed: 0,
      due: 1,
      total: 1,
    });
  });

  it("runs a stateful register, claim, complete, retry, and stale takeover flow", () => {
    let now = Date.UTC(2026, 0, 1, 1, 0, 0);
    const scheduler = new MemoryCronScheduler({
      now: () => now,
      defaultLeaseMs: 100,
      retryDelayMs: 500,
    });

    scheduler.register({ id: "a", name: "A", expression: "*/5 *", payload: { a: true } });
    scheduler.register({ id: "b", name: "B", expression: "*/15 *", payload: { b: true } });
    expect(scheduler.claimNext("w1")).toBeUndefined();

    now = Date.UTC(2026, 0, 1, 1, 5, 0);
    expect(scheduler.claimNext("w1")).toEqual(expect.objectContaining({ id: "a" }));
    expect(scheduler.complete("a", "w1")).toEqual(
      expect.objectContaining({ status: "enabled", nextRunAtMs: Date.UTC(2026, 0, 1, 1, 10, 0) }),
    );

    now = Date.UTC(2026, 0, 1, 1, 10, 0);
    expect(scheduler.claimNext("w2")).toEqual(expect.objectContaining({ id: "a" }));
    expect(scheduler.fail("a", "w2", "temporary")).toEqual(
      expect.objectContaining({ status: "enabled", nextRunAtMs: now + 500 }),
    );
    expect(scheduler.claimNext("w3")).toBeUndefined();

    now += 500;
    expect(scheduler.claimNext("w3")).toEqual(
      expect.objectContaining({ id: "a", runningBy: "w3" }),
    );
    now += 100;
    expect(scheduler.claimNext("w4")).toEqual(
      expect.objectContaining({ id: "a", runningBy: "w4" }),
    );
  });

  it("disables tasks in the stateful scheduler", () => {
    let now = Date.UTC(2026, 0, 1, 1, 0, 0);
    const scheduler = new MemoryCronScheduler({ now: () => now });
    scheduler.register({ id: "disabled", name: "Disabled", expression: "* *", payload: {} });
    scheduler.setEnabled("disabled", false);

    now = Date.UTC(2026, 0, 1, 1, 1, 0);
    expect(scheduler.claimNext("w1")).toBeUndefined();
    expect(scheduler.list("disabled").map((task) => task.id)).toEqual(["disabled"]);
  });

  it("runs due tasks through processors, handles failures, and keeps clone-safe payloads", async () => {
    let now = Date.UTC(2026, 0, 1, 1, 0, 0);
    const scheduler = new MemoryCronScheduler({
      now: () => now,
      retryDelayMs: 500,
    });
    const seen: string[] = [];
    const payload = { table: "sessions" };
    scheduler.register({ id: "cleanup", name: "cleanup", expression: "* *", payload });
    payload.table = "mutated";
    expect(scheduler.get("cleanup")?.payload).toEqual({ table: "sessions" });
    scheduler.registerProcessor("cleanup", (task) => {
      seen.push(String((task.payload as { table: string }).table));
    });

    now = Date.UTC(2026, 0, 1, 1, 1, 0);
    expect(await scheduler.runDue("worker-a")).toEqual({
      processed: true,
      task: expect.objectContaining({ id: "cleanup", status: "enabled" }),
    });
    expect(seen).toEqual(["sessions"]);

    scheduler.register({ id: "flaky", name: "flaky", expression: "* *", payload: {} });
    scheduler.registerProcessor("flaky", () => {
      throw new Error("network");
    });
    now = Date.UTC(2026, 0, 1, 1, 2, 0);
    expect(await scheduler.runDue("worker-a")).toEqual({
      processed: true,
      task: expect.objectContaining({ id: "cleanup", status: "enabled" }),
    });
    expect(await scheduler.runDue("worker-a")).toEqual({
      processed: true,
      task: expect.objectContaining({
        id: "flaky",
        status: "enabled",
        lastError: "network",
        nextRunAtMs: now + 500,
      }),
    });

    scheduler.register({ id: "missing", name: "missing", expression: "* *", payload: {} });
    now = Date.UTC(2026, 0, 1, 1, 3, 0);
    scheduler.setEnabled("cleanup", false);
    scheduler.setEnabled("flaky", false);
    expect(await scheduler.runDue("worker-a")).toEqual({
      processed: true,
      task: expect.objectContaining({
        id: "missing",
        status: "enabled",
        lastError: "missing processor: missing",
      }),
    });
    expect(scheduler.summary()).toEqual(
      expect.objectContaining({ enabled: 1, disabled: 2, due: 0, total: 3 }),
    );
  });
});
