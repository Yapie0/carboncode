import { describe, expect, it } from "vitest";
import {
  classifyPasswordResetToken,
  consumePasswordResetToken,
  createPasswordResetTokenRecord,
  generatePasswordResetToken,
  hashPasswordResetToken,
  revokePasswordResetToken,
  verifyPasswordResetToken,
  verifyPasswordResetTokenRecord,
} from "../src/mwh/modules/auth-security/password-reset-token/core.js";
import { MemoryPasswordResetTokenStore } from "../src/mwh/modules/auth-security/password-reset-token/memory-store.js";

describe("MWH password-reset-token middleware", () => {
  it("generates, hashes, and verifies reset tokens without exposing raw token storage", () => {
    const token = generatePasswordResetToken();
    const hash = hashPasswordResetToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyPasswordResetToken(token, hash)).toBe(true);
    expect(verifyPasswordResetToken("wrong-token", hash)).toBe(false);
    expect(() => generatePasswordResetToken(0)).toThrow("bytes must be a positive integer");
  });

  it("creates records, classifies expiry, tracks failed attempts, and locks tokens", () => {
    const record = createPasswordResetTokenRecord({
      id: "reset-1",
      subjectId: "user-1",
      token: "raw-token",
      nowMs: 1_000,
      ttlMs: 500,
      maxAttempts: 2,
      metadata: { ip: "127.0.0.1" },
    });

    expect(record).toEqual(
      expect.objectContaining({
        id: "reset-1",
        subjectId: "user-1",
        status: "pending",
        attempts: 0,
        maxAttempts: 2,
        expiresAtMs: 1_500,
      }),
    );
    expect(record.tokenHash).not.toBe("raw-token");
    expect(classifyPasswordResetToken(record, 1_200)).toBe("pending");
    expect(classifyPasswordResetToken(record, 1_500)).toBe("expired");

    const firstFailure = verifyPasswordResetTokenRecord(record, {
      token: "wrong-token",
      nowMs: 1_200,
    });
    expect(firstFailure).toEqual(
      expect.objectContaining({
        status: "token-mismatch",
        record: expect.objectContaining({ attempts: 1, status: "pending" }),
      }),
    );
    const locked = verifyPasswordResetTokenRecord(firstFailure.record, {
      token: "wrong-token",
      nowMs: 1_250,
    });
    expect(locked).toEqual(
      expect.objectContaining({
        status: "locked",
        record: expect.objectContaining({ attempts: 2, status: "locked" }),
      }),
    );
  });

  it("consumes and revokes tokens without mutating source records", () => {
    const record = createPasswordResetTokenRecord({
      id: "reset-1",
      subjectId: "user-1",
      token: "raw-token",
      nowMs: 1_000,
      ttlMs: 500,
    });

    expect(consumePasswordResetToken(record, { token: "raw-token", nowMs: 1_200 })).toEqual(
      expect.objectContaining({
        status: "valid",
        record: expect.objectContaining({ status: "consumed", consumedAtMs: 1_200 }),
      }),
    );
    expect(record.status).toBe("pending");
    expect(consumePasswordResetToken(record, { nowMs: 1_200 })).toEqual(
      expect.objectContaining({ status: "missing-token" }),
    );
    expect(revokePasswordResetToken(record, { nowMs: 1_250, reason: "user requested" })).toEqual(
      expect.objectContaining({
        status: "revoked",
        revokedAtMs: 1_250,
        reason: "user requested",
      }),
    );
  });

  it("runs stateful issue, duplicate rejection, verify, lockout, consume once, revoke, prune, list, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryPasswordResetTokenStore({ now: () => now });

    const issued = store.issue({
      id: "reset-1",
      subjectId: "user-1",
      token: "raw-token",
      ttlMs: 500,
      maxAttempts: 2,
      metadata: { requestId: "req-1" },
    });

    expect(() =>
      store.issue({
        id: "reset-1",
        subjectId: "user-1",
        token: "another-token",
        ttlMs: 500,
      }),
    ).toThrow("password reset token already exists");
    expect(store.verify("reset-1", "raw-token")).toEqual(
      expect.objectContaining({ status: "valid" }),
    );
    expect(store.consume("reset-1", "raw-token")).toEqual(
      expect.objectContaining({
        status: "valid",
        record: expect.objectContaining({ status: "consumed" }),
      }),
    );
    expect(store.consume("reset-1", "raw-token")).toEqual(
      expect.objectContaining({ status: "consumed" }),
    );

    store.issue({
      id: "reset-2",
      subjectId: "user-1",
      token: "second-token",
      ttlMs: 200,
      maxAttempts: 2,
    });
    expect(store.verify("reset-2", "wrong")).toEqual(
      expect.objectContaining({
        status: "token-mismatch",
        record: expect.objectContaining({ attempts: 1 }),
      }),
    );
    expect(store.verify("reset-2", "wrong")).toEqual(
      expect.objectContaining({
        status: "locked",
        record: expect.objectContaining({ status: "locked" }),
      }),
    );

    store.issue({
      id: "reset-3",
      subjectId: "user-2",
      token: "third-token",
      ttlMs: 100,
    });
    expect(store.revoke("reset-3", "manual revoke")).toEqual(
      expect.objectContaining({ status: "revoked", reason: "manual revoke" }),
    );
    expect(store.list("user-1").map((record) => record.id)).toEqual(["reset-1", "reset-2"]);

    issued.metadata!.requestId = "mutated";
    expect(store.get("reset-1")?.metadata?.requestId).toBe("req-1");

    now = 1_600;
    expect(store.pruneExpired()).toBe(3);
    expect(store.list()).toEqual([]);
  });
});
