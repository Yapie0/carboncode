import { describe, expect, it } from "vitest";
import {
  calculateNotificationBackoffMs,
  createNotificationContact,
  createNotificationEnvelope,
  isNotificationDue,
  markNotificationFailed,
  markNotificationSent,
  planNotificationDeliveries,
} from "../src/mwh/modules/notification/notification-hub/core.js";
import { MemoryNotificationHub } from "../src/mwh/modules/notification/notification-hub/memory-hub.js";

describe("MWH notification-hub stateless core", () => {
  it("creates envelopes and contacts with normalized fields", () => {
    expect(
      createNotificationEnvelope({
        id: "n1",
        userId: "u1",
        type: "billing.failed",
        title: " Payment failed ",
        body: " Update card ",
        priority: "high",
        createdAtMs: 1_000,
        data: { invoiceId: "inv_1" },
      }),
    ).toEqual({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      priority: "high",
      createdAtMs: 1_000,
      data: { invoiceId: "inv_1" },
    });
    expect(
      createNotificationContact({
        userId: "u1",
        channel: "email",
        destination: " u1@example.com ",
      }),
    ).toEqual({
      userId: "u1",
      channel: "email",
      destination: "u1@example.com",
      enabled: true,
    });
  });

  it("plans per-channel deliveries and suppresses missing or disabled contacts", () => {
    const envelope = createNotificationEnvelope({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      createdAtMs: 1_000,
    });
    const deliveries = planNotificationDeliveries({
      envelope,
      channels: ["email", "push", "sms", "email"],
      contacts: [
        createNotificationContact({
          userId: "u1",
          channel: "email",
          destination: "u1@example.com",
        }),
        createNotificationContact({
          userId: "u1",
          channel: "push",
          destination: "push-token",
          enabled: false,
        }),
      ],
      nowMs: 1_000,
      maxAttempts: 2,
    });

    expect(deliveries).toEqual([
      expect.objectContaining({
        id: "n1:email",
        status: "pending",
        destination: "u1@example.com",
        maxAttempts: 2,
      }),
      expect.objectContaining({
        id: "n1:push",
        status: "suppressed",
        suppressedReason: "contact disabled",
      }),
      expect.objectContaining({
        id: "n1:sms",
        status: "suppressed",
        suppressedReason: "missing contact",
      }),
    ]);
  });

  it("marks sent, retryable failure, due state, and dead-letter transitions", () => {
    const [delivery] = planNotificationDeliveries({
      envelope: createNotificationEnvelope({
        id: "n1",
        userId: "u1",
        type: "system.notice",
        title: "Notice",
        body: "Hello",
        createdAtMs: 1_000,
      }),
      channels: ["in-app"],
      contacts: [createNotificationContact({ userId: "u1", channel: "in-app", destination: "u1" })],
      nowMs: 1_000,
      maxAttempts: 2,
    });
    if (!delivery) throw new Error("expected delivery");

    expect(isNotificationDue(delivery, 1_000)).toBe(true);
    expect(
      markNotificationSent(delivery, { nowMs: 1_050, providerMessageId: "provider-1" }),
    ).toEqual(
      expect.objectContaining({
        status: "sent",
        sentAtMs: 1_050,
        providerMessageId: "provider-1",
      }),
    );

    const failedOnce = markNotificationFailed(delivery, {
      nowMs: 1_100,
      error: "503",
      backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(failedOnce).toEqual(
      expect.objectContaining({
        status: "retryable",
        attempt: 1,
        availableAtMs: 1_200,
        lastError: "503",
      }),
    );
    expect(isNotificationDue(failedOnce, 1_199)).toBe(false);
    expect(isNotificationDue(failedOnce, 1_200)).toBe(true);

    expect(
      markNotificationFailed(failedOnce, {
        nowMs: 1_250,
        error: "503 again",
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(expect.objectContaining({ status: "dead-lettered", attempt: 2 }));
  });

  it("calculates capped exponential backoff", () => {
    expect(calculateNotificationBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculateNotificationBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculateNotificationBackoffMs(8, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);
  });
});

describe("MWH notification-hub stateful memory hub", () => {
  it("stores contacts, enqueues deliveries, sends due records, and preserves clone safety", () => {
    let now = 1_000;
    const hub = new MemoryNotificationHub({ now: () => now });
    hub.setContact({ userId: "u1", channel: "email", destination: "u1@example.com" });
    hub.setContact({ userId: "u1", channel: "in-app", destination: "u1" });

    const deliveries = hub.enqueue({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      channels: ["email", "in-app", "sms"],
    });
    deliveries[0]!.status = "dead-lettered";
    expect(hub.getDelivery("n1:email")?.status).toBe("pending");
    expect(hub.due().map((delivery) => delivery.id)).toEqual(["n1:email", "n1:in-app"]);

    now = 1_050;
    expect(hub.sent("n1:email", "provider-1")).toEqual(
      expect.objectContaining({ status: "sent", providerMessageId: "provider-1" }),
    );
    expect(hub.listDeliveries("n1").map((delivery) => delivery.status)).toEqual([
      "sent",
      "pending",
      "suppressed",
    ]);
  });

  it("retries failed deliveries and dead-letters after max attempts", () => {
    let now = 1_000;
    const hub = new MemoryNotificationHub({
      now: () => now,
      backoff: { baseDelayMs: 100, maxDelayMs: 100 },
    });
    hub.setContact({ userId: "u1", channel: "push", destination: "push-token" });
    hub.enqueue({
      id: "n1",
      userId: "u1",
      type: "system.notice",
      title: "Notice",
      body: "Hello",
      channels: ["push"],
      maxAttempts: 2,
    });

    expect(hub.failed("n1:push", "503")).toEqual(
      expect.objectContaining({ status: "retryable", attempt: 1, availableAtMs: 1_100 }),
    );
    expect(hub.due()).toEqual([]);
    now = 1_100;
    expect(hub.due()).toEqual([expect.objectContaining({ id: "n1:push" })]);
    expect(hub.failed("n1:push", "503 again")).toEqual(
      expect.objectContaining({ status: "dead-lettered", attempt: 2 }),
    );
    expect(hub.due()).toEqual([]);
  });
});
