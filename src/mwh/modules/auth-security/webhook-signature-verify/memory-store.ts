import {
  type WebhookSignatureVerification,
  nonceExpiresAt,
  verifyIncomingWebhookSignature,
} from "./core.js";

export interface WebhookReplayRecord {
  key: string;
  providerId: string;
  endpointId: string;
  nonce: string;
  firstSeenAtMs: number;
  expiresAtMs: number;
}

export interface VerifyAndRememberInput {
  providerId: string;
  endpointId: string;
  secret: string;
  nowMs?: number;
  toleranceMs: number;
  body: string;
  headers: {
    timestamp?: string;
    nonce?: string;
    signature?: string;
  };
}

export class MemoryWebhookSignatureReplayStore {
  private readonly now: () => number;
  private readonly records = new Map<string, WebhookReplayRecord>();

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  verifyAndRemember(input: VerifyAndRememberInput): WebhookSignatureVerification {
    const nowMs = input.nowMs ?? this.now();
    this.pruneExpired(nowMs);
    const nonce = input.headers.nonce?.trim();
    const replayed =
      nonce !== undefined && nonce !== ""
        ? this.records.has(replayKey(input.providerId, input.endpointId, nonce))
        : false;
    const verification = verifyIncomingWebhookSignature({
      ...input,
      nowMs,
      replayed,
    });
    if (verification.status !== "valid" || !verification.parsed) return verification;

    const key = replayKey(input.providerId, input.endpointId, verification.parsed.nonce);
    this.records.set(key, {
      key,
      providerId: input.providerId,
      endpointId: input.endpointId,
      nonce: verification.parsed.nonce,
      firstSeenAtMs: nowMs,
      expiresAtMs: nonceExpiresAt({
        timestampMs: verification.parsed.timestampMs,
        toleranceMs: input.toleranceMs,
      }),
    });
    return verification;
  }

  has(input: { providerId: string; endpointId: string; nonce: string }): boolean {
    return this.records.has(replayKey(input.providerId, input.endpointId, input.nonce));
  }

  pruneExpired(nowMs: number = this.now()): number {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (nowMs >= record.expiresAtMs) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  list(): WebhookReplayRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }
}

export function replayKey(providerId: string, endpointId: string, nonce: string): string {
  assertNonEmpty(providerId, "providerId");
  assertNonEmpty(endpointId, "endpointId");
  assertNonEmpty(nonce, "nonce");
  return `${providerId}\0${endpointId}\0${nonce}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
