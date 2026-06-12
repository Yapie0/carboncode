import { describe, expect, it } from "vitest";
import {
  applySmsProviderResult,
  calculateSmsBackoffMs,
  createSmsDeliveryRecord,
  createSmsMessage,
  estimateSmsSegments,
  isSmsDeliveryDue,
  normalizeSmsPhoneNumber,
  rescheduleSmsDelivery,
  smsDeliverySummary,
  suppressSmsDelivery,
} from "../src/mwh/modules/notification/sms-delivery-adapter/core.js";
import { MemorySmsDeliveryOutbox } from "../src/mwh/modules/notification/sms-delivery-adapter/memory-outbox.js";

describe("MWH sms-delivery-adapter middleware", () => {
  it("normalizes E.164 phone numbers and estimates GSM/Unicode segments", () => {
    expect(normalizeSmsPhoneNumber("+1 (415) 555-2671")).toBe("+14155552671");
    expect(() => normalizeSmsPhoneNumber("415-555-2671")).toThrow("phone must be an E.164 number");
    expect(estimateSmsSegments("hello")).toBe(1);
    expect(estimateSmsSegments("a".repeat(161))).toBe(2);
    expect(estimateSmsSegments("验证码".repeat(36))).toBe(2);
  });

  it("creates delivery records and applies success, retry, and dead-letter transitions", () => {
    const message = createSmsMessage({
      id: "sms-1",
      to: "+1 415 555 2671",
      body: " Your code is 123456 ",
      from: "Carbon",
      metadata: { tenant: "acme" },
    });
    expect(message).toEqual(
      expect.objectContaining({
        to: "+14155552671",
        body: "Your code is 123456",
        from: "Carbon",
        segmentCount: 1,
      }),
    );

    const record = createSmsDeliveryRecord({ message, nowMs: 1_000, maxAttempts: 2 });
    expect(isSmsDeliveryDue(record, 1_000)).toBe(true);
    expect(
      applySmsProviderResult(record, {
        nowMs: 1_010,
        result: { ok: true, providerMessageId: "provider-1" },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(
      expect.objectContaining({
        status: "sent",
        sentAtMs: 1_010,
        providerMessageId: "provider-1",
      }),
    );

    const failedOnce = applySmsProviderResult(record, {
      nowMs: 1_100,
      result: { ok: false, retryable: true, error: "rate limited" },
      backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(failedOnce).toEqual(
      expect.objectContaining({
        status: "retryable",
        attempt: 1,
        availableAtMs: 1_200,
        lastError: "rate limited",
      }),
    );
    expect(isSmsDeliveryDue(failedOnce, 1_199)).toBe(false);
    expect(isSmsDeliveryDue(failedOnce, 1_200)).toBe(true);
    expect(
      applySmsProviderResult(failedOnce, {
        nowMs: 1_250,
        result: { ok: false, retryable: false, error: "invalid destination" },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(expect.objectContaining({ status: "dead-lettered", attempt: 2 }));
  });

  it("calculates capped exponential backoff and rejects invalid delivery states", () => {
    expect(calculateSmsBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculateSmsBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculateSmsBackoffMs(8, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);

    const suppressed = createSmsDeliveryRecord({
      message: createSmsMessage({
        id: "sms-1",
        to: "+14155552671",
        body: "Hello",
      }),
      nowMs: 1_000,
      suppressedReason: "no consent",
    });
    expect(suppressed.status).toBe("suppressed");
    expect(() =>
      applySmsProviderResult(suppressed, {
        nowMs: 1_010,
        result: { ok: true },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toThrow("suppressed SMS cannot be delivered");
  });

  it("suppresses, reschedules, and summarizes delivery records without mutating input", () => {
    const message = createSmsMessage({
      id: "sms-1",
      to: "+14155552671",
      body: "Hello",
    });
    const record = createSmsDeliveryRecord({ message, nowMs: 1_000 });
    const rescheduled = rescheduleSmsDelivery(record, { nowMs: 1_000, availableAtMs: 2_000 });
    expect(record.availableAtMs).toBe(1_000);
    expect(rescheduled.availableAtMs).toBe(2_000);
    expect(isSmsDeliveryDue(rescheduled, 1_999)).toBe(false);

    const suppressed = suppressSmsDelivery(record, { nowMs: 1_100, reason: "no consent" });
    expect(suppressed).toEqual(
      expect.objectContaining({
        status: "suppressed",
        suppressedReason: "no consent",
        availableAtMs: 1_100,
      }),
    );
    expect(smsDeliverySummary([record, rescheduled, suppressed], { nowMs: 2_000 })).toEqual({
      pending: 2,
      sent: 0,
      retryable: 0,
      deadLettered: 0,
      suppressed: 1,
      due: 2,
      total: 3,
    });
    expect(() => rescheduleSmsDelivery(suppressed, { nowMs: 2_000, availableAtMs: 3_000 })).toThrow(
      "only pending or retryable SMS can be rescheduled",
    );
  });

  it("runs stateful enqueue, duplicate rejection, provider success, retry scheduling, dead-letter, non-due rejection, and clone-safe flows", async () => {
    let now = 1_000;
    const providerResults = [
      { ok: true, providerMessageId: "provider-1" },
      { ok: false, retryable: true, error: "timeout" },
      { ok: false, retryable: true, error: "timeout again" },
    ];
    const seen: string[] = [];
    const outbox = new MemorySmsDeliveryOutbox({
      now: () => now,
      backoff: { baseDelayMs: 100, maxDelayMs: 100 },
      provider: (message) => {
        seen.push(message.id);
        const result = providerResults.shift();
        if (!result) throw new Error("unexpected provider call");
        return result;
      },
    });

    const first = outbox.enqueue({
      id: "sms-1",
      to: "+14155552671",
      body: "Hello",
      maxAttempts: 2,
    });
    first.message.metadata = { mutated: "true" };
    expect(outbox.get("sms-1")?.message.metadata).toBeUndefined();
    expect(() => outbox.enqueue({ id: "sms-1", to: "+14155552671", body: "Hello" })).toThrow(
      "SMS delivery already exists",
    );
    expect(outbox.due().map((record) => record.id)).toEqual(["sms-1"]);
    expect(await outbox.deliver("sms-1")).toEqual(
      expect.objectContaining({ status: "sent", providerMessageId: "provider-1" }),
    );

    outbox.enqueue({
      id: "sms-2",
      to: "+14155552672",
      body: "Hello",
      maxAttempts: 2,
    });
    expect(await outbox.deliver("sms-2")).toEqual(
      expect.objectContaining({ status: "retryable", availableAtMs: 1_100 }),
    );
    expect(outbox.due()).toEqual([]);
    await expect(outbox.deliver("sms-2")).rejects.toThrow("SMS delivery is not due");
    now = 1_100;
    expect(await outbox.deliver("sms-2")).toEqual(
      expect.objectContaining({ status: "dead-lettered", attempt: 2 }),
    );
    expect(seen).toEqual(["sms-1", "sms-2", "sms-2"]);
  });

  it("runs stateful batch delivery, suppression, rescheduling, and summaries", async () => {
    let now = 1_000;
    const outbox = new MemorySmsDeliveryOutbox({
      now: () => now,
      provider: (message) => ({ ok: true, providerMessageId: `provider-${message.id}` }),
    });

    outbox.enqueue({ id: "sms-1", to: "+14155552671", body: "Hello" });
    outbox.enqueue({ id: "sms-2", to: "+14155552672", body: "Hello" });
    outbox.enqueue({ id: "sms-3", to: "+14155552673", body: "Hello" });

    expect(outbox.reschedule("sms-3", 2_000).availableAtMs).toBe(2_000);
    expect(outbox.suppress("sms-2", "quiet hours").status).toBe("suppressed");
    expect(outbox.summary()).toEqual({
      pending: 2,
      sent: 0,
      retryable: 0,
      deadLettered: 0,
      suppressed: 1,
      due: 1,
      total: 3,
    });

    expect(await outbox.deliverDue()).toEqual([
      expect.objectContaining({ id: "sms-1", status: "sent" }),
    ]);
    now = 2_000;
    expect(await outbox.deliverDue(1)).toEqual([
      expect.objectContaining({ id: "sms-3", status: "sent" }),
    ]);
    expect(outbox.summary().sent).toBe(2);
  });
});
