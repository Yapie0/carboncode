import {
  type RotateSessionResult,
  type SessionTokenRecord,
  cloneRotateSessionResult,
  cloneSessionTokenRecord,
  createSessionTokenRecord,
  generateRefreshToken,
  revokeSession,
  rotateRefreshToken,
} from "./core.js";

export interface MemorySessionTokenStoreOptions {
  now?: () => number;
  idFactory?: () => string;
  tokenFactory?: () => string;
  refreshTtlMs?: number;
  absoluteTtlMs?: number;
}

export class MemorySessionTokenStore {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;
  private readonly refreshTtlMs: number;
  private readonly absoluteTtlMs: number;
  private readonly records = new Map<string, SessionTokenRecord>();

  constructor(opts: MemorySessionTokenStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.idFactory = opts.idFactory ?? (() => `session_${generateRefreshToken(12)}`);
    this.tokenFactory = opts.tokenFactory ?? (() => generateRefreshToken(32));
    this.refreshTtlMs = opts.refreshTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.absoluteTtlMs = opts.absoluteTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  }

  create(subjectId: string): { record: SessionTokenRecord; refreshToken: string } {
    const refreshToken = this.tokenFactory();
    const record = createSessionTokenRecord({
      sessionId: this.idFactory(),
      subjectId,
      refreshToken,
      nowMs: this.now(),
      ttlMs: this.refreshTtlMs,
      absoluteTtlMs: this.absoluteTtlMs,
    });
    this.records.set(record.sessionId, record);
    return { record: cloneSessionTokenRecord(record), refreshToken };
  }

  rotate(sessionId: string, presentedToken: string): RotateSessionResult {
    const record = this.require(sessionId);
    const nextToken = this.tokenFactory();
    const result = rotateRefreshToken(record, {
      presentedToken,
      nextToken,
      nowMs: this.now(),
      ttlMs: this.refreshTtlMs,
    });
    this.records.set(sessionId, result.record);
    return cloneRotateSessionResult(result);
  }

  revoke(sessionId: string, reason: string): SessionTokenRecord {
    const next = revokeSession(this.require(sessionId), { nowMs: this.now(), reason });
    this.records.set(sessionId, next);
    return cloneSessionTokenRecord(next);
  }

  get(sessionId: string): SessionTokenRecord | undefined {
    const record = this.records.get(sessionId);
    return record ? cloneSessionTokenRecord(record) : undefined;
  }

  listBySubject(subjectId: string): SessionTokenRecord[] {
    return [...this.records.values()]
      .filter((record) => record.subjectId === subjectId)
      .map(cloneSessionTokenRecord);
  }

  private require(sessionId: string): SessionTokenRecord {
    const record = this.records.get(sessionId);
    if (!record) throw new Error(`unknown session: ${sessionId}`);
    return record;
  }
}
