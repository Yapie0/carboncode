import { describe, expect, it } from "vitest";
import {
  calculateWebhookBackoffMs,
  claimWebhookDelivery,
  cloneWebhookDelivery,
  createWebhookDelivery,
  markWebhookDelivered,
  markWebhookFailed,
  releaseExpiredWebhookClaim,
  signWebhook,
  verifyWebhookSignature,
} from "../src/mwh/modules/notification/webhook-dispatcher/core.js";
import { MemoryWebhookDispatcher } from "../src/mwh/modules/notification/webhook-dispatcher/memory-store.js";

describe("MWH webhook-dispatcher middleware", () => {
  it("signs and verifies webhook payloads with timestamped HMAC", () => {
    const body = JSON.stringify({ event: "invoice.paid", id: "evt_1" });
    const headers = signWebhook({ secret: "secret", timestampMs: 1_000, body });

    expect(headers.timestamp).toBe("1000");
    expect(headers.signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(
      verifyWebhookSignature({
        secret: "secret",
        timestampMs: 1_000,
        body,
        signature: headers.signature,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret: "wrong",
        timestampMs: 1_000,
        body,
        signature: headers.signature,
      }),
    ).toBe(false);
  });

  it("claims due deliveries and blocks other workers until the lease expires", () => {
    const payload = { id: "u1", tags: ["new"] };
    const delivery = createWebhookDelivery({
      id: "d1",
      endpointId: "ep1",
      url: "https://example.com/webhook",
      eventType: "user.created",
      payload,
      nowMs: 1_000,
    });
    payload.tags.push("mutated-source");
    expect(delivery.payload).toEqual({ id: "u1", tags: ["new"] });
    const cloned = cloneWebhookDelivery(delivery);
    (cloned.payload as { tags: string[] }).tags.push("mutated-clone");
    expect(delivery.payload).toEqual({ id: "u1", tags: ["new"] });

    const claimed = claimWebhookDelivery(delivery, {
      nowMs: 1_000,
      workerId: "worker-a",
      leaseMs: 500,
    });
    expect(claimed).toEqual(
      expect.objectContaining({
        status: "in-flight",
        claimedBy: "worker-a",
        claimExpiresAtMs: 1_500,
      }),
    );
    expect(
      claimWebhookDelivery(claimed!, {
        nowMs: 1_100,
        workerId: "worker-b",
        leaseMs: 500,
      }),
    ).toBeUndefined();

    const released = releaseExpiredWebhookClaim(claimed!, 1_600);
    expect(released).toEqual(
      expect.objectContaining({
        status: "retryable",
        claimedBy: undefined,
        availableAtMs: 1_600,
      }),
    );
    expect(
      claimWebhookDelivery(released, {
        nowMs: 1_600,
        workerId: "worker-b",
        leaseMs: 500,
      }),
    ).toEqual(expect.objectContaining({ claimedBy: "worker-b" }));
  });

  it("marks delivery success, retryable failure, and dead-letter transitions", () => {
    const delivery = claimWebhookDelivery(
      createWebhookDelivery({
        id: "d1",
        endpointId: "ep1",
        url: "https://example.com/webhook",
        eventType: "user.created",
        payload: { id: "u1" },
        nowMs: 1_000,
        maxAttempts: 2,
      }),
      { nowMs: 1_000, workerId: "worker-a", leaseMs: 500 },
    );
    if (!delivery) throw new Error("expected delivery claim");

    expect(markWebhookDelivered(delivery, { nowMs: 1_100, workerId: "worker-a" })).toEqual(
      expect.objectContaining({
        status: "delivered",
        deliveredAtMs: 1_100,
        claimedBy: undefined,
      }),
    );

    const failedOnce = markWebhookFailed(delivery, {
      nowMs: 1_100,
      workerId: "worker-a",
      error: "503",
      backoff: { baseDelayMs: 1_000, maxDelayMs: 10_000 },
    });
    expect(failedOnce).toEqual(
      expect.objectContaining({
        status: "retryable",
        attempt: 1,
        availableAtMs: 2_100,
        lastError: "503",
      }),
    );

    const failedTwice = markWebhookFailed(
      { ...failedOnce, status: "in-flight", claimedBy: "worker-a" },
      {
        nowMs: 2_200,
        workerId: "worker-a",
        error: "503 again",
        backoff: { baseDelayMs: 1_000, maxDelayMs: 10_000 },
      },
    );
    expect(failedTwice).toEqual(
      expect.objectContaining({
        status: "dead-lettered",
        attempt: 2,
        availableAtMs: 2_200,
      }),
    );
  });

  it("calculates capped exponential backoff", () => {
    expect(calculateWebhookBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculateWebhookBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculateWebhookBackoffMs(10, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);
  });

  it("runs a stateful enqueue, claim, retry, stale takeover, and completion flow", () => {
    let now = 1_000;
    const store = new MemoryWebhookDispatcher({
      now: () => now,
      defaultLeaseMs: 100,
      backoff: { baseDelayMs: 200, maxDelayMs: 1_000 },
    });

    store.enqueue({
      id: "d1",
      endpointId: "ep1",
      url: "https://example.com/webhook",
      eventType: "invoice.paid",
      payload: { invoiceId: "inv_1" },
      maxAttempts: 3,
    });
    const enqueued = store.get("d1")!;
    (enqueued.payload as { invoiceId: string }).invoiceId = "mutated";
    expect(store.get("d1")?.payload).toEqual({ invoiceId: "inv_1" });

    const firstClaim = store.claimNext("worker-a");
    expect(firstClaim).toEqual(expect.objectContaining({ id: "d1", claimedBy: "worker-a" }));
    (firstClaim!.payload as { invoiceId: string }).invoiceId = "mutated-claim";
    expect(store.get("d1")?.payload).toEqual({ invoiceId: "inv_1" });
    expect(store.claimNext("worker-b")).toBeUndefined();

    const failed = store.fail("d1", "worker-a", "503");
    expect(failed).toEqual(
      expect.objectContaining({
        status: "retryable",
        attempt: 1,
        availableAtMs: 1_200,
      }),
    );
    expect(store.claimNext("worker-b")).toBeUndefined();

    now = 1_200;
    const retryClaim = store.claimNext("worker-b");
    expect(retryClaim).toEqual(expect.objectContaining({ claimedBy: "worker-b" }));

    now = 1_350;
    const takeover = store.claimNext("worker-c");
    expect(takeover).toEqual(
      expect.objectContaining({
        claimedBy: "worker-c",
        status: "in-flight",
      }),
    );

    const delivered = store.complete("d1", "worker-c");
    expect(delivered).toEqual(expect.objectContaining({ status: "delivered" }));
    (delivered.payload as { invoiceId: string }).invoiceId = "mutated-delivered";
    expect(store.list()[0]?.payload).toEqual({ invoiceId: "inv_1" });
  });

  it("dead-letters after max attempts in the stateful store", () => {
    let now = 1_000;
    const store = new MemoryWebhookDispatcher({
      now: () => now,
      backoff: { baseDelayMs: 100, maxDelayMs: 100 },
    });

    store.enqueue({
      id: "d1",
      endpointId: "ep1",
      url: "https://example.com/webhook",
      eventType: "invoice.failed",
      payload: { invoiceId: "inv_1" },
      maxAttempts: 2,
    });

    expect(store.claimNext("worker-a")).toEqual(expect.objectContaining({ id: "d1" }));
    expect(store.fail("d1", "worker-a", "503")).toEqual(
      expect.objectContaining({ status: "retryable", attempt: 1 }),
    );

    now = 1_100;
    expect(store.claimNext("worker-a")).toEqual(expect.objectContaining({ id: "d1" }));
    expect(store.fail("d1", "worker-a", "503")).toEqual(
      expect.objectContaining({ status: "dead-lettered", attempt: 2 }),
    );
    expect(store.claimNext("worker-a")).toBeUndefined();
  });
});
