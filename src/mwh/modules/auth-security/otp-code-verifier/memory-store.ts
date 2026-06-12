import {
  type OtpCodeRecord,
  canResendOtpCode,
  cloneOtpCode,
  consumeOtpCode,
  createOtpCodeRecord,
  generateOtpCode,
  revokeOtpCode,
  verifyOtpCodeRecord,
} from "./core.js";

export class MemoryOtpCodeStore {
  private readonly now: () => number;
  private readonly records = new Map<string, OtpCodeRecord>();

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  issue(input: {
    id: string;
    subjectId: string;
    channel: OtpCodeRecord["channel"];
    purpose: string;
    code?: string;
    ttlMs: number;
    resendCooldownMs?: number;
    maxAttempts?: number;
    metadata?: Record<string, string>;
  }): { code: string; record: OtpCodeRecord } {
    if (this.records.has(input.id)) throw new Error("OTP code already exists");
    const code = input.code ?? generateOtpCode();
    const record = createOtpCodeRecord({ ...input, code, nowMs: this.now() });
    this.records.set(record.id, record);
    return { code, record: cloneOtpCode(record)! };
  }

  verify(id: string, code?: string): ReturnType<typeof verifyOtpCodeRecord> {
    const verification = verifyOtpCodeRecord(this.records.get(id), {
      code,
      nowMs: this.now(),
    });
    if (verification.record) this.records.set(verification.record.id, verification.record);
    return verification;
  }

  consume(id: string, code?: string): ReturnType<typeof consumeOtpCode> {
    const record = this.records.get(id);
    if (!record) return this.verify(id, code);
    const result = consumeOtpCode(record, { code, nowMs: this.now() });
    if (result.record) this.records.set(result.record.id, result.record);
    return result;
  }

  canResend(id: string): ReturnType<typeof canResendOtpCode> {
    const record = this.records.get(id);
    if (!record) return { status: "code-mismatch" };
    return canResendOtpCode(record, this.now());
  }

  revoke(id: string): OtpCodeRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("OTP code not found");
    const revoked = revokeOtpCode(record, this.now());
    this.records.set(id, revoked);
    return cloneOtpCode(revoked)!;
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

  get(id: string): OtpCodeRecord | undefined {
    return cloneOtpCode(this.records.get(id));
  }

  list(subjectId?: string): OtpCodeRecord[] {
    return [...this.records.values()]
      .filter((record) => !subjectId || record.subjectId === subjectId)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map((record) => cloneOtpCode(record)!);
  }
}
