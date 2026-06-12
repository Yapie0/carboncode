import { describe, expect, it } from "vitest";
import {
  beginConsume,
  cloneConsumerMessageRecord,
  consumerMessageKey,
  consumerMessageSnapshot,
  consumerRetryDelayMs,
  createConsumerMessageRecord,
  markConsumerFailed,
  markConsumerSucceeded,
} from "../src/mwh/modules/eventing/idempotent-consumer/core.js";
import { MemoryIdempotentConsumerStore } from "../src/mwh/modules/eventing/idempotent-consumer/memory-store.js";

describe("MWH idempotent-consumer middleware", () => {
  it("creates keys and starts first consumption attempts", () => {
    expect(consumerMessageKey({ consumerName: "projection", messageId: "evt-1" })).toBe(
      "projection\0evt-1",
    );
    expect(
      createConsumerMessageRecord({
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-a",
        nowMs: 1_000,
        lockMs: 500,
        maxAttempts: 3,
      }),
    ).toEqual({
      key: "projection\0evt-1",
      messageId: "evt-1",
      consumerName: "projection",
      status: "processing",
      attempt: 1,
      maxAttempts: 3,
      firstSeenAtMs: 1_000,
      updatedAtMs: 1_000,
      nextAttemptAtMs: 1_000,
      lockedBy: "worker-a",
      lockExpiresAtMs: 1_500,
    });
  });

  it("handles duplicate success, active locks, and stale lock takeover", () => {
    const first = beginConsume({
      consumerName: "projection",
      messageId: "evt-1",
      workerId: "worker-a",
      nowMs: 1_000,
      lockMs: 500,
      maxAttempts: 3,
    });
    if (first.kind !== "started") throw new Error("expected start");

    expect(
      beginConsume({
        existing: first.record,
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-b",
        nowMs: 1_250,
        lockMs: 500,
      }),
    ).toEqual(expect.objectContaining({ kind: "skip", reason: "message is actively processing" }));

    expect(
      beginConsume({
        existing: first.record,
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-b",
        nowMs: 1_500,
        lockMs: 500,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "started",
        record: expect.objectContaining({ attempt: 1, lockedBy: "worker-b" }),
      }),
    );

    const succeeded = markConsumerSucceeded(first.record, {
      nowMs: 1_100,
      workerId: "worker-a",
      result: { ok: true },
    });
    const cloned = cloneConsumerMessageRecord(succeeded);
    (cloned.result as { ok: boolean }).ok = false;
    expect(succeeded.result).toEqual({ ok: true });
    expect(
      beginConsume({
        existing: succeeded,
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-c",
        nowMs: 2_000,
        lockMs: 500,
      }),
    ).toEqual(expect.objectContaining({ kind: "duplicate-success" }));
  });

  it("fails with retry delay and dead-letters at max attempts", () => {
    const record = createConsumerMessageRecord({
      consumerName: "projection",
      messageId: "evt-1",
      workerId: "worker-a",
      nowMs: 1_000,
      lockMs: 500,
      maxAttempts: 2,
    });

    const failed = markConsumerFailed(record, {
      nowMs: 1_100,
      workerId: "worker-a",
      error: "db unavailable",
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    });
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        nextAttemptAtMs: 1_200,
        lastError: "db unavailable",
        lockedBy: undefined,
      }),
    );
    expect(
      beginConsume({
        existing: failed,
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-b",
        nowMs: 1_199,
        lockMs: 500,
      }),
    ).toEqual(
      expect.objectContaining({ kind: "skip", reason: "message is waiting for retry delay" }),
    );

    const retry = beginConsume({
      existing: failed,
      consumerName: "projection",
      messageId: "evt-1",
      workerId: "worker-b",
      nowMs: 1_200,
      lockMs: 500,
    });
    if (retry.kind !== "started") throw new Error("expected retry");
    expect(
      markConsumerFailed(retry.record, {
        nowMs: 1_250,
        workerId: "worker-b",
        error: "poison",
        baseDelayMs: 100,
        maxDelayMs: 1_000,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "dead-letter",
        nextAttemptAtMs: Number.POSITIVE_INFINITY,
      }),
    );
    expect(consumerRetryDelayMs(4, 100, 500)).toBe(500);
    expect(consumerMessageSnapshot([failed], 1_199)).toEqual({
      total: 1,
      processing: 0,
      succeeded: 0,
      failed: 1,
      deadLetter: 0,
      dueForRetry: 0,
    });
    expect(consumerMessageSnapshot([failed], 1_200)).toEqual({
      total: 1,
      processing: 0,
      succeeded: 0,
      failed: 1,
      deadLetter: 0,
      dueForRetry: 1,
    });
  });

  it("runs a stateful begin, succeed, and duplicate no-op flow", () => {
    const store = new MemoryIdempotentConsumerStore({ now: () => 1_000 });
    expect(
      store.begin({
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-a",
      }),
    ).toEqual(expect.objectContaining({ kind: "started" }));
    const succeeded = store.succeed("projection", "evt-1", "worker-a", { projected: true });
    expect(succeeded).toEqual(
      expect.objectContaining({ status: "succeeded", result: { projected: true } }),
    );
    (succeeded.result as { projected: boolean }).projected = false;
    expect(store.get("projection", "evt-1")?.result).toEqual({ projected: true });
    expect(
      store.begin({
        consumerName: "projection",
        messageId: "evt-1",
        workerId: "worker-b",
      }),
    ).toEqual(expect.objectContaining({ kind: "duplicate-success" }));
    expect(store.list("succeeded").map((record) => record.messageId)).toEqual(["evt-1"]);

    const listed = store.list("succeeded");
    (listed[0]!.result as { projected: boolean }).projected = false;
    expect(store.get("projection", "evt-1")?.result).toEqual({ projected: true });
    expect(store.snapshot()).toEqual({
      total: 1,
      processing: 0,
      succeeded: 1,
      failed: 0,
      deadLetter: 0,
      dueForRetry: 0,
    });
  });

  it("runs a stateful fail, retry, stale takeover, and dead-letter flow", () => {
    let now = 1_000;
    const store = new MemoryIdempotentConsumerStore({
      now: () => now,
      lockMs: 100,
      baseDelayMs: 50,
      maxDelayMs: 500,
      defaultMaxAttempts: 2,
    });

    expect(store.begin({ consumerName: "worker", messageId: "evt-1", workerId: "a" })).toEqual(
      expect.objectContaining({ kind: "started" }),
    );
    expect(store.fail("worker", "evt-1", "a", "temporary")).toEqual(
      expect.objectContaining({ status: "failed", nextAttemptAtMs: 1_050 }),
    );
    expect(store.begin({ consumerName: "worker", messageId: "evt-1", workerId: "b" })).toEqual(
      expect.objectContaining({ kind: "skip" }),
    );
    now = 1_050;
    expect(store.begin({ consumerName: "worker", messageId: "evt-1", workerId: "b" })).toEqual(
      expect.objectContaining({
        kind: "started",
        record: expect.objectContaining({ lockedBy: "b", attempt: 2 }),
      }),
    );
    now = 1_120;
    expect(store.begin({ consumerName: "worker", messageId: "evt-1", workerId: "c" })).toEqual(
      expect.objectContaining({ kind: "skip", reason: "message is actively processing" }),
    );
    now = 1_150;
    expect(store.begin({ consumerName: "worker", messageId: "evt-1", workerId: "c" })).toEqual(
      expect.objectContaining({
        kind: "started",
        record: expect.objectContaining({ lockedBy: "c", attempt: 2 }),
      }),
    );
    expect(store.fail("worker", "evt-1", "c", "poison")).toEqual(
      expect.objectContaining({ status: "dead-letter" }),
    );
    expect(store.list("dead-letter")).toHaveLength(1);
    expect(store.snapshot()).toEqual({
      total: 1,
      processing: 0,
      succeeded: 0,
      failed: 0,
      deadLetter: 1,
      dueForRetry: 0,
    });
  });
});
