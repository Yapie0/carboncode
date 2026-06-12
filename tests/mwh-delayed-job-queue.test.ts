import { describe, expect, it } from "vitest";
import {
  calculateJobBackoffMs,
  cancelJob,
  claimJob,
  compareRunnableJobs,
  completeJob,
  createJob,
  failJob,
  jobQueueSummary,
  releaseDueJob,
  releaseExpiredLease,
} from "../src/mwh/modules/async-jobs/delayed-job-queue/core.js";
import { MemoryDelayedJobQueue } from "../src/mwh/modules/async-jobs/delayed-job-queue/memory-queue.js";

describe("MWH delayed-job-queue middleware", () => {
  it("creates delayed jobs and releases them when due", () => {
    const job = createJob({
      id: "j1",
      queue: "emails",
      type: "send",
      payload: { userId: "u1" },
      nowMs: 1_000,
      delayMs: 500,
    });
    (job.payload as { userId: string }).userId = "mutated";

    expect(job).toEqual(expect.objectContaining({ status: "scheduled", runAtMs: 1_500 }));
    expect(releaseDueJob(job, 1_499)).toEqual(expect.objectContaining({ status: "scheduled" }));
    expect(releaseDueJob(job, 1_500)).toEqual(expect.objectContaining({ status: "ready" }));
  });

  it("claims, completes, retries, and fails jobs with backoff", () => {
    const ready = createJob({
      id: "j1",
      queue: "emails",
      type: "send",
      payload: {},
      nowMs: 1_000,
      maxAttempts: 2,
    });
    const claimed = claimJob(ready, { nowMs: 1_000, workerId: "w1", leaseMs: 100 });
    expect(claimed).toEqual(
      expect.objectContaining({ status: "running", workerId: "w1", leaseUntilMs: 1_100 }),
    );

    expect(completeJob(claimed!, { nowMs: 1_050, workerId: "w1" })).toEqual(
      expect.objectContaining({ status: "succeeded", finishedAtMs: 1_050 }),
    );

    const retry = failJob(claimed!, {
      nowMs: 1_060,
      workerId: "w1",
      error: "503",
      backoff: { baseDelayMs: 200, maxDelayMs: 1_000 },
    });
    expect(retry).toEqual(
      expect.objectContaining({
        status: "retrying",
        attempt: 1,
        runAtMs: 1_260,
      }),
    );
    const failed = failJob(
      { ...retry, status: "running", workerId: "w1" },
      {
        nowMs: 1_300,
        workerId: "w1",
        error: "503 again",
        backoff: { baseDelayMs: 200, maxDelayMs: 1_000 },
      },
    );
    expect(failed).toEqual(
      expect.objectContaining({ status: "failed", attempt: 2, finishedAtMs: 1_300 }),
    );
  });

  it("orders runnable jobs by priority then schedule time", () => {
    const low = createJob({
      id: "low",
      queue: "q",
      type: "work",
      payload: {},
      nowMs: 1_000,
      priority: 1,
    });
    const high = createJob({
      id: "high",
      queue: "q",
      type: "work",
      payload: {},
      nowMs: 1_010,
      priority: 10,
    });
    expect([low, high].sort(compareRunnableJobs).map((job) => job.id)).toEqual(["high", "low"]);
  });

  it("releases expired leases and supports cancellation", () => {
    const claimed = claimJob(
      createJob({ id: "j1", queue: "q", type: "work", payload: {}, nowMs: 1_000 }),
      { nowMs: 1_000, workerId: "w1", leaseMs: 100 },
    );
    expect(releaseExpiredLease(claimed!, 1_099)).toEqual(
      expect.objectContaining({ status: "running" }),
    );
    expect(releaseExpiredLease(claimed!, 1_100)).toEqual(
      expect.objectContaining({ status: "ready", lastError: "lease expired" }),
    );
    expect(cancelJob(claimed!, { nowMs: 1_050, reason: "user cancelled" })).toEqual(
      expect.objectContaining({ status: "cancelled", lastError: "user cancelled" }),
    );
  });

  it("calculates capped exponential backoff", () => {
    expect(calculateJobBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculateJobBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculateJobBackoffMs(8, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);
    expect(
      jobQueueSummary([
        createJob({ id: "j1", queue: "q", type: "work", payload: {}, nowMs: 1_000 }),
        cancelJob(createJob({ id: "j2", queue: "q", type: "work", payload: {}, nowMs: 1_000 }), {
          nowMs: 1_010,
        }),
      ]),
    ).toEqual({
      scheduled: 0,
      ready: 1,
      running: 0,
      succeeded: 0,
      retrying: 0,
      failed: 0,
      cancelled: 1,
      total: 2,
    });
  });

  it("runs a stateful delayed, retry, stale takeover, complete, and per-queue flow", () => {
    let now = 1_000;
    const queue = new MemoryDelayedJobQueue({
      now: () => now,
      defaultLeaseMs: 100,
      backoff: { baseDelayMs: 200, maxDelayMs: 1_000 },
    });

    queue.enqueue({
      id: "j1",
      queue: "emails",
      type: "send",
      payload: { userId: "u1" },
      delayMs: 200,
      priority: 1,
      maxAttempts: 3,
    });
    queue.enqueue({
      id: "j2",
      queue: "images",
      type: "resize",
      payload: { imageId: "img1" },
    });

    expect(queue.claimNext("emails", "w1")).toBeUndefined();
    expect(queue.claimNext("images", "w1")).toEqual(expect.objectContaining({ id: "j2" }));

    now = 1_200;
    const first = queue.claimNext("emails", "w1");
    expect(first).toEqual(expect.objectContaining({ id: "j1", status: "running" }));
    expect(queue.fail("j1", "w1", "timeout")).toEqual(
      expect.objectContaining({ status: "retrying", attempt: 1, runAtMs: 1_400 }),
    );
    expect(queue.claimNext("emails", "w2")).toBeUndefined();

    now = 1_400;
    const retry = queue.claimNext("emails", "w2");
    expect(retry).toEqual(expect.objectContaining({ id: "j1", workerId: "w2" }));
    now = 1_501;
    expect(queue.claimNext("emails", "w3")).toEqual(expect.objectContaining({ workerId: "w3" }));
    expect(queue.complete("j1", "w3")).toEqual(expect.objectContaining({ status: "succeeded" }));
  });

  it("processes jobs through registered processors, retries failures, and reports summaries", async () => {
    let now = 1_000;
    const queue = new MemoryDelayedJobQueue({
      now: () => now,
      defaultLeaseMs: 100,
      backoff: { baseDelayMs: 100, maxDelayMs: 100 },
    });
    const seen: string[] = [];
    queue.registerProcessor("send", (job) => {
      seen.push(String((job.payload as { userId: string }).userId));
    });
    queue.registerProcessor("flaky", () => {
      throw new Error("boom");
    });
    const payload = { userId: "u1" };
    queue.enqueue({
      id: "j1",
      queue: "emails",
      type: "send",
      payload,
    });
    payload.userId = "mutated";
    expect(queue.get("j1")?.payload).toEqual({ userId: "u1" });

    expect(await queue.processNext("emails", "w1")).toEqual({
      processed: true,
      job: expect.objectContaining({ id: "j1", status: "succeeded" }),
    });
    expect(seen).toEqual(["u1"]);

    queue.enqueue({ id: "j2", queue: "emails", type: "flaky", payload: {}, maxAttempts: 2 });
    expect(await queue.processNext("emails", "w1")).toEqual({
      processed: true,
      job: expect.objectContaining({ status: "retrying", attempt: 1, runAtMs: 1_100 }),
    });
    now = 1_100;
    expect(await queue.processNext("emails", "w1")).toEqual({
      processed: true,
      job: expect.objectContaining({ status: "failed", attempt: 2 }),
    });

    queue.enqueue({ id: "j3", queue: "emails", type: "missing", payload: {}, maxAttempts: 1 });
    expect(await queue.processNext("emails", "w1")).toEqual({
      processed: true,
      job: expect.objectContaining({ status: "failed", lastError: "missing processor: missing" }),
    });
    expect(queue.summary("emails")).toEqual(
      expect.objectContaining({ succeeded: 1, failed: 2, total: 3 }),
    );
  });
});
