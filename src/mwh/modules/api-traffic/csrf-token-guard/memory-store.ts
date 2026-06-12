import {
  type CsrfTokenRecord,
  cloneCsrfToken,
  consumeCsrfToken,
  createCsrfTokenRecord,
  csrfTokenSnapshot,
  generateCsrfNonce,
  revokeActiveSessionCsrfTokens,
  revokeCsrfToken,
  signCsrfToken,
  validateCsrfToken,
} from "./core.js";

export class MemoryCsrfTokenStore {
  private readonly now: () => number;
  private readonly secret: string;
  private readonly secretId: string;
  private readonly records = new Map<string, CsrfTokenRecord>();

  constructor(input: { secret: string; secretId?: string; now?: () => number }) {
    this.secret = input.secret;
    this.secretId = input.secretId ?? "default";
    this.now = input.now ?? Date.now;
  }

  issue(input: { id: string; sessionId: string; ttlMs: number; nonce?: string }): {
    token: string;
    record: CsrfTokenRecord;
  } {
    if (this.records.has(input.id)) throw new Error("CSRF token already exists");
    const nonce = input.nonce ?? generateCsrfNonce();
    const token = signCsrfToken({
      sessionId: input.sessionId,
      nonce,
      secret: this.secret,
      secretId: this.secretId,
    });
    const record = createCsrfTokenRecord({
      id: input.id,
      sessionId: input.sessionId,
      secretId: this.secretId,
      nonce,
      token,
      nowMs: this.now(),
      ttlMs: input.ttlMs,
    });
    this.records.set(record.id, record);
    return { token, record: cloneCsrfToken(record)! };
  }

  validate(
    id: string,
    input: { sessionId: string; token?: string },
  ): ReturnType<typeof validateCsrfToken> {
    const result = validateCsrfToken(this.records.get(id), {
      ...input,
      secret: this.secret,
      nowMs: this.now(),
    });
    if (result.record?.status === "expired") this.records.set(result.record.id, result.record);
    return result;
  }

  consume(
    id: string,
    input: { sessionId: string; token?: string },
  ): ReturnType<typeof consumeCsrfToken> {
    const record = this.records.get(id);
    if (!record) return this.validate(id, input);
    const result = consumeCsrfToken(record, {
      ...input,
      secret: this.secret,
      nowMs: this.now(),
    });
    if (result.record) this.records.set(result.record.id, result.record);
    return result;
  }

  revoke(id: string): CsrfTokenRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("CSRF token not found");
    const next = revokeCsrfToken(record, this.now());
    this.records.set(id, next);
    return cloneCsrfToken(next)!;
  }

  rotateSession(input: {
    sessionId: string;
    id: string;
    ttlMs: number;
    nonce?: string;
  }): { token: string; record: CsrfTokenRecord; revokedIds: string[] } {
    const revoked = revokeActiveSessionCsrfTokens([...this.records.values()], {
      sessionId: input.sessionId,
      nowMs: this.now(),
    });
    this.replaceAll(revoked.records);
    const issued = this.issue({
      id: input.id,
      sessionId: input.sessionId,
      ttlMs: input.ttlMs,
      nonce: input.nonce,
    });
    return { ...issued, revokedIds: revoked.revokedIds };
  }

  revokeSession(sessionId: string): string[] {
    const result = revokeActiveSessionCsrfTokens([...this.records.values()], {
      sessionId,
      nowMs: this.now(),
    });
    this.replaceAll(result.records);
    return result.revokedIds;
  }

  pruneExpired(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.status !== "active" || nowMs >= record.expiresAtMs) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get(id: string): CsrfTokenRecord | undefined {
    return cloneCsrfToken(this.records.get(id));
  }

  list(sessionId?: string): CsrfTokenRecord[] {
    return [...this.records.values()]
      .filter((record) => !sessionId || record.sessionId === sessionId)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map((record) => cloneCsrfToken(record)!);
  }

  snapshot(): ReturnType<typeof csrfTokenSnapshot> {
    return csrfTokenSnapshot([...this.records.values()]);
  }

  private replaceAll(records: readonly CsrfTokenRecord[]): void {
    this.records.clear();
    for (const record of records) {
      this.records.set(record.id, cloneCsrfToken(record)!);
    }
  }
}
