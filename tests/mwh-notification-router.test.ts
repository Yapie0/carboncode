import { describe, expect, it } from "vitest";
import {
  cloneNotificationMessage,
  cloneNotificationRouteDecision,
  createNotificationDeliveries,
  createNotificationMessage,
  isQuietHour,
  markNotificationDeliveryDispatched,
  normalizePreferences,
  notificationDedupeKey,
  routeNotification,
} from "../src/mwh/modules/notification/notification-router/core.js";
import { MemoryNotificationRouter } from "../src/mwh/modules/notification/notification-router/memory-router.js";

describe("MWH notification-router middleware", () => {
  it("creates messages, normalizes preferences, and builds dedupe keys", () => {
    const channels = ["email", "in-app"] as const;
    const message = createNotificationMessage({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      priority: "high",
      createdAtMs: 1_000,
      channels: [...channels],
      dedupeKey: "invoice:1",
    });
    (channels as readonly string[] as string[]).push("push");

    expect(message).toEqual({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      priority: "high",
      createdAtMs: 1_000,
      channels: ["email", "in-app"],
      dedupeKey: "invoice:1",
    });
    const cloned = cloneNotificationMessage(message);
    cloned.channels!.push("push");
    expect(message.channels).toEqual(["email", "in-app"]);
    expect(notificationDedupeKey(message)).toBe("invoice:1");
    expect(
      normalizePreferences({
        userId: "u1",
        enabled: true,
        channels: ["email", "email", "push"],
        mutedTypes: ["marketing", "marketing"],
      }),
    ).toEqual({
      userId: "u1",
      enabled: true,
      channels: ["email", "push"],
      mutedTypes: ["marketing"],
      quietHours: undefined,
    });
  });

  it("routes to intersected channels and reports skip reasons", () => {
    const message = createNotificationMessage({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      createdAtMs: 1_000,
      channels: ["email", "webhook"],
    });

    expect(
      routeNotification({
        message,
        nowMs: 1_000,
        preferences: {
          userId: "u1",
          enabled: true,
          channels: ["email", "push"],
        },
      }),
    ).toEqual({
      messageId: "n1",
      userId: "u1",
      channels: ["email"],
      skipped: false,
      reasons: [],
    });
    const decision = routeNotification({
      message,
      nowMs: 1_000,
      preferences: {
        userId: "u1",
        enabled: true,
        channels: ["email", "push"],
      },
    });
    const clonedDecision = cloneNotificationRouteDecision(decision);
    clonedDecision.channels.push("push");
    clonedDecision.reasons.push("mutated");
    expect(decision).toEqual({
      messageId: "n1",
      userId: "u1",
      channels: ["email"],
      skipped: false,
      reasons: [],
    });
    expect(
      routeNotification({
        message,
        nowMs: 1_000,
        replayed: true,
        preferences: {
          userId: "u1",
          enabled: false,
          channels: ["email"],
          mutedTypes: ["billing.failed"],
        },
      }),
    ).toEqual({
      messageId: "n1",
      userId: "u1",
      channels: [],
      skipped: true,
      reasons: ["notifications disabled", "notification type muted", "dedupe key already routed"],
    });
  });

  it("turns route decisions into channel delivery records", () => {
    const message = createNotificationMessage({
      id: "n1",
      userId: "u1",
      type: "billing.failed",
      title: "Payment failed",
      body: "Update card",
      priority: "high",
      createdAtMs: 1_000,
      channels: ["email", "in-app"],
      dedupeKey: "invoice:1",
    });
    const decision = routeNotification({
      message,
      nowMs: 1_000,
      preferences: { userId: "u1", enabled: true, channels: ["email", "in-app"] },
    });

    const deliveries = createNotificationDeliveries({ message, decision });
    expect(deliveries).toEqual([
      expect.objectContaining({
        id: "n1:email",
        channel: "email",
        status: "pending",
        dedupeKey: "invoice:1",
      }),
      expect.objectContaining({
        id: "n1:in-app",
        channel: "in-app",
        status: "pending",
      }),
    ]);
    expect(markNotificationDeliveryDispatched(deliveries[0]!, 1_100)).toEqual(
      expect.objectContaining({ status: "dispatched", dispatchedAtMs: 1_100 }),
    );
    expect(() => markNotificationDeliveryDispatched(deliveries[0]!, 999)).toThrow(
      "dispatchedAtMs must be >= createdAtMs",
    );
    expect(
      createNotificationDeliveries({
        message,
        decision: { ...decision, skipped: true, channels: [], reasons: ["muted"] },
      }),
    ).toEqual([]);
  });

  it("detects quiet hours across same-day and overnight windows", () => {
    const tenUtc = Date.UTC(2026, 0, 1, 10);
    const twoUtc = Date.UTC(2026, 0, 1, 2);

    expect(isQuietHour(tenUtc, { startHour: 9, endHour: 17 })).toBe(true);
    expect(isQuietHour(twoUtc, { startHour: 22, endHour: 8 })).toBe(true);
    expect(isQuietHour(tenUtc, { startHour: 22, endHour: 8 })).toBe(false);
  });

  it("routes statefully with preferences, history, and dedupe replay", () => {
    let now = 1_000;
    const router = new MemoryNotificationRouter({ now: () => now, dedupeTtlMs: 500 });
    router.setPreferences({
      userId: "u1",
      enabled: true,
      channels: ["email", "in-app"],
    });

    expect(
      router.route({
        id: "n1",
        userId: "u1",
        type: "billing.failed",
        title: "Payment failed",
        body: "Update card",
        dedupeKey: "invoice:1",
      }),
    ).toEqual({
      messageId: "n1",
      userId: "u1",
      channels: ["email", "in-app"],
      skipped: false,
      reasons: [],
    });
    expect(
      router.route({
        id: "n2",
        userId: "u1",
        type: "billing.failed",
        title: "Payment failed",
        body: "Update card",
        dedupeKey: "invoice:1",
      }),
    ).toEqual(
      expect.objectContaining({
        skipped: true,
        reasons: ["dedupe key already routed"],
      }),
    );
    expect(router.listRecords()).toHaveLength(1);
    expect(router.pendingDeliveries().map((delivery) => delivery.id)).toEqual([
      "n1:email",
      "n1:in-app",
    ]);
    expect(router.pendingDeliveries("email").map((delivery) => delivery.id)).toEqual(["n1:email"]);
    const pending = router.pendingDeliveries();
    pending[0]!.status = "dispatched";
    expect(router.pendingDeliveries().map((delivery) => delivery.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(router.markDispatched("n1:email", 1_100)).toEqual(
      expect.objectContaining({ id: "n1:email", status: "dispatched" }),
    );
    expect(router.pendingDeliveries().map((delivery) => delivery.id)).toEqual(["n1:in-app"]);

    now = 1_500;
    expect(router.pruneExpired()).toBe(1);
    expect(router.listRecords()).toEqual([]);
    expect(router.listDeliveries().map((delivery) => delivery.id)).toEqual([
      "n1:email",
      "n1:in-app",
    ]);
    const deliveries = router.listDeliveries();
    deliveries[0]!.status = "pending";
    expect(router.listDeliveries()[0]?.status).toBe("dispatched");
  });

  it("defaults unknown users to in-app routing and stores skipped decisions", () => {
    const router = new MemoryNotificationRouter({ now: () => 1_000 });

    expect(
      router.route({
        id: "n1",
        userId: "unknown",
        type: "system.notice",
        title: "Notice",
        body: "Hello",
      }),
    ).toEqual({
      messageId: "n1",
      userId: "unknown",
      channels: ["in-app"],
      skipped: false,
      reasons: [],
    });
    router.setPreferences({
      userId: "muted",
      enabled: true,
      channels: ["email"],
      mutedTypes: ["system.notice"],
    });
    expect(
      router.route({
        id: "n2",
        userId: "muted",
        type: "system.notice",
        title: "Notice",
        body: "Hello",
      }),
    ).toEqual(
      expect.objectContaining({
        channels: [],
        skipped: true,
        reasons: ["notification type muted"],
      }),
    );
    expect(router.listRecords().map((record) => record.id)).toEqual(["n1", "n2"]);
  });
});
