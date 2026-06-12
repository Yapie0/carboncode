import { describe, expect, it } from "vitest";
import {
  createWebhookSigningPayload,
  nonceExpiresAt,
  parseWebhookSignatureHeaders,
  signIncomingWebhook,
  verifyIncomingWebhookSignature,
} from "../src/mwh/modules/auth-security/webhook-signature-verify/core.js";
import {
  MemoryWebhookSignatureReplayStore,
  replayKey,
} from "../src/mwh/modules/auth-security/webhook-signature-verify/memory-store.js";

describe("MWH webhook-signature-verify middleware", () => {
  it("creates deterministic signing payloads and timestamped HMAC headers", () => {
    expect(
      createWebhookSigningPayload({
        timestampMs: 1_000,
        nonce: "nonce-1",
        body: '{"id":"evt_1"}',
      }),
    ).toBe('1000.nonce-1.{"id":"evt_1"}');

    const headers = signIncomingWebhook({
      secret: "secret",
      timestampMs: 1_000,
      nonce: "nonce-1",
      body: '{"id":"evt_1"}',
    });
    expect(headers).toEqual({
      timestamp: "1000",
      nonce: "nonce-1",
      signature: expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
    });
  });

  it("parses headers and rejects missing or malformed signature inputs", () => {
    const headers = signIncomingWebhook({
      secret: "secret",
      timestampMs: 1_000,
      nonce: "nonce-1",
      body: "{}",
    });

    expect(parseWebhookSignatureHeaders(headers)).toEqual({
      timestampMs: 1_000,
      nonce: "nonce-1",
      algorithm: "sha256",
      digest: headers.signature.slice("sha256=".length),
    });
    expect(parseWebhookSignatureHeaders({ ...headers, timestamp: undefined })).toEqual({
      error: "missing-header",
    });
    expect(parseWebhookSignatureHeaders({ ...headers, signature: "bad" })).toEqual({
      error: "invalid-format",
    });
  });

  it("verifies valid signatures and explains stale, mismatched, and replayed requests", () => {
    const headers = signIncomingWebhook({
      secret: "secret",
      timestampMs: 1_000,
      nonce: "nonce-1",
      body: '{"ok":true}',
    });

    expect(
      verifyIncomingWebhookSignature({
        secret: "secret",
        nowMs: 1_100,
        toleranceMs: 500,
        body: '{"ok":true}',
        headers,
      }),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    expect(
      verifyIncomingWebhookSignature({
        secret: "secret",
        nowMs: 2_000,
        toleranceMs: 500,
        body: '{"ok":true}',
        headers,
      }),
    ).toEqual(expect.objectContaining({ status: "timestamp-out-of-window" }));
    expect(
      verifyIncomingWebhookSignature({
        secret: "wrong",
        nowMs: 1_100,
        toleranceMs: 500,
        body: '{"ok":true}',
        headers,
      }),
    ).toEqual(expect.objectContaining({ status: "signature-mismatch" }));
    expect(
      verifyIncomingWebhookSignature({
        secret: "secret",
        nowMs: 1_100,
        toleranceMs: 500,
        body: '{"ok":true}',
        headers,
        replayed: true,
      }),
    ).toEqual(expect.objectContaining({ status: "replay" }));
  });

  it("remembers only valid nonces and rejects replay in the stateful store", () => {
    let now = 1_000;
    const store = new MemoryWebhookSignatureReplayStore({ now: () => now });
    const headers = signIncomingWebhook({
      secret: "secret",
      timestampMs: 1_000,
      nonce: "nonce-1",
      body: "{}",
    });

    expect(
      store.verifyAndRemember({
        providerId: "stripe",
        endpointId: "payments",
        secret: "secret",
        toleranceMs: 500,
        body: "{}",
        headers,
      }),
    ).toEqual(expect.objectContaining({ status: "valid" }));
    expect(store.has({ providerId: "stripe", endpointId: "payments", nonce: "nonce-1" })).toBe(
      true,
    );
    expect(
      store.verifyAndRemember({
        providerId: "stripe",
        endpointId: "payments",
        secret: "secret",
        toleranceMs: 500,
        body: "{}",
        headers,
      }),
    ).toEqual(expect.objectContaining({ status: "replay" }));

    const badHeaders = signIncomingWebhook({
      secret: "wrong",
      timestampMs: 1_000,
      nonce: "bad-nonce",
      body: "{}",
    });
    expect(
      store.verifyAndRemember({
        providerId: "stripe",
        endpointId: "payments",
        secret: "secret",
        toleranceMs: 500,
        body: "{}",
        headers: badHeaders,
      }),
    ).toEqual(expect.objectContaining({ status: "signature-mismatch" }));
    expect(store.has({ providerId: "stripe", endpointId: "payments", nonce: "bad-nonce" })).toBe(
      false,
    );

    now = 1_500;
    expect(store.pruneExpired()).toBe(1);
    expect(store.list()).toEqual([]);
  });

  it("isolates replay keys by provider and endpoint", () => {
    const store = new MemoryWebhookSignatureReplayStore({ now: () => 1_000 });
    const headers = signIncomingWebhook({
      secret: "secret",
      timestampMs: 1_000,
      nonce: "same-nonce",
      body: "{}",
    });

    expect(replayKey("github", "repo-a", "same-nonce")).toBe("github\0repo-a\0same-nonce");
    expect(
      store.verifyAndRemember({
        providerId: "github",
        endpointId: "repo-a",
        secret: "secret",
        toleranceMs: 500,
        body: "{}",
        headers,
      }).status,
    ).toBe("valid");
    expect(
      store.verifyAndRemember({
        providerId: "github",
        endpointId: "repo-b",
        secret: "secret",
        toleranceMs: 500,
        body: "{}",
        headers,
      }).status,
    ).toBe("valid");
  });

  it("calculates nonce expiry from the sender timestamp and tolerance window", () => {
    expect(nonceExpiresAt({ timestampMs: 1_000, toleranceMs: 300 })).toBe(1_300);
  });
});
