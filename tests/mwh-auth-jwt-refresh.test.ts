import { describe, expect, it } from "vitest";
import {
  classifyRefreshGrant,
  createRefreshGrant,
  hashRefreshToken,
  revokeRefreshGrant,
  rotateRefreshGrant,
  signAccessToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/mwh/modules/auth-security/auth-jwt-refresh/core.js";
import { MemoryJwtRefreshStore } from "../src/mwh/modules/auth-security/auth-jwt-refresh/memory-store.js";

describe("MWH auth-jwt-refresh stateless core", () => {
  it("signs, verifies, rejects tampered, and expires access JWTs", () => {
    const token = signAccessToken({
      subjectId: "user-1",
      sessionId: "session-1",
      secret: "secret",
      nowMs: 1_000,
      ttlMs: 60_000,
      scope: ["repo:read"],
    });

    expect(verifyAccessToken({ token, secret: "secret", nowMs: 30_000 })).toEqual(
      expect.objectContaining({
        valid: true,
        claims: expect.objectContaining({
          sub: "user-1",
          sessionId: "session-1",
          scope: ["repo:read"],
        }),
      }),
    );
    const tampered = `${token.split(".").slice(0, 2).join(".")}.bad`;
    expect(verifyAccessToken({ token: tampered, secret: "secret", nowMs: 30_000 })).toEqual({
      valid: false,
      reason: "signature",
    });
    expect(verifyAccessToken({ token, secret: "secret", nowMs: 61_000 })).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("hashes refresh tokens and creates expiring refresh grants", () => {
    const hash = hashRefreshToken("refresh-1");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("refresh-1");
    expect(verifyRefreshToken("refresh-1", hash)).toBe(true);

    const grant = createRefreshGrant({
      grantId: "grant-1",
      subjectId: "user-1",
      sessionId: "session-1",
      refreshToken: "refresh-1",
      nowMs: 1_000,
      ttlMs: 500,
    });
    expect(classifyRefreshGrant(grant, 1_499)).toBe("active");
    expect(classifyRefreshGrant(grant, 1_500)).toBe("expired");
  });

  it("rotates refresh grants and marks mismatches as compromised", () => {
    const grant = createRefreshGrant({
      grantId: "grant-1",
      subjectId: "user-1",
      sessionId: "session-1",
      refreshToken: "refresh-1",
      nowMs: 1_000,
      ttlMs: 5_000,
    });

    const rotated = rotateRefreshGrant(grant, {
      presentedToken: "refresh-1",
      nextGrantId: "grant-2",
      nextRefreshToken: "refresh-2",
      nowMs: 1_100,
      ttlMs: 5_000,
    });
    expect(rotated).toEqual(
      expect.objectContaining({
        decision: "rotated",
        nextRefreshToken: "refresh-2",
        grant: expect.objectContaining({ status: "rotated", rotatedAtMs: 1_100 }),
        nextGrant: expect.objectContaining({ grantId: "grant-2", status: "active" }),
      }),
    );

    const mismatch = rotateRefreshGrant(grant, {
      presentedToken: "wrong",
      nextGrantId: "grant-3",
      nextRefreshToken: "refresh-3",
      nowMs: 1_200,
      ttlMs: 5_000,
    });
    expect(mismatch).toEqual(
      expect.objectContaining({
        decision: "mismatch",
        grant: expect.objectContaining({
          status: "compromised",
          revokeReason: "refresh token mismatch or reuse",
        }),
      }),
    );
  });

  it("revokes refresh grants with an explicit reason", () => {
    const grant = createRefreshGrant({
      grantId: "grant-1",
      subjectId: "user-1",
      sessionId: "session-1",
      refreshToken: "refresh-1",
      nowMs: 1_000,
      ttlMs: 5_000,
    });

    expect(revokeRefreshGrant(grant, { nowMs: 1_200, reason: "logout" })).toEqual(
      expect.objectContaining({
        status: "revoked",
        revokedAtMs: 1_200,
        revokeReason: "logout",
      }),
    );
  });
});

describe("MWH auth-jwt-refresh stateful memory store", () => {
  it("issues, verifies, refreshes, and rejects the rotated old grant", () => {
    let now = 1_000;
    const ids = ["grant-1", "grant-2"];
    const tokens = ["refresh-1", "refresh-2"];
    const store = new MemoryJwtRefreshStore({
      secret: "secret",
      now: () => now,
      idFactory: () => ids.shift() ?? "fallback-grant",
      tokenFactory: () => tokens.shift() ?? "fallback-refresh",
      accessTtlMs: 1_000,
      refreshTtlMs: 10_000,
    });

    const issued = store.issue({
      subjectId: "user-1",
      sessionId: "session-1",
      scope: ["repo:read"],
    });
    expect(issued.refreshToken).toBe("refresh-1");
    expect(store.verifyAccess(issued.accessToken)).toEqual(
      expect.objectContaining({ valid: true, claims: expect.objectContaining({ sub: "user-1" }) }),
    );

    now = 1_500;
    const refreshed = store.refresh({
      grantId: issued.grant.grantId,
      presentedRefreshToken: "refresh-1",
      scope: ["repo:write"],
    });
    expect(refreshed).toEqual(
      expect.objectContaining({
        decision: "rotated",
        refreshToken: "refresh-2",
        grant: expect.objectContaining({ grantId: "grant-2", status: "active" }),
      }),
    );
    expect(store.get("grant-1")).toEqual(expect.objectContaining({ status: "rotated" }));
    expect(store.refresh({ grantId: "grant-1", presentedRefreshToken: "refresh-1" })).toEqual(
      expect.objectContaining({
        decision: "compromised",
        grant: expect.objectContaining({
          status: "compromised",
          revokeReason: "rotated refresh token reused",
        }),
      }),
    );
    expect(store.verifyAccess(refreshed.accessToken!)).toEqual(
      expect.objectContaining({
        valid: true,
        claims: expect.objectContaining({ scope: ["repo:write"] }),
      }),
    );
  });

  it("revokes one grant or all active grants for a session and returns clone-safe state", () => {
    let now = 1_000;
    const ids = ["grant-1", "grant-2"];
    const tokens = ["refresh-1", "refresh-2"];
    const store = new MemoryJwtRefreshStore({
      secret: "secret",
      now: () => now,
      idFactory: () => ids.shift() ?? "fallback-grant",
      tokenFactory: () => tokens.shift() ?? "fallback-refresh",
    });

    const first = store.issue({ subjectId: "user-1", sessionId: "session-1" });
    const second = store.issue({ subjectId: "user-1", sessionId: "session-1" });
    const clone = store.get(first.grant.grantId)!;
    clone.status = "compromised";
    expect(store.get(first.grant.grantId)?.status).toBe("active");

    now = 1_200;
    expect(store.revoke(first.grant.grantId, "logout")).toEqual(
      expect.objectContaining({ status: "revoked", revokeReason: "logout" }),
    );
    expect(store.revokeSession("session-1", "password changed")).toEqual([
      expect.objectContaining({ grantId: second.grant.grantId, status: "revoked" }),
    ]);
    expect(store.listBySubject("user-1").map((grant) => grant.status)).toEqual([
      "revoked",
      "revoked",
    ]);
  });
});
