import {
  type OAuthPkceStateRecord,
  type OAuthRedirectInput,
  cloneOAuthPkceState,
  consumeOAuthState,
  createOAuthPkceState,
  failOAuthState,
  verifyOAuthRedirect,
} from "./core.js";

export class MemoryOAuthPkceStateStore {
  private readonly now: () => number;
  private readonly records = new Map<string, OAuthPkceStateRecord>();

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  start(input: {
    state: string;
    providerId: string;
    redirectUri: string;
    codeVerifier: string;
    ttlMs: number;
    metadata?: Record<string, string>;
  }): OAuthPkceStateRecord {
    if (this.records.has(input.state)) throw new Error("oauth state already exists");
    const record = createOAuthPkceState({ ...input, nowMs: this.now() });
    this.records.set(record.state, record);
    return cloneOAuthPkceState(record)!;
  }

  verify(input: OAuthRedirectInput): ReturnType<typeof verifyOAuthRedirect> {
    return verifyOAuthRedirect(input.state ? this.records.get(input.state) : undefined, {
      ...input,
      nowMs: this.now(),
    });
  }

  consume(input: OAuthRedirectInput): ReturnType<typeof verifyOAuthRedirect> {
    const verification = this.verify(input);
    if (verification.status !== "valid" || !verification.record) return verification;
    const consumed = consumeOAuthState(verification.record, { nowMs: this.now() });
    this.records.set(consumed.state, consumed);
    return { status: "valid", record: cloneOAuthPkceState(consumed) };
  }

  fail(state: string, reason: string): OAuthPkceStateRecord {
    const record = this.records.get(state);
    if (!record) throw new Error("oauth state not found");
    const failed = failOAuthState(record, { reason, nowMs: this.now() });
    this.records.set(state, failed);
    return cloneOAuthPkceState(failed)!;
  }

  pruneExpired(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [state, record] of this.records) {
      if (
        nowMs >= record.expiresAtMs ||
        record.status === "consumed" ||
        record.status === "failed"
      ) {
        this.records.delete(state);
        removed += 1;
      }
    }
    return removed;
  }

  get(state: string): OAuthPkceStateRecord | undefined {
    return cloneOAuthPkceState(this.records.get(state));
  }

  list(): OAuthPkceStateRecord[] {
    return [...this.records.values()]
      .sort(
        (left, right) =>
          left.createdAtMs - right.createdAtMs || left.state.localeCompare(right.state),
      )
      .map((record) => cloneOAuthPkceState(record)!);
  }
}
