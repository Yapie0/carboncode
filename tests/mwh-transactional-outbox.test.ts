import { describe, expect, it } from "vitest";
import {
  claimOutboxEvent,
  cloneOutboxEvent,
  createOutboxEvent,
  failOutboxEvent,
  markOutboxPublished,
  releaseFailedForRetry,
  retryDelayMs,
  summarizeOutboxEvents,
} from "../src/mwh/modules/eventing/transactional-outbox/core.js";
import { MemoryOutboxStore } from "../src/mwh/modules/eventing/transactional-outbox/memory-store.js";

function orderEvent(nowMs = 0) {
  return createOutboxEvent({
    id: "evt-1",
    aggregateType: "order",
    aggregateId: "ord-1",
    eventType: "order.created",
    payload: { orderId: "ord-1" },
    nowMs,
    maxAttempts: 2,
  });
}

describe("MWH transactional-outbox stateless core", () => {
  it("creates, claims, and marks events as published", () => {
    const event = orderEvent();
    expect(event).toMatchObject({ status: "pending", attempt: 0, nextAttemptAtMs: 0 });

    const claim = claimOutboxEvent({
      event,
      workerId: "worker-a",
      nowMs: 10,
      claimTimeoutMs: 1000,
    });
    expect(claim).toMatchObject({
      kind: "claimed",
      event: { status: "claimed", claimedBy: "worker-a", claimedAtMs: 10 },
    });
    if (claim.kind !== "claimed") throw new Error("expected claim");

    const published = markOutboxPublished(claim.event, 20);
    expect(published).toMatchObject({ status: "published", publishedAtMs: 20 });
  });

  it("skips active claims but allows stale claim takeover", () => {
    const event = orderEvent();
    const first = claimOutboxEvent({
      event,
      workerId: "worker-a",
      nowMs: 0,
      claimTimeoutMs: 1000,
    });
    if (first.kind !== "claimed") throw new Error("expected claim");

    const active = claimOutboxEvent({
      event: first.event,
      workerId: "worker-b",
      nowMs: 999,
      claimTimeoutMs: 1000,
    });
    expect(active).toMatchObject({ kind: "skip", reason: "event is actively claimed" });

    const stale = claimOutboxEvent({
      event: first.event,
      workerId: "worker-b",
      nowMs: 1000,
      claimTimeoutMs: 1000,
    });
    expect(stale).toMatchObject({
      kind: "claimed",
      event: { claimedBy: "worker-b", claimedAtMs: 1000 },
    });
  });

  it("fails with exponential backoff and dead-letters after max attempts", () => {
    const claim = claimOutboxEvent({
      event: orderEvent(),
      workerId: "worker-a",
      nowMs: 0,
      claimTimeoutMs: 1000,
    });
    if (claim.kind !== "claimed") throw new Error("expected claim");

    const failed = failOutboxEvent({
      event: claim.event,
      nowMs: 10,
      error: "broker down",
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });
    expect(failed).toMatchObject({
      status: "failed",
      attempt: 1,
      nextAttemptAtMs: 110,
      lastError: "broker down",
    });
    expect(releaseFailedForRetry(failed, 109).status).toBe("failed");
    expect(releaseFailedForRetry(failed, 110).status).toBe("pending");

    const secondClaim = claimOutboxEvent({
      event: releaseFailedForRetry(failed, 110),
      workerId: "worker-a",
      nowMs: 110,
      claimTimeoutMs: 1000,
    });
    if (secondClaim.kind !== "claimed") throw new Error("expected second claim");
    const dead = failOutboxEvent({
      event: secondClaim.event,
      nowMs: 120,
      error: "poison",
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });
    expect(dead.status).toBe("dead-letter");
    expect(dead.nextAttemptAtMs).toBe(Number.POSITIVE_INFINITY);
    expect(retryDelayMs(3, 100, 250)).toBe(250);
    expect(summarizeOutboxEvents([failed, dead], { nowMs: 110 })).toEqual({
      pending: 0,
      claimed: 0,
      published: 0,
      failed: 1,
      deadLetter: 1,
      retryDue: 1,
      total: 2,
    });
    const cloned = cloneOutboxEvent(failed);
    (cloned.payload as { orderId: string }).orderId = "mutated";
    expect(failed.payload).toEqual({ orderId: "ord-1" });
  });
});

describe("MWH transactional-outbox stateful memory store", () => {
  it("appends, claims, and publishes events in order", () => {
    let now = 0;
    const store = new MemoryOutboxStore({ now: () => now });
    store.append({
      id: "evt-1",
      aggregateType: "order",
      aggregateId: "ord-1",
      eventType: "order.created",
      payload: { orderId: "ord-1" },
    });
    const listedBeforeClaim = store.list();
    (listedBeforeClaim[0]!.payload as { orderId: string }).orderId = "mutated";
    expect(store.get("evt-1")?.payload).toEqual({ orderId: "ord-1" });
    now = 1;
    store.append({
      id: "evt-2",
      aggregateType: "order",
      aggregateId: "ord-2",
      eventType: "order.created",
      payload: { orderId: "ord-2" },
    });

    const first = store.claimNext("worker-a");
    expect(first?.id).toBe("evt-1");
    store.publish("evt-1");
    const second = store.claimNext("worker-a");
    expect(second?.id).toBe("evt-2");
    expect(store.list("published").map((event) => event.id)).toEqual(["evt-1"]);
    expect(store.summary()).toEqual({
      pending: 0,
      claimed: 1,
      published: 1,
      failed: 0,
      deadLetter: 0,
      retryDue: 0,
      total: 2,
    });
  });

  it("delays failed events before retry and supports stale claim takeover", () => {
    let now = 0;
    const store = new MemoryOutboxStore({
      now: () => now,
      claimTimeoutMs: 100,
      baseDelayMs: 50,
      maxDelayMs: 1000,
    });
    store.append({
      id: "evt-1",
      aggregateType: "order",
      aggregateId: "ord-1",
      eventType: "order.created",
      payload: { orderId: "ord-1" },
      maxAttempts: 3,
    });

    expect(store.claimNext("worker-a")?.claimedBy).toBe("worker-a");
    store.fail("evt-1", "broker down");
    expect(store.claimNext("worker-a")).toBeNull();
    now = 50;
    expect(store.claimNext("worker-a")?.status).toBe("claimed");

    now = 60;
    expect(store.claimNext("worker-b")).toBeNull();
    now = 150;
    expect(store.claimNext("worker-b")?.claimedBy).toBe("worker-b");
  });

  it("claims batches in creation order and validates batch limits", () => {
    const store = new MemoryOutboxStore({ now: () => 1_000 });
    for (const id of ["evt-1", "evt-2", "evt-3"]) {
      store.append({
        id,
        aggregateType: "order",
        aggregateId: id,
        eventType: "order.created",
        payload: { id },
      });
    }

    expect(store.claimBatch("worker-a", 2).map((event) => event.id)).toEqual(["evt-1", "evt-2"]);
    expect(store.claimBatch("worker-a", 2).map((event) => event.id)).toEqual(["evt-3"]);
    expect(() => store.claimBatch("worker-a", 0)).toThrow("limit must be a positive integer");
  });
});
