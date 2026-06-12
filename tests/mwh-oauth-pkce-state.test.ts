import { describe, expect, it } from "vitest";
import {
  consumeOAuthState,
  createOAuthPkceState,
  failOAuthState,
  pkceCodeChallenge,
  verifyOAuthRedirect,
} from "../src/mwh/modules/auth-security/oauth-pkce-state/core.js";
import { MemoryOAuthPkceStateStore } from "../src/mwh/modules/auth-security/oauth-pkce-state/memory-store.js";

const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

describe("MWH oauth-pkce-state middleware", () => {
  it("creates S256 PKCE challenges and validates verifier input", () => {
    expect(pkceCodeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => pkceCodeChallenge("short")).toThrow("verifier length");
    expect(() => pkceCodeChallenge(`${verifier}!`)).toThrow("invalid PKCE characters");
  });

  it("creates state records and verifies redirect callbacks", () => {
    const record = createOAuthPkceState({
      state: "state-1",
      providerId: "github",
      redirectUri: "https://app.example.com/oauth/callback",
      codeVerifier: verifier,
      nowMs: 1_000,
      ttlMs: 500,
      metadata: { returnTo: "/dashboard" },
    });

    expect(record).toEqual(
      expect.objectContaining({
        state: "state-1",
        providerId: "github",
        codeChallengeMethod: "S256",
        status: "pending",
        expiresAtMs: 1_500,
      }),
    );
    expect(
      verifyOAuthRedirect(record, {
        state: "state-1",
        code: "code-1",
        redirectUri: record.redirectUri,
        nowMs: 1_200,
      }),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    expect(verifyOAuthRedirect(record, { redirectUri: record.redirectUri, nowMs: 1_200 })).toEqual({
      status: "missing-state",
    });
    expect(
      verifyOAuthRedirect(record, {
        state: "state-1",
        error: "access_denied",
        redirectUri: record.redirectUri,
        nowMs: 1_200,
      }),
    ).toEqual(expect.objectContaining({ status: "provider-error", error: "access_denied" }));
    expect(
      verifyOAuthRedirect(record, {
        state: "wrong",
        code: "code-1",
        redirectUri: record.redirectUri,
        nowMs: 1_200,
      }),
    ).toEqual({ status: "state-mismatch" });
    expect(
      verifyOAuthRedirect(record, {
        state: "state-1",
        code: "code-1",
        redirectUri: "https://evil.example.com/callback",
        nowMs: 1_200,
      }),
    ).toEqual(expect.objectContaining({ status: "redirect-uri-mismatch" }));
    expect(
      verifyOAuthRedirect(record, {
        state: "state-1",
        code: "code-1",
        redirectUri: record.redirectUri,
        nowMs: 1_600,
      }),
    ).toEqual(expect.objectContaining({ status: "expired" }));
  });

  it("runs consume and fail transitions without mutating source records", () => {
    const record = createOAuthPkceState({
      state: "state-1",
      providerId: "github",
      redirectUri: "https://app.example.com/oauth/callback",
      codeVerifier: verifier,
      nowMs: 1_000,
      ttlMs: 500,
    });

    expect(consumeOAuthState(record, { nowMs: 1_200 })).toEqual(
      expect.objectContaining({ status: "consumed", consumedAtMs: 1_200 }),
    );
    expect(record.status).toBe("pending");
    expect(failOAuthState(record, { nowMs: 1_250, reason: "provider denied" })).toEqual(
      expect.objectContaining({ status: "failed", failureReason: "provider denied" }),
    );
  });

  it("runs stateful start, duplicate rejection, verify, consume once, fail, prune, list, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryOAuthPkceStateStore({ now: () => now });
    const first = store.start({
      state: "state-1",
      providerId: "github",
      redirectUri: "https://app.example.com/oauth/callback",
      codeVerifier: verifier,
      ttlMs: 500,
      metadata: { returnTo: "/dashboard" },
    });

    expect(() =>
      store.start({
        state: "state-1",
        providerId: "github",
        redirectUri: first.redirectUri,
        codeVerifier: verifier,
        ttlMs: 500,
      }),
    ).toThrow("oauth state already exists");
    expect(
      store.verify({ state: "state-1", code: "code-1", redirectUri: first.redirectUri }),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    expect(
      store.consume({ state: "state-1", code: "code-1", redirectUri: first.redirectUri }),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    expect(
      store.consume({ state: "state-1", code: "code-1", redirectUri: first.redirectUri }),
    ).toEqual(expect.objectContaining({ status: "consumed" }));

    store.start({
      state: "state-2",
      providerId: "google",
      redirectUri: "https://app.example.com/oauth/google",
      codeVerifier: verifier,
      ttlMs: 200,
    });
    expect(store.fail("state-2", "access denied")).toEqual(
      expect.objectContaining({ status: "failed" }),
    );

    now = 1_600;
    expect(store.pruneExpired()).toBe(2);
    expect(store.list()).toEqual([]);

    const clone = first;
    clone.metadata!.returnTo = "/mutated";
    expect(store.get("state-1")).toBeUndefined();
  });
});
