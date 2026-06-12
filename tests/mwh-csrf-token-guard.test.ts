import { describe, expect, it } from "vitest";
import {
  consumeCsrfToken,
  createCsrfTokenRecord,
  csrfTokenSnapshot,
  generateCsrfNonce,
  hashCsrfToken,
  parseCsrfToken,
  revokeActiveSessionCsrfTokens,
  revokeCsrfToken,
  signCsrfToken,
  validateCsrfToken,
} from "../src/mwh/modules/api-traffic/csrf-token-guard/core.js";
import { MemoryCsrfTokenStore } from "../src/mwh/modules/api-traffic/csrf-token-guard/memory-store.js";

describe("MWH csrf-token-guard middleware", () => {
  it("generates signed tokens, hashes raw tokens, and creates records", () => {
    const nonce = generateCsrfNonce();
    const token = signCsrfToken({
      sessionId: "session-1",
      nonce,
      secret: "secret",
      secretId: "v1",
    });
    const record = createCsrfTokenRecord({
      id: "csrf-1",
      sessionId: "session-1",
      secretId: "v1",
      nonce,
      token,
      nowMs: 1_000,
      ttlMs: 500,
    });

    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.split(".")).toHaveLength(3);
    expect(parseCsrfToken(token)).toEqual({
      secretId: "v1",
      nonce,
      signature: expect.any(String),
    });
    expect(parseCsrfToken("bad.token")).toBeUndefined();
    expect(hashCsrfToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(record).toEqual(
      expect.objectContaining({
        id: "csrf-1",
        sessionId: "session-1",
        status: "active",
        expiresAtMs: 1_500,
      }),
    );
    expect(record.tokenHash).not.toBe(token);
  });

  it("validates stateless success, missing token, session mismatch, token mismatch, expiry, consume, and revoke", () => {
    const token = signCsrfToken({
      sessionId: "session-1",
      nonce: "nonce-1",
      secret: "secret",
      secretId: "v1",
    });
    const record = createCsrfTokenRecord({
      id: "csrf-1",
      sessionId: "session-1",
      secretId: "v1",
      nonce: "nonce-1",
      token,
      nowMs: 1_000,
      ttlMs: 500,
    });

    expect(
      validateCsrfToken(record, { sessionId: "session-1", token, secret: "secret", nowMs: 1_200 }),
    ).toEqual(expect.objectContaining({ valid: true, status: "valid" }));
    expect(
      validateCsrfToken(record, { sessionId: "session-1", secret: "secret", nowMs: 1_200 }),
    ).toEqual(expect.objectContaining({ valid: false, status: "missing-token" }));
    expect(
      validateCsrfToken(record, { sessionId: "other", token, secret: "secret", nowMs: 1_200 }),
    ).toEqual(expect.objectContaining({ valid: false, status: "session-mismatch" }));
    expect(
      validateCsrfToken(record, {
        sessionId: "session-1",
        token: "bad",
        secret: "secret",
        nowMs: 1_200,
      }),
    ).toEqual(expect.objectContaining({ valid: false, status: "token-mismatch" }));
    expect(
      validateCsrfToken(record, { sessionId: "session-1", token, secret: "secret", nowMs: 1_500 }),
    ).toEqual(expect.objectContaining({ valid: false, status: "expired" }));
    expect(
      consumeCsrfToken(record, { sessionId: "session-1", token, secret: "secret", nowMs: 1_250 }),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        record: expect.objectContaining({ status: "consumed", consumedAtMs: 1_250 }),
      }),
    );
    expect(revokeCsrfToken(record, 1_300)).toEqual(
      expect.objectContaining({ status: "revoked", revokedAtMs: 1_300 }),
    );
    expect(record.status).toBe("active");
  });

  it("revokes active session tokens and snapshots statuses without mutating records", () => {
    const active = createCsrfTokenRecord({
      id: "csrf-1",
      sessionId: "session-1",
      secretId: "v1",
      nonce: "nonce-1",
      token: signCsrfToken({
        sessionId: "session-1",
        nonce: "nonce-1",
        secret: "secret",
        secretId: "v1",
      }),
      nowMs: 1_000,
      ttlMs: 500,
    });
    const consumed = {
      ...active,
      id: "csrf-2",
      nonce: "nonce-2",
      status: "consumed" as const,
      consumedAtMs: 1_100,
    };
    const other = { ...active, id: "csrf-3", sessionId: "session-2" };

    const result = revokeActiveSessionCsrfTokens([active, consumed, other], {
      sessionId: "session-1",
      nowMs: 1_200,
    });
    expect(result.revokedIds).toEqual(["csrf-1"]);
    expect(result.records.map((record) => record.status)).toEqual([
      "revoked",
      "consumed",
      "active",
    ]);
    expect(active.status).toBe("active");
    expect(csrfTokenSnapshot(result.records)).toEqual({
      active: 1,
      consumed: 1,
      expired: 0,
      revoked: 1,
      total: 3,
    });
  });

  it("runs stateful issue, duplicate rejection, validate, consume once, expiry persistence, revoke, prune, filtering, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryCsrfTokenStore({ secret: "secret", secretId: "v1", now: () => now });
    const issued = store.issue({
      id: "csrf-1",
      sessionId: "session-1",
      ttlMs: 500,
      nonce: "nonce-1",
    });

    expect(() => store.issue({ id: "csrf-1", sessionId: "session-1", ttlMs: 500 })).toThrow(
      "CSRF token already exists",
    );
    expect(store.validate("csrf-1", { sessionId: "session-1", token: issued.token })).toEqual(
      expect.objectContaining({ valid: true, status: "valid" }),
    );
    expect(store.consume("csrf-1", { sessionId: "session-1", token: issued.token })).toEqual(
      expect.objectContaining({
        valid: true,
        record: expect.objectContaining({ status: "consumed" }),
      }),
    );
    expect(store.consume("csrf-1", { sessionId: "session-1", token: issued.token })).toEqual(
      expect.objectContaining({ valid: false, status: "consumed" }),
    );

    store.issue({ id: "csrf-2", sessionId: "session-1", ttlMs: 100, nonce: "nonce-2" });
    store.issue({ id: "csrf-3", sessionId: "session-2", ttlMs: 500, nonce: "nonce-3" });
    expect(store.list("session-1").map((record) => record.id)).toEqual(["csrf-1", "csrf-2"]);
    const clone = store.get("csrf-3")!;
    clone.status = "revoked";
    expect(store.get("csrf-3")?.status).toBe("active");

    now = 1_100;
    const token2 = signCsrfToken({
      sessionId: "session-1",
      nonce: "nonce-2",
      secret: "secret",
      secretId: "v1",
    });
    expect(store.validate("csrf-2", { sessionId: "session-1", token: token2 })).toEqual(
      expect.objectContaining({ valid: false, status: "expired" }),
    );
    expect(store.revoke("csrf-3")).toEqual(expect.objectContaining({ status: "revoked" }));
    expect(store.pruneExpired()).toBe(3);
    expect(store.list()).toEqual([]);
  });

  it("runs stateful session rotation, session revoke, and snapshots", () => {
    let now = 1_000;
    const store = new MemoryCsrfTokenStore({ secret: "secret", secretId: "v1", now: () => now });
    const first = store.issue({
      id: "csrf-1",
      sessionId: "session-1",
      ttlMs: 500,
      nonce: "nonce-1",
    });
    store.issue({ id: "csrf-2", sessionId: "session-2", ttlMs: 500, nonce: "nonce-2" });

    now = 1_100;
    const rotated = store.rotateSession({
      id: "csrf-3",
      sessionId: "session-1",
      ttlMs: 500,
      nonce: "nonce-3",
    });
    expect(rotated.revokedIds).toEqual(["csrf-1"]);
    expect(store.validate("csrf-1", { sessionId: "session-1", token: first.token })).toEqual(
      expect.objectContaining({ valid: false, status: "revoked" }),
    );
    expect(store.validate("csrf-3", { sessionId: "session-1", token: rotated.token })).toEqual(
      expect.objectContaining({ valid: true, status: "valid" }),
    );
    expect(store.snapshot()).toEqual({ active: 2, consumed: 0, expired: 0, revoked: 1, total: 3 });
    expect(store.revokeSession("session-2")).toEqual(["csrf-2"]);
    expect(store.snapshot()).toEqual({ active: 1, consumed: 0, expired: 0, revoked: 2, total: 3 });
  });
});
