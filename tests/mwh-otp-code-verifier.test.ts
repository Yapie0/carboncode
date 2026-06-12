import { describe, expect, it } from "vitest";
import {
  canResendOtpCode,
  classifyOtpCode,
  consumeOtpCode,
  createOtpCodeRecord,
  generateOtpCode,
  hashOtpCode,
  revokeOtpCode,
  verifyOtpCode,
  verifyOtpCodeRecord,
} from "../src/mwh/modules/auth-security/otp-code-verifier/core.js";
import { MemoryOtpCodeStore } from "../src/mwh/modules/auth-security/otp-code-verifier/memory-store.js";

describe("MWH otp-code-verifier middleware", () => {
  it("generates numeric codes, hashes them, and verifies without storing raw codes", () => {
    const code = generateOtpCode();
    const hash = hashOtpCode({ code, subjectId: "user-1", purpose: "login" });

    expect(code).toMatch(/^\d{6}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyOtpCode({ code, subjectId: "user-1", purpose: "login" }, hash)).toBe(true);
    expect(verifyOtpCode({ code, subjectId: "other", purpose: "login" }, hash)).toBe(false);
    expect(() => generateOtpCode(13)).toThrow("length must be 12 or less");
  });

  it("creates records, classifies expiry, enforces resend cooldown, tracks attempts, and locks codes", () => {
    const record = createOtpCodeRecord({
      id: "otp-1",
      subjectId: "user-1",
      channel: "sms",
      purpose: "login",
      code: "123456",
      nowMs: 1_000,
      ttlMs: 500,
      resendCooldownMs: 200,
      maxAttempts: 2,
      metadata: { requestId: "req-1" },
    });

    expect(record).toEqual(
      expect.objectContaining({
        id: "otp-1",
        subjectId: "user-1",
        status: "pending",
        attempts: 0,
        resendAfterMs: 1_200,
        expiresAtMs: 1_500,
      }),
    );
    expect(record.codeHash).not.toBe("123456");
    expect(classifyOtpCode(record, 1_200)).toBe("pending");
    expect(classifyOtpCode(record, 1_500)).toBe("expired");
    expect(canResendOtpCode(record, 1_100)).toEqual(
      expect.objectContaining({ status: "resend-not-ready", retryAfterMs: 100 }),
    );
    expect(canResendOtpCode(record, 1_200)).toEqual(expect.objectContaining({ status: "valid" }));

    const firstFailure = verifyOtpCodeRecord(record, { code: "000000", nowMs: 1_200 });
    expect(firstFailure).toEqual(
      expect.objectContaining({
        status: "code-mismatch",
        record: expect.objectContaining({ attempts: 1, status: "pending" }),
      }),
    );
    const locked = verifyOtpCodeRecord(firstFailure.record, { code: "000000", nowMs: 1_250 });
    expect(locked).toEqual(
      expect.objectContaining({
        status: "locked",
        record: expect.objectContaining({ attempts: 2, status: "locked" }),
      }),
    );
  });

  it("consumes and revokes codes without mutating source records", () => {
    const record = createOtpCodeRecord({
      id: "otp-1",
      subjectId: "user-1",
      channel: "email",
      purpose: "signup",
      code: "123456",
      nowMs: 1_000,
      ttlMs: 500,
    });

    expect(consumeOtpCode(record, { code: "123456", nowMs: 1_200 })).toEqual(
      expect.objectContaining({
        status: "valid",
        record: expect.objectContaining({ status: "consumed", consumedAtMs: 1_200 }),
      }),
    );
    expect(record.status).toBe("pending");
    expect(consumeOtpCode(record, { nowMs: 1_200 })).toEqual(
      expect.objectContaining({ status: "missing-code" }),
    );
    expect(revokeOtpCode(record, 1_250)).toEqual(
      expect.objectContaining({ status: "revoked", revokedAtMs: 1_250 }),
    );
  });

  it("runs stateful issue, duplicate rejection, verify, lockout, consume once, resend, revoke, prune, list, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryOtpCodeStore({ now: () => now });

    const issued = store.issue({
      id: "otp-1",
      subjectId: "user-1",
      channel: "sms",
      purpose: "login",
      code: "123456",
      ttlMs: 500,
      resendCooldownMs: 200,
      maxAttempts: 2,
      metadata: { requestId: "req-1" },
    });

    expect(() =>
      store.issue({
        id: "otp-1",
        subjectId: "user-1",
        channel: "sms",
        purpose: "login",
        code: "654321",
        ttlMs: 500,
      }),
    ).toThrow("OTP code already exists");
    expect(store.canResend("otp-1")).toEqual(
      expect.objectContaining({ status: "resend-not-ready", retryAfterMs: 200 }),
    );
    expect(store.verify("otp-1", "123456")).toEqual(expect.objectContaining({ status: "valid" }));
    expect(store.consume("otp-1", "123456")).toEqual(
      expect.objectContaining({
        status: "valid",
        record: expect.objectContaining({ status: "consumed" }),
      }),
    );
    expect(store.consume("otp-1", "123456")).toEqual(
      expect.objectContaining({ status: "consumed" }),
    );

    store.issue({
      id: "otp-2",
      subjectId: "user-1",
      channel: "email",
      purpose: "signup",
      code: "111111",
      ttlMs: 200,
      maxAttempts: 2,
    });
    expect(store.verify("otp-2", "000000")).toEqual(
      expect.objectContaining({
        status: "code-mismatch",
        record: expect.objectContaining({ attempts: 1 }),
      }),
    );
    expect(store.verify("otp-2", "000000")).toEqual(
      expect.objectContaining({
        status: "locked",
        record: expect.objectContaining({ status: "locked" }),
      }),
    );

    store.issue({
      id: "otp-3",
      subjectId: "user-2",
      channel: "sms",
      purpose: "login",
      code: "222222",
      ttlMs: 100,
    });
    expect(store.revoke("otp-3")).toEqual(expect.objectContaining({ status: "revoked" }));
    expect(store.list("user-1").map((record) => record.id)).toEqual(["otp-1", "otp-2"]);

    issued.record.metadata!.requestId = "mutated";
    expect(store.get("otp-1")?.metadata?.requestId).toBe("req-1");

    now = 1_600;
    expect(store.pruneExpired()).toBe(3);
    expect(store.list()).toEqual([]);
  });
});
