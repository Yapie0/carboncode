import { describe, expect, it } from "vitest";
import {
  applyEmailProviderResult,
  calculateEmailBackoffMs,
  createEmailDeliveryRecord,
  createEmailMessage,
  emailDeliverySummary,
  isEmailDeliveryDue,
  normalizeEmailRecipients,
  renderEmailTemplate,
  rescheduleEmailDelivery,
  suppressEmailDelivery,
} from "../src/mwh/modules/notification/email-delivery-adapter/core.js";
import { MemoryEmailDeliveryOutbox } from "../src/mwh/modules/notification/email-delivery-adapter/memory-outbox.js";

describe("MWH email-delivery-adapter middleware", () => {
  it("renders templates, keeps missing variables visible, and normalizes recipients", () => {
    expect(
      renderEmailTemplate(
        {
          id: "reset",
          subject: "Reset password for {{ name }}",
          text: "Use {{ link }}. Missing {{ code }}.",
          html: '<a href="{{ link }}">Reset</a>',
        },
        { name: "Ada", link: "https://example.com/reset" },
      ),
    ).toEqual({
      subject: "Reset password for Ada",
      text: "Use https://example.com/reset. Missing {{ code }}.",
      html: '<a href="https://example.com/reset">Reset</a>',
    });
    expect(normalizeEmailRecipients([" User@Example.com ", "user@example.com"])).toEqual([
      "user@example.com",
    ]);
    expect(() => normalizeEmailRecipients("not-email")).toThrow("to must be a valid email");
  });

  it("creates delivery records and applies success, retry, and dead-letter transitions", () => {
    const message = createEmailMessage({
      id: "email-1",
      to: ["USER@example.com", "team@example.com"],
      subject: " Hello ",
      text: " Body ",
      from: "Noreply@Example.com",
      metadata: { tenant: "acme" },
    });
    expect(message).toEqual(
      expect.objectContaining({
        to: ["user@example.com", "team@example.com"],
        subject: "Hello",
        text: "Body",
        from: "noreply@example.com",
      }),
    );

    const record = createEmailDeliveryRecord({ message, nowMs: 1_000, maxAttempts: 2 });
    expect(isEmailDeliveryDue(record, 1_000)).toBe(true);
    expect(
      applyEmailProviderResult(record, {
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

    const failedOnce = applyEmailProviderResult(record, {
      nowMs: 1_100,
      result: { ok: false, retryable: true, error: "timeout" },
      backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(failedOnce).toEqual(
      expect.objectContaining({
        status: "retryable",
        attempt: 1,
        availableAtMs: 1_200,
        lastError: "timeout",
      }),
    );
    expect(isEmailDeliveryDue(failedOnce, 1_199)).toBe(false);
    expect(isEmailDeliveryDue(failedOnce, 1_200)).toBe(true);
    expect(
      applyEmailProviderResult(failedOnce, {
        nowMs: 1_250,
        result: { ok: false, retryable: false, error: "blocked" },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toEqual(expect.objectContaining({ status: "dead-lettered", attempt: 2 }));
  });

  it("calculates capped exponential backoff and rejects invalid delivery states", () => {
    expect(calculateEmailBackoffMs(1, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(100);
    expect(calculateEmailBackoffMs(3, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(400);
    expect(calculateEmailBackoffMs(8, { baseDelayMs: 100, maxDelayMs: 1_000 })).toBe(1_000);

    const suppressed = createEmailDeliveryRecord({
      message: createEmailMessage({
        id: "email-1",
        to: "user@example.com",
        subject: "Hello",
        text: "Body",
      }),
      nowMs: 1_000,
      suppressedReason: "unsubscribed",
    });
    expect(suppressed.status).toBe("suppressed");
    expect(() =>
      applyEmailProviderResult(suppressed, {
        nowMs: 1_010,
        result: { ok: true },
        backoff: { baseDelayMs: 100, maxDelayMs: 1_000 },
      }),
    ).toThrow("suppressed email cannot be delivered");
    expect(() => suppressEmailDelivery(suppressed, { nowMs: 1_020, reason: "" })).toThrow(
      "reason is required",
    );
    expect(emailDeliverySummary([suppressed], { nowMs: 1_000 })).toEqual({
      pending: 0,
      sent: 0,
      retryable: 0,
      deadLettered: 0,
      suppressed: 1,
      due: 0,
      total: 1,
    });
  });

  it("suppresses and reschedules pending delivery records", () => {
    const record = createEmailDeliveryRecord({
      message: createEmailMessage({
        id: "email-1",
        to: "user@example.com",
        subject: "Hello",
        text: "Body",
      }),
      nowMs: 1_000,
    });
    expect(rescheduleEmailDelivery(record, { nowMs: 1_000, availableAtMs: 1_500 })).toEqual(
      expect.objectContaining({ availableAtMs: 1_500 }),
    );
    expect(() => rescheduleEmailDelivery(record, { nowMs: 1_000, availableAtMs: 999 })).toThrow(
      "availableAtMs must be >= nowMs",
    );
    expect(suppressEmailDelivery(record, { nowMs: 1_100, reason: "unsubscribed" })).toEqual(
      expect.objectContaining({ status: "suppressed", suppressedReason: "unsubscribed" }),
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
    const outbox = new MemoryEmailDeliveryOutbox({
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
      id: "email-1",
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
      maxAttempts: 2,
    });
    first.message.to.push("mutated@example.com");
    expect(outbox.get("email-1")?.message.to).toEqual(["user@example.com"]);
    expect(() =>
      outbox.enqueue({ id: "email-1", to: "user@example.com", subject: "Hello", text: "Body" }),
    ).toThrow("email delivery already exists");
    expect(outbox.due().map((record) => record.id)).toEqual(["email-1"]);
    expect(await outbox.deliver("email-1")).toEqual(
      expect.objectContaining({ status: "sent", providerMessageId: "provider-1" }),
    );

    outbox.enqueue({
      id: "email-2",
      to: "user@example.com",
      subject: "Hello",
      text: "Body",
      maxAttempts: 2,
    });
    expect(await outbox.deliver("email-2")).toEqual(
      expect.objectContaining({ status: "retryable", availableAtMs: 1_100 }),
    );
    expect(outbox.due()).toEqual([]);
    await expect(outbox.deliver("email-2")).rejects.toThrow("email delivery is not due");
    now = 1_100;
    expect(await outbox.deliver("email-2")).toEqual(
      expect.objectContaining({ status: "dead-lettered", attempt: 2 }),
    );
    expect(seen).toEqual(["email-1", "email-2", "email-2"]);
  });

  it("runs stateful deliverDue, suppress, reschedule, and summary flows", async () => {
    let now = 1_000;
    const outbox = new MemoryEmailDeliveryOutbox({
      now: () => now,
      provider: (message) => ({ ok: true, providerMessageId: `provider-${message.id}` }),
    });
    outbox.enqueue({ id: "email-1", to: "a@example.com", subject: "A", text: "A" });
    outbox.enqueue({ id: "email-2", to: "b@example.com", subject: "B", text: "B" });
    outbox.enqueue({ id: "email-3", to: "c@example.com", subject: "C", text: "C" });

    expect(outbox.reschedule("email-3", 1_500)).toEqual(
      expect.objectContaining({ availableAtMs: 1_500 }),
    );
    expect(outbox.suppress("email-2", "unsubscribed")).toEqual(
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
    expect((await outbox.deliverDue()).map((record) => record.id)).toEqual(["email-1"]);
    now = 1_500;
    expect((await outbox.deliverDue()).map((record) => record.id)).toEqual(["email-3"]);
    expect(outbox.summary()).toEqual({
      pending: 0,
      sent: 2,
      retryable: 0,
      deadLettered: 0,
      suppressed: 1,
      due: 0,
      total: 3,
    });
  });
});
