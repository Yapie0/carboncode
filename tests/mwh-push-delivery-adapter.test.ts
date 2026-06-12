import { describe, expect, it } from "vitest";
import {
  applyPushProviderResult,
  calculatePushBackoffMs,
  createPushDeliveryRecord,
  createPushMessage,
  createPushTarget,
  expirePushDelivery,
  isPushDeliveryDue,
  planPushMessages,
  pushDeliverySummary,
  reschedulePushDelivery,
  suppressPushDelivery,
} from "../src/mwh/modules/notification/push-delivery-adapter/core.js";
import { MemoryPushDeliveryOutbox } from "../src/mwh/modules/notification/push-delivery-adapter/memory-outbox.js";

describe("MWH push-delivery-adapter middleware", () => {
  it("creates targets, plans push messages, and normalizes payload data", () => {
    const targets = [
      createPushTarget({ userId: "u1", platform: "fcm", token: " fcm-token " }),
      createPushTarget({ userId: "u1", platform: "apns", token: "apns-token", enabled: false }),
      createPushTarget({ userId: "u2", platform: "web", token: "web-token" }),
    ];

    expect(targets[0]).toEqual({
      userId: "u1",
      platform: "fcm",
      token: "fcm-token",
      enabled: true,
    });
    expect(
      planPushMessages({
        id: "push-1",
        userId: "u1",
        title: " Build finished ",
        body: " Deploy is live ",
        targets,
        data: { build: 42, ok: true },
        collapseKey: "deploy-status",
        ttlMs: 500,
      }),
    ).toEqual([
      expect.objectContaining({
        id: "push-1:fcm:0",
        platform: "fcm",
        token: "fcm-token",
        title: "Build finished",
        body: "Deploy is live",
        data: { build: "42", ok: "true" },
        collapseKey: "deploy-status",
        ttlMs: 500,
      }),
    ]);
  });

  it("applies success, retry, invalid-token dead-letter, and TTL expiry transitions", () => {
    const message = createPushMessage({
      id: "push-1:fcm:0",
      userId: "u1",
      platform: "fcm",
      token: "token-1",
      title: "Title",
      body: "Body",
      ttlMs: 500,
    });
    const record = createPushDeliveryRecord({ message, nowMs: 1_000, maxAttempts: 2 });

    expect(isPushDeliveryDue(record, 1_000)).toBe(true);
    expect(
      applyPushProviderResult(record, {
        nowMs: 1_010,
        result: { ok: true, providerMessageId: "provider-1" },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(expect.objectContaining({ status: "sent", providerMessageId: "provider-1" }));

    const failedOnce = applyPushProviderResult(record, {
      nowMs: 1_100,
      result: { ok: false, retryable: true, error: "503" },
      backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(failedOnce).toEqual(
      expect.objectContaining({ status: "retryable", attempt: 1, availableAtMs: 1_200 }),
    );
    expect(isPushDeliveryDue(failedOnce, 1_199)).toBe(false);
    expect(isPushDeliveryDue(failedOnce, 1_200)).toBe(true);
    expect(
      applyPushProviderResult(failedOnce, {
        nowMs: 1_250,
        result: { ok: false, invalidToken: true, error: "invalid token" },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(expect.objectContaining({ status: "dead-lettered", attempt: 2 }));

    expect(isPushDeliveryDue(record, 1_500)).toBe(false);
    expect(expirePushDelivery(record, 1_500)).toEqual(
      expect.objectContaining({ status: "dead-lettered", lastError: "push TTL expired" }),
    );
  });

  it("calculates capped exponential backoff and rejects suppressed deliveries", () => {
    expect(calculatePushBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculatePushBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculatePushBackoffMs(8, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);

    const suppressed = createPushDeliveryRecord({
      message: createPushMessage({
        id: "push-1:web:0",
        userId: "u1",
        platform: "web",
        token: "token",
        title: "Title",
        body: "Body",
      }),
      nowMs: 1_000,
      suppressedReason: "missing consent",
    });
    expect(() =>
      applyPushProviderResult(suppressed, {
        nowMs: 1_010,
        result: { ok: true },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toThrow("suppressed push cannot be delivered");
    expect(pushDeliverySummary([suppressed], { nowMs: 1_000 })).toEqual({
      pending: 0,
      sent: 0,
      retryable: 0,
      deadLettered: 0,
      suppressed: 1,
      due: 0,
      total: 1,
    });
  });

  it("suppresses and reschedules pending push records", () => {
    const record = createPushDeliveryRecord({
      message: createPushMessage({
        id: "push-1:web:0",
        userId: "u1",
        platform: "web",
        token: "token",
        title: "Title",
        body: "Body",
      }),
      nowMs: 1_000,
    });

    expect(reschedulePushDelivery(record, { nowMs: 1_000, availableAtMs: 1_500 })).toEqual(
      expect.objectContaining({ availableAtMs: 1_500 }),
    );
    expect(() => reschedulePushDelivery(record, { nowMs: 1_000, availableAtMs: 999 })).toThrow(
      "availableAtMs must be >= nowMs",
    );
    expect(suppressPushDelivery(record, { nowMs: 1_100, reason: "disabled target" })).toEqual(
      expect.objectContaining({ status: "suppressed", suppressedReason: "disabled target" }),
    );
  });

  it("runs stateful target storage, enqueue, provider success, retry, TTL expiry, missing-target suppression, and clone-safe flows", async () => {
    let now = 1_000;
    const providerResults = [
      { ok: true, providerMessageId: "provider-1" },
      { ok: false, retryable: true, error: "timeout" },
      { ok: false, invalidToken: true, error: "invalid token" },
    ];
    const seen: string[] = [];
    const outbox = new MemoryPushDeliveryOutbox({
      now: () => now,
      backoff: { baseDelayMs: 100, maxDelayMs: 100 },
      provider: (message) => {
        seen.push(message.id);
        const result = providerResults.shift();
        if (!result) throw new Error("unexpected provider call");
        return result;
      },
    });
    outbox.setTarget({ userId: "u1", platform: "fcm", token: "token-1" });

    const [first] = outbox.enqueue({
      id: "push-1",
      userId: "u1",
      title: "Title",
      body: "Body",
      data: { count: 1 },
      maxAttempts: 2,
    });
    if (!first) throw new Error("expected first push record");
    first.message.data!.count = "mutated";
    expect(outbox.get(first.id)?.message.data).toEqual({ count: "1" });
    expect(await outbox.deliver(first.id)).toEqual(
      expect.objectContaining({ status: "sent", providerMessageId: "provider-1" }),
    );

    const [second] = outbox.enqueue({
      id: "push-2",
      userId: "u1",
      title: "Title",
      body: "Body",
      ttlMs: 500,
      maxAttempts: 2,
    });
    if (!second) throw new Error("expected second push record");
    expect(await outbox.deliver(second.id)).toEqual(
      expect.objectContaining({ status: "retryable", availableAtMs: 1_100 }),
    );
    await expect(outbox.deliver(second.id)).rejects.toThrow("push delivery is not due");
    now = 1_100;
    expect(await outbox.deliver(second.id)).toEqual(
      expect.objectContaining({ status: "dead-lettered", lastError: "invalid token" }),
    );

    const [missing] = outbox.enqueue({
      id: "push-3",
      userId: "missing",
      title: "Title",
      body: "Body",
    });
    expect(missing).toEqual(
      expect.objectContaining({ status: "suppressed", suppressedReason: "missing target" }),
    );

    const [expiring] = outbox.enqueue({
      id: "push-4",
      userId: "u1",
      title: "Title",
      body: "Body",
      ttlMs: 50,
    });
    if (!expiring) throw new Error("expected expiring push record");
    now = 1_200;
    expect(outbox.due().map((record) => record.id)).not.toContain(expiring.id);
    expect(outbox.get(expiring.id)).toEqual(
      expect.objectContaining({ status: "dead-lettered", lastError: "push TTL expired" }),
    );
    expect(seen).toEqual(["push-1:fcm:0", "push-2:fcm:0", "push-2:fcm:0"]);
  });

  it("runs stateful deliverDue, suppress, reschedule, disable target, and summary flows", async () => {
    let now = 1_000;
    const outbox = new MemoryPushDeliveryOutbox({
      now: () => now,
      provider: (message) => ({ ok: true, providerMessageId: `provider-${message.id}` }),
    });
    outbox.setTarget({ userId: "u1", platform: "fcm", token: "token-1" });
    const [first] = outbox.enqueue({ id: "push-1", userId: "u1", title: "One", body: "Body" });
    const [second] = outbox.enqueue({ id: "push-2", userId: "u1", title: "Two", body: "Body" });
    const [third] = outbox.enqueue({ id: "push-3", userId: "u1", title: "Three", body: "Body" });
    if (!first || !second || !third) throw new Error("expected push records");

    expect(outbox.reschedule(third.id, 1_500)).toEqual(
      expect.objectContaining({ availableAtMs: 1_500 }),
    );
    expect(outbox.suppress(second.id, "user disabled notifications")).toEqual(
      expect.objectContaining({ status: "suppressed" }),
    );
    expect(outbox.summary()).toEqual({
      pending: 2,
      sent: 0,
      retryable: 0,
      deadLettered: 0,
      suppressed: 1,
      due: 1,
      total: 3,
    });
    expect((await outbox.deliverDue()).map((record) => record.id)).toEqual([first.id]);
    now = 1_500;
    expect((await outbox.deliverDue()).map((record) => record.id)).toEqual([third.id]);
    expect(outbox.disableTarget({ userId: "u1", platform: "fcm", token: "token-1" })).toBe(true);
    expect(outbox.enqueue({ id: "push-4", userId: "u1", title: "Four", body: "Body" })[0]).toEqual(
      expect.objectContaining({ status: "suppressed", suppressedReason: "missing target" }),
    );
  });
});
