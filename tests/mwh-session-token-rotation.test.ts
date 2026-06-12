import { describe, expect, it } from "vitest";
import {
  classifySession,
  cloneRotateSessionResult,
  cloneSessionTokenRecord,
  createSessionTokenRecord,
  hashRefreshToken,
  revokeSession,
  rotateRefreshToken,
  verifyRefreshToken,
} from "../src/mwh/modules/auth-security/session-token-rotation/core.js";
import { MemorySessionTokenStore } from "../src/mwh/modules/auth-security/session-token-rotation/memory-store.js";

describe("MWH session-token-rotation middleware", () => {
  it("hashes and verifies refresh tokens without storing raw tokens", () => {
    const hash = hashRefreshToken("refresh-a");

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("refresh-a");
    expect(verifyRefreshToken("refresh-a", hash)).toBe(true);
    expect(verifyRefreshToken("refresh-b", hash)).toBe(false);
  });

  it("creates, classifies, rotates, and expires session token records", () => {
    const record = createSessionTokenRecord({
      sessionId: "s1",
      subjectId: "u1",
      refreshToken: "r1",
      nowMs: 1_000,
      ttlMs: 500,
      absoluteTtlMs: 2_000,
    });

    expect(record).toEqual(
      expect.objectContaining({
        sessionId: "s1",
        subjectId: "u1",
        generation: 1,
        status: "active",
        expiresAtMs: 1_500,
        absoluteExpiresAtMs: 3_000,
      }),
    );
    expect(classifySession(record, 1_499)).toBe("active");
    expect(classifySession(record, 1_500)).toBe("expired");

    const rotated = rotateRefreshToken(record, {
      presentedToken: "r1",
      nextToken: "r2",
      nowMs: 1_200,
      ttlMs: 500,
    });
    expect(rotated).toEqual(
      expect.objectContaining({
        decision: "rotated",
        nextToken: "r2",
      }),
    );
    expect(rotated.record).toEqual(
      expect.objectContaining({
        generation: 2,
        issuedAtMs: 1_200,
        expiresAtMs: 1_700,
        status: "active",
      }),
    );
    expect(verifyRefreshToken("r2", rotated.record.tokenHash)).toBe(true);
    const clonedRecord = cloneSessionTokenRecord(rotated.record);
    clonedRecord.status = "revoked";
    expect(rotated.record.status).toBe("active");
    const clonedResult = cloneRotateSessionResult(rotated);
    clonedResult.record.status = "revoked";
    expect(rotated.record.status).toBe("active");
  });

  it("marks mismatched or reused refresh tokens as compromised", () => {
    const record = createSessionTokenRecord({
      sessionId: "s1",
      subjectId: "u1",
      refreshToken: "r1",
      nowMs: 1_000,
      ttlMs: 1_000,
      absoluteTtlMs: 5_000,
    });

    const rotated = rotateRefreshToken(record, {
      presentedToken: "r1",
      nextToken: "r2",
      nowMs: 1_100,
      ttlMs: 1_000,
    });
    expect(rotated.decision).toBe("rotated");

    const reused = rotateRefreshToken(rotated.record, {
      presentedToken: "r1",
      nextToken: "r3",
      nowMs: 1_200,
      ttlMs: 1_000,
    });
    expect(reused).toEqual(
      expect.objectContaining({
        decision: "mismatch",
      }),
    );
    expect(reused.record).toEqual(
      expect.objectContaining({
        status: "compromised",
        revokeReason: "refresh token reuse or mismatch",
      }),
    );
  });

  it("revokes active sessions with an explicit reason", () => {
    const record = createSessionTokenRecord({
      sessionId: "s1",
      subjectId: "u1",
      refreshToken: "r1",
      nowMs: 1_000,
      ttlMs: 1_000,
      absoluteTtlMs: 5_000,
    });

    expect(revokeSession(record, { nowMs: 1_200, reason: "logout" })).toEqual(
      expect.objectContaining({
        status: "revoked",
        revokedAtMs: 1_200,
        revokeReason: "logout",
      }),
    );
  });

  it("runs a stateful create, rotate, reuse-detect, revoke, and list flow", () => {
    let now = 1_000;
    const tokens = ["r1", "r2", "r3"];
    const store = new MemorySessionTokenStore({
      now: () => now,
      idFactory: () => "s1",
      tokenFactory: () => tokens.shift() ?? "fallback",
      refreshTtlMs: 500,
      absoluteTtlMs: 2_000,
    });

    const created = store.create("u1");
    expect(created.refreshToken).toBe("r1");
    expect(created.record).toEqual(expect.objectContaining({ sessionId: "s1", generation: 1 }));
    created.record.status = "revoked";
    expect(store.get("s1")?.status).toBe("active");

    now = 1_100;
    const rotated = store.rotate("s1", "r1");
    expect(rotated).toEqual(
      expect.objectContaining({
        decision: "rotated",
        nextToken: "r2",
      }),
    );
    rotated.record.status = "revoked";
    expect(store.get("s1")).toEqual(expect.objectContaining({ generation: 2, status: "active" }));
    expect(store.get("s1")).toEqual(expect.objectContaining({ generation: 2 }));

    const reused = store.rotate("s1", "r1");
    expect(reused).toEqual(expect.objectContaining({ decision: "mismatch" }));
    expect(store.get("s1")).toEqual(expect.objectContaining({ status: "compromised" }));

    const sessions = store.listBySubject("u1");
    expect(sessions).toHaveLength(1);
    sessions[0]!.status = "active";
    expect(store.get("s1")?.status).toBe("compromised");
    const revoked = store.revoke("s1", "admin forced logout");
    expect(revoked).toEqual(
      expect.objectContaining({
        status: "revoked",
        revokeReason: "admin forced logout",
      }),
    );
    revoked.status = "active";
    expect(store.get("s1")?.status).toBe("revoked");
  });

  it("caps sliding refresh expiry at the absolute session expiry", () => {
    const record = createSessionTokenRecord({
      sessionId: "s1",
      subjectId: "u1",
      refreshToken: "r1",
      nowMs: 1_000,
      ttlMs: 1_000,
      absoluteTtlMs: 1_500,
    });

    const rotated = rotateRefreshToken(record, {
      presentedToken: "r1",
      nextToken: "r2",
      nowMs: 1_900,
      ttlMs: 1_000,
    });
    expect(rotated).toEqual(expect.objectContaining({ decision: "rotated" }));
    expect(rotated.record.expiresAtMs).toBe(2_500);
    expect(rotated.record.absoluteExpiresAtMs).toBe(2_500);
  });
});
