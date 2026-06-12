import { describe, expect, it } from "vitest";
import {
  archiveDeadLetter,
  claimDeadLetterForReplay,
  createDeadLetterMessage,
  deadLetterSnapshot,
  purgeArchivedDeadLetters,
  releaseDeadLetterReplay,
  requeueDeadLetter,
  resolveDeadLetter,
} from "../src/mwh/modules/eventing/dead-letter-queue/core.js";
import { MemoryDeadLetterQueue } from "../src/mwh/modules/eventing/dead-letter-queue/memory-store.js";

describe("dead-letter-queue MWH module", () => {
  it("creates immutable dead-letter messages and aggregates snapshots", () => {
    const payload = { orderId: "ord-1", nested: { status: "failed" } };
    const message = createDeadLetterMessage({
      source: "orders.consumer",
      messageId: "msg-1",
      reason: "max-attempts",
      payload,
      headers: { "X-Trace-Id": "trace-1" },
      error: "handler timeout",
      attempts: 5,
      nowMs: 1000,
    });

    payload.nested.status = "mutated";

    expect(message).toEqual({
      id: "orders.consumer\u0000msg-1",
      source: "orders.consumer",
      messageId: "msg-1",
      reason: "max-attempts",
      payload: { orderId: "ord-1", nested: { status: "failed" } },
      headers: { "x-trace-id": "trace-1" },
      error: "handler timeout",
      status: "queued",
      attempts: 5,
      createdAtMs: 1000,
      updatedAtMs: 1000,
    });
    expect(deadLetterSnapshot([message])).toEqual({
      queued: 1,
      replaying: 0,
      resolved: 0,
      archived: 0,
      byReason: {
        "handler-error": 0,
        "max-attempts": 1,
        "poison-message": 0,
        "schema-error": 0,
      },
      bySource: { "orders.consumer": 1 },
    });
  });

  it("claims replay with a lease, skips active claims, releases failures, and resolves success", () => {
    const message = createDeadLetterMessage({
      source: "orders.consumer",
      messageId: "msg-2",
      reason: "handler-error",
      payload: { orderId: "ord-2" },
      error: "timeout",
      attempts: 3,
      nowMs: 1000,
    });

    const claimed = claimDeadLetterForReplay({
      message,
      workerId: "worker-a",
      nowMs: 1010,
      lockMs: 100,
    });
    expect(claimed.kind).toBe("claimed");
    expect(claimed.message.status).toBe("replaying");
    expect(claimed.message.lockExpiresAtMs).toBe(1110);

    expect(
      claimDeadLetterForReplay({
        message: claimed.message,
        workerId: "worker-b",
        nowMs: 1020,
        lockMs: 100,
      }),
    ).toEqual({
      kind: "skip",
      message: claimed.message,
      reason: "message is actively replaying",
    });

    const released = releaseDeadLetterReplay(claimed.message, {
      workerId: "worker-a",
      nowMs: 1030,
      error: "still failing",
    });
    expect(released.status).toBe("queued");
    expect(released.lockedBy).toBeUndefined();
    expect(released.error).toBe("still failing");

    const reclaimed = claimDeadLetterForReplay({
      message: released,
      workerId: "worker-b",
      nowMs: 1120,
      lockMs: 100,
    });
    expect(reclaimed.kind).toBe("claimed");
    const resolved = resolveDeadLetter(reclaimed.message, {
      workerId: "worker-b",
      nowMs: 1130,
      note: "manual replay succeeded",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.note).toBe("manual replay succeeded");
  });

  it("guards lock ownership and archive lifecycle", () => {
    const message = createDeadLetterMessage({
      source: "billing.consumer",
      messageId: "msg-3",
      reason: "schema-error",
      payload: { invoiceId: "inv-1" },
      error: "invalid schema",
      attempts: 1,
      nowMs: 1000,
    });
    const claimed = claimDeadLetterForReplay({
      message,
      workerId: "worker-a",
      nowMs: 1010,
      lockMs: 100,
    }).message;

    expect(() =>
      resolveDeadLetter(claimed, {
        workerId: "worker-b",
        nowMs: 1020,
      }),
    ).toThrow("dead-letter message is locked by another worker");
    expect(() => archiveDeadLetter(claimed, { nowMs: 1020 })).toThrow(
      "cannot archive active replay",
    );

    const released = releaseDeadLetterReplay(claimed, {
      workerId: "worker-a",
      nowMs: 1030,
      error: "manual review required",
    });
    expect(archiveDeadLetter(released, { nowMs: 1040, note: "not replayable" }).status).toBe(
      "archived",
    );
  });

  it("requeues resolved messages and purges old archived messages", () => {
    const message = createDeadLetterMessage({
      source: "orders.consumer",
      messageId: "msg-5",
      reason: "handler-error",
      payload: { orderId: "ord-5" },
      error: "timeout",
      attempts: 2,
      nowMs: 1_000,
    });
    const resolved = resolveDeadLetter(message, { nowMs: 1_100, note: "fixed" });
    expect(requeueDeadLetter(resolved, { nowMs: 1_200, note: "retry requested" })).toEqual(
      expect.objectContaining({ status: "queued", note: "retry requested" }),
    );

    const archived = archiveDeadLetter(message, { nowMs: 1_100 });
    const result = purgeArchivedDeadLetters([archived, message], {
      nowMs: 2_200,
      olderThanMs: 1_000,
    });
    expect(result.purged.map((item) => item.id)).toEqual([archived.id]);
    expect(result.retained.map((item) => item.id)).toEqual([message.id]);
  });

  it("runs the stateful in-memory DLQ lifecycle with clone-safe reads", () => {
    let now = 1000;
    const dlq = new MemoryDeadLetterQueue({ now: () => now });

    dlq.enqueue({
      source: "orders.consumer",
      messageId: "msg-4",
      reason: "max-attempts",
      payload: { orderId: "ord-4" },
      headers: { "X-Request-Id": "req-1" },
      error: "timeout",
      attempts: 5,
    });
    expect(() =>
      dlq.enqueue({
        source: "orders.consumer",
        messageId: "msg-4",
        reason: "max-attempts",
        payload: {},
        error: "duplicate",
        attempts: 5,
      }),
    ).toThrow("dead-letter message already exists");

    const leaked = dlq.list();
    (leaked[0]!.payload as { orderId: string }).orderId = "mutated";

    now = 1010;
    const claimed = dlq.claimReplay({
      source: "orders.consumer",
      messageId: "msg-4",
      workerId: "worker-a",
      lockMs: 100,
    });
    expect(claimed.kind).toBe("claimed");
    expect(dlq.list({ status: "replaying" })).toHaveLength(1);

    now = 1020;
    dlq.resolve({
      source: "orders.consumer",
      messageId: "msg-4",
      workerId: "worker-a",
      note: "replayed",
    });
    expect(dlq.list()[0]!.payload).toEqual({ orderId: "ord-4" });
    expect(dlq.snapshot()).toEqual({
      queued: 0,
      replaying: 0,
      resolved: 1,
      archived: 0,
      byReason: {
        "handler-error": 0,
        "max-attempts": 1,
        "poison-message": 0,
        "schema-error": 0,
      },
      bySource: { "orders.consumer": 1 },
    });
  });

  it("runs stateful batch claim, requeue, archive purge, and source filtering", () => {
    let now = 1_000;
    const dlq = new MemoryDeadLetterQueue({ now: () => now });
    dlq.enqueue({
      source: "orders.consumer",
      messageId: "msg-6",
      reason: "handler-error",
      payload: { orderId: "ord-6" },
      error: "timeout",
      attempts: 3,
    });
    dlq.enqueue({
      source: "billing.consumer",
      messageId: "msg-7",
      reason: "schema-error",
      payload: { invoiceId: "inv-7" },
      error: "schema",
      attempts: 1,
    });

    expect(
      dlq
        .claimBatch({
          source: "orders.consumer",
          workerId: "worker-a",
          lockMs: 100,
          limit: 10,
        })
        .map((claim) => claim.message.messageId),
    ).toEqual(["msg-6"]);
    expect(dlq.list({ status: "queued" }).map((message) => message.messageId)).toEqual(["msg-7"]);

    now = 1_050;
    expect(
      dlq.requeue({
        source: "orders.consumer",
        messageId: "msg-6",
        note: "retry later",
      }),
    ).toEqual(expect.objectContaining({ status: "queued", note: "retry later" }));
    expect(
      dlq.claimBatch({
        source: "orders.consumer",
        workerId: "worker-b",
        lockMs: 100,
        limit: 1,
      }),
    ).toHaveLength(1);

    now = 1_100;
    dlq.releaseReplay({
      source: "orders.consumer",
      messageId: "msg-6",
      workerId: "worker-b",
      error: "still failing",
    });
    dlq.archive({ source: "orders.consumer", messageId: "msg-6", note: "manual only" });
    now = 2_200;
    expect(dlq.purgeArchived({ olderThanMs: 1_000 }).map((message) => message.messageId)).toEqual([
      "msg-6",
    ]);
    expect(dlq.list().map((message) => message.messageId)).toEqual(["msg-7"]);
  });
});
