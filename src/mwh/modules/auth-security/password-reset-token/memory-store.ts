import {
  type PasswordResetTokenRecord,
  clonePasswordResetToken,
  consumePasswordResetToken,
  createPasswordResetTokenRecord,
  revokePasswordResetToken,
  verifyPasswordResetTokenRecord,
} from "./core.js";

export class MemoryPasswordResetTokenStore {
  private readonly now: () => number;
  private readonly records = new Map<string, PasswordResetTokenRecord>();

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  issue(input: {
    id: string;
    subjectId: string;
    token: string;
    ttlMs: number;
    maxAttempts?: number;
    metadata?: Record<string, string>;
  }): PasswordResetTokenRecord {
    if (this.records.has(input.id)) throw new Error("password reset token already exists");
    const record = createPasswordResetTokenRecord({ ...input, nowMs: this.now() });
    this.records.set(record.id, record);
    return clonePasswordResetToken(record)!;
  }

  verify(id: string, token?: string): ReturnType<typeof verifyPasswordResetTokenRecord> {
    const verification = verifyPasswordResetTokenRecord(this.records.get(id), {
      token,
      nowMs: this.now(),
    });
    if (verification.record) this.records.set(verification.record.id, verification.record);
    return verification;
  }

  consume(id: string, token?: string): ReturnType<typeof consumePasswordResetToken> {
    const result = consumePasswordResetToken(this.records.get(id)!, { token, nowMs: this.now() });
    if (result.record) this.records.set(result.record.id, result.record);
    return result;
  }

  revoke(id: string, reason: string): PasswordResetTokenRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("password reset token not found");
    const revoked = revokePasswordResetToken(record, { nowMs: this.now(), reason });
    this.records.set(id, revoked);
    return clonePasswordResetToken(revoked)!;
  }

  pruneExpired(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.status !== "pending" || nowMs >= record.expiresAtMs) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get(id: string): PasswordResetTokenRecord | undefined {
    return clonePasswordResetToken(this.records.get(id));
  }

  list(subjectId?: string): PasswordResetTokenRecord[] {
    return [...this.records.values()]
      .filter((record) => !subjectId || record.subjectId === subjectId)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map((record) => clonePasswordResetToken(record)!);
  }
}
