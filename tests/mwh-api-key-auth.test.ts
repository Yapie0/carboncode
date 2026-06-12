import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  authenticateApiKey,
  classifyApiKey,
  createApiKeyRecord,
  hashApiKey,
  revokeApiKey,
  rotateApiKey,
  scopeAllowed,
  setApiKeyEnabled,
  verifyApiKey,
  wildcardScopeMatches,
} from "../src/mwh/modules/auth-security/api-key-auth/core.js";
import { MemoryApiKeyStore } from "../src/mwh/modules/auth-security/api-key-auth/memory-store.js";

describe("MWH api-key-auth middleware", () => {
  it("hashes, prefixes, and verifies API keys without storing raw secrets", () => {
    const record = createApiKeyRecord({
      id: "key-1",
      ownerId: "svc-1",
      rawKey: "cc_live_secret_123",
      scopes: ["invoice:*", "customer:read"],
      nowMs: 1_000,
      expiresAtMs: 2_000,
    });

    expect(apiKeyPrefix("cc_live_secret_123")).toBe("cc_live_");
    expect(record).toEqual(
      expect.objectContaining({
        id: "key-1",
        ownerId: "svc-1",
        prefix: "cc_live_",
        scopes: ["invoice:*", "customer:read"],
        status: "active",
        createdAtMs: 1_000,
        expiresAtMs: 2_000,
      }),
    );
    expect(record.keyHash).toBe(hashApiKey("cc_live_secret_123"));
    expect(record.keyHash).not.toContain("secret");
    expect(verifyApiKey("cc_live_secret_123", record.keyHash)).toBe(true);
    expect(verifyApiKey("wrong", record.keyHash)).toBe(false);
  });

  it("matches wildcard scopes and authenticates active records", () => {
    const record = createApiKeyRecord({
      id: "key-1",
      ownerId: "svc-1",
      rawKey: "secret",
      scopes: ["invoice:*", "customer:read"],
      nowMs: 1_000,
    });

    expect(wildcardScopeMatches("invoice:*", "invoice:write")).toBe(true);
    expect(scopeAllowed(record.scopes, "customer:read")).toBe(true);
    expect(scopeAllowed(record.scopes, "customer:write")).toBe(false);
    expect(
      authenticateApiKey(record, {
        rawKey: "secret",
        requiredScope: "invoice:write",
        nowMs: 1_100,
      }),
    ).toEqual({
      allowed: true,
      status: "active",
      keyId: "key-1",
      ownerId: "svc-1",
      reason: "api key accepted",
    });
    expect(
      authenticateApiKey(record, {
        rawKey: "secret",
        requiredScope: "admin:write",
        nowMs: 1_100,
      }),
    ).toEqual(expect.objectContaining({ allowed: false, status: "scope-denied" }));
  });

  it("classifies disabled, revoked, expired, and mismatched keys", () => {
    const active = createApiKeyRecord({
      id: "key-1",
      ownerId: "svc-1",
      rawKey: "secret",
      scopes: ["*"],
      nowMs: 1_000,
      expiresAtMs: 1_500,
    });

    expect(classifyApiKey(active, 1_499)).toBe("active");
    expect(classifyApiKey(active, 1_500)).toBe("expired");
    expect(authenticateApiKey(active, { rawKey: "wrong", nowMs: 1_100 })).toEqual(
      expect.objectContaining({ allowed: false, status: "mismatch" }),
    );
    expect(
      authenticateApiKey(setApiKeyEnabled(active, false), { rawKey: "secret", nowMs: 1_100 }),
    ).toEqual(expect.objectContaining({ allowed: false, status: "disabled" }));
    expect(
      authenticateApiKey(revokeApiKey(active, { nowMs: 1_100, reason: "leaked" }), {
        rawKey: "secret",
        nowMs: 1_200,
      }),
    ).toEqual(expect.objectContaining({ allowed: false, status: "revoked" }));
  });

  it("rotates a record to a new secret and clears revoke state", () => {
    const revoked = revokeApiKey(
      createApiKeyRecord({
        id: "key-1",
        ownerId: "svc-1",
        rawKey: "old",
        scopes: ["read"],
        nowMs: 1_000,
      }),
      { nowMs: 1_100, reason: "rotation" },
    );
    const rotated = rotateApiKey(revoked, { rawKey: "new", nowMs: 1_200 });

    expect(authenticateApiKey(rotated, { rawKey: "old", nowMs: 1_300 })).toEqual(
      expect.objectContaining({ allowed: false, status: "mismatch" }),
    );
    expect(authenticateApiKey(rotated, { rawKey: "new", nowMs: 1_300 })).toEqual(
      expect.objectContaining({ allowed: true, status: "active" }),
    );
    expect(rotated.revokedAtMs).toBeUndefined();
    expect(rotated.revokeReason).toBeUndefined();
  });

  it("runs a stateful create, authenticate, disable, revoke, and owner-list flow", () => {
    let now = 1_000;
    const store = new MemoryApiKeyStore({ now: () => now });
    store.create({
      id: "key-1",
      ownerId: "svc-1",
      rawKey: "secret-1",
      scopes: ["invoice:*"],
    });
    store.create({
      id: "key-2",
      ownerId: "svc-2",
      rawKey: "secret-2",
      scopes: ["customer:read"],
    });

    now = 1_100;
    expect(store.authenticate("secret-1", "invoice:read")).toEqual(
      expect.objectContaining({ allowed: true, keyId: "key-1" }),
    );
    expect(store.get("key-1")?.lastUsedAtMs).toBe(1_100);
    expect(store.authenticate("secret-1", "admin:read")).toEqual(
      expect.objectContaining({ allowed: false, status: "scope-denied" }),
    );

    store.setEnabled("key-1", false);
    expect(store.authenticate("secret-1", "invoice:read")).toEqual(
      expect.objectContaining({ allowed: false, status: "disabled" }),
    );
    store.revoke("key-2", "owner requested");
    expect(store.authenticate("secret-2", "customer:read")).toEqual(
      expect.objectContaining({ allowed: false, status: "revoked" }),
    );
    expect(store.list("svc-1").map((record) => record.id)).toEqual(["key-1"]);
  });

  it("runs a stateful rotate and expiry flow", () => {
    let now = 1_000;
    const store = new MemoryApiKeyStore({ now: () => now });
    store.create({
      id: "key-1",
      ownerId: "svc-1",
      rawKey: "old-secret",
      scopes: ["*"],
      expiresAtMs: 2_000,
    });

    now = 1_200;
    store.rotate("key-1", "new-secret", 1_500);
    expect(store.authenticate("old-secret", "anything")).toEqual(
      expect.objectContaining({ allowed: false, status: "not-found" }),
    );
    expect(store.authenticate("new-secret", "anything")).toEqual(
      expect.objectContaining({ allowed: true, status: "active" }),
    );

    now = 1_500;
    expect(store.authenticate("new-secret", "anything")).toEqual(
      expect.objectContaining({ allowed: false, status: "expired" }),
    );
  });
});
