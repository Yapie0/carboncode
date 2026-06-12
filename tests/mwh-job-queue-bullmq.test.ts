import { describe, expect, it } from "vitest";
import {
  calculateBullBackoffMs,
  claimBullJob,
  compareBullRunnableJobs,
  completeBullJob,
  createBullJob,
  failBullJob,
  promoteDelayedBullJob,
  releaseStalledBullJob,
} from "../src/mwh/modules/async-jobs/job-queue-bullmq/core.js";
import { MemoryBullQueue } from "../src/mwh/modules/async-jobs/job-queue-bullmq/memory-queue.js";

describe("MWH job-queue-bullmq stateless core", () => {
  it("creates waiting and delayed named jobs", () => {
    expect(
      createBullJob({
        id: "job-1",
        queueName: "default",
        name: "send-email",
        data: { userId: "u1" },
        nowMs: 1_000,
        options: { attempts: 3, delayMs: 500, priority: 10 },
      }),
    ).toEqual(
      expect.objectContaining({
        id: "job-1",
        queueName: "default",
        name: "send-email",
        status: "delayed",
        attempts: 3,
        priority: 10,
        availableAtMs: 1_500,
      }),
    );
    expect(
      createBullJob({
        id: "job-2",
        queueName: "default",
        name: "send-email",
        data: {},
        nowMs: 1_000,
      }),
    ).toEqual(expect.objectContaining({ status: "waiting", attempts: 1 }));
  });

  it("promotes delayed jobs, claims, completes, and releases stalled jobs", () => {
    const delayed = createBullJob({
      id: "job-1",
      queueName: "default",
      name: "work",
      data: {},
      nowMs: 1_000,
      options: { delayMs: 100 },
    });

    expect(promoteDelayedBullJob(delayed, 1_099).status).toBe("delayed");
    const waiting = promoteDelayedBullJob(delayed, 1_100);
    expect(waiting.status).toBe("waiting");
    const active = claimBullJob(waiting, { nowMs: 1_100, workerId: "worker-a", lockMs: 50 });
    expect(active).toEqual(
      expect.objectContaining({ status: "active", lockedBy: "worker-a", lockUntilMs: 1_150 }),
    );
    expect(
      completeBullJob(active!, { nowMs: 1_125, workerId: "worker-a", result: { ok: true } }),
    ).toEqual(
      expect.objectContaining({ status: "completed", result: { ok: true }, finishedAtMs: 1_125 }),
    );
    expect(releaseStalledBullJob(active!, 1_149).status).toBe("active");
    expect(releaseStalledBullJob(active!, 1_150)).toEqual(
      expect.objectContaining({ status: "waiting", failedReason: "lock expired" }),
    );
  });

  it("retries failures and dead-letters after attempts are exhausted", () => {
    const active = claimBullJob(
      createBullJob({
        id: "job-1",
        queueName: "default",
        name: "work",
        data: {},
        nowMs: 1_000,
        options: { attempts: 2 },
      }),
      { nowMs: 1_000, workerId: "worker-a", lockMs: 100 },
    );
    if (!active) throw new Error("expected claim");

    const retrying = failBullJob(active, {
      nowMs: 1_010,
      workerId: "worker-a",
      error: "503",
      backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(retrying).toEqual(
      expect.objectContaining({
        status: "retrying",
        attemptsMade: 1,
        availableAtMs: 1_110,
      }),
    );
    const activeAgain = { ...retrying, status: "active" as const, lockedBy: "worker-a" };
    expect(
      failBullJob(activeAgain, {
        nowMs: 1_200,
        workerId: "worker-a",
        error: "503 again",
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(
      expect.objectContaining({
        status: "dead-lettered",
        attemptsMade: 2,
        finishedAtMs: 1_200,
      }),
    );
  });

  it("orders runnable jobs by priority, availability, creation time, and id", () => {
    const low = createBullJob({
      id: "low",
      queueName: "q",
      name: "work",
      data: {},
      nowMs: 1_000,
      options: { priority: 1 },
    });
    const high = createBullJob({
      id: "high",
      queueName: "q",
      name: "work",
      data: {},
      nowMs: 1_100,
      options: { priority: 10 },
    });

    expect([low, high].sort(compareBullRunnableJobs).map((job) => job.id)).toEqual(["high", "low"]);
    expect(calculateBullBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
  });
});

describe("MWH job-queue-bullmq stateful memory queue", () => {
  it("registers processors, processes success, and preserves clone safety", () => {
    let now = 1_000;
    const queue = new MemoryBullQueue({ now: () => now });
    queue.registerProcessor("send-email", (job) => ({ sentTo: String(job.data.userId) }));
    const job = queue.add({
      id: "job-1",
      queueName: "default",
      name: "send-email",
      data: { userId: "u1" },
      options: { attempts: 2 },
    });
    job.status = "dead-lettered";
    expect(queue.get("job-1")?.status).toBe("waiting");

    now = 1_010;
    expect(queue.processNext("default", "worker-a")).toEqual({
      processed: true,
      job: expect.objectContaining({
        status: "completed",
        result: { sentTo: "u1" },
      }),
    });
  });

  it("handles processor errors, retries after backoff, and dead-letters", () => {
    let now = 1_000;
    const queue = new MemoryBullQueue({
      now: () => now,
      backoff: { baseDelayMs: 100, maxDelayMs: 100 },
    });
    queue.registerProcessor("flaky", () => {
      throw new Error("boom");
    });
    queue.add({
      id: "job-1",
      queueName: "default",
      name: "flaky",
      data: {},
      options: { attempts: 2 },
    });

    expect(queue.processNext("default", "worker-a")).toEqual({
      processed: true,
      job: expect.objectContaining({ status: "retrying", attemptsMade: 1, availableAtMs: 1_100 }),
    });
    expect(queue.processNext("default", "worker-a")).toEqual({ processed: false });
    now = 1_100;
    expect(queue.processNext("default", "worker-a")).toEqual({
      processed: true,
      job: expect.objectContaining({ status: "dead-lettered", attemptsMade: 2 }),
    });
  });

  it("claims by priority, handles missing processors, and rejects duplicate ids", () => {
    const queue = new MemoryBullQueue({ now: () => 1_000 });
    queue.add({
      id: "low",
      queueName: "default",
      name: "missing",
      data: {},
      options: { priority: 1, attempts: 1 },
    });
    queue.add({
      id: "high",
      queueName: "default",
      name: "missing",
      data: {},
      options: { priority: 10, attempts: 1 },
    });
    expect(() =>
      queue.add({ id: "high", queueName: "default", name: "missing", data: {} }),
    ).toThrow("job already exists");
    expect(queue.claimNext("default", "worker-a")).toEqual(expect.objectContaining({ id: "high" }));
    expect(queue.fail("high", "worker-a", "manual")).toEqual(
      expect.objectContaining({ status: "dead-lettered" }),
    );
    expect(queue.processNext("default", "worker-a")).toEqual({
      processed: true,
      job: expect.objectContaining({
        id: "low",
        status: "dead-lettered",
        failedReason: "missing processor: missing",
      }),
    });
  });
});
