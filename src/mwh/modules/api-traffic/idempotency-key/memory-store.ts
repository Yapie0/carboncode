import {
  type IdempotencyDecision,
  type IdempotencyRecord,
  type IdempotencyRequest,
  type IdempotencyResponse,
  cloneIdempotencyDecision,
  cloneIdempotencyRecord,
  completeIdempotencyRecord,
  evaluateIdempotency,
  failIdempotencyRecord,
} from "./core.js";

export interface MemoryIdempotencyStoreOptions {
  now?: () => number;
  ttlMs: number;
}

export class MemoryIdempotencyStore {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(opts: MemoryIdempotencyStoreOptions) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs;
  }

  evaluate(key: string, request: IdempotencyRequest): IdempotencyDecision {
    const existing = this.records.get(key);
    const decision = evaluateIdempotency({
      key,
      request,
      nowMs: this.now(),
      ttlMs: this.ttlMs,
      existing,
    });
    if (decision.kind === "start") this.records.set(key, decision.record);
    if (decision.kind === "expired") this.records.set(key, decision.next);
    return cloneIdempotencyDecision(decision);
  }

  complete(key: string, response: IdempotencyResponse): IdempotencyRecord {
    const record = this.records.get(key);
    if (!record) throw new Error(`idempotency record not found: ${key}`);
    const next = completeIdempotencyRecord(record, response, this.now());
    this.records.set(key, next);
    return cloneIdempotencyRecord(next);
  }

  fail(key: string): IdempotencyRecord {
    const record = this.records.get(key);
    if (!record) throw new Error(`idempotency record not found: ${key}`);
    const next = failIdempotencyRecord(record, this.now());
    this.records.set(key, next);
    return cloneIdempotencyRecord(next);
  }

  get(key: string): IdempotencyRecord | undefined {
    const record = this.records.get(key);
    return record ? cloneIdempotencyRecord(record) : undefined;
  }

  pruneExpired(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.expiresAtMs <= now) {
        this.records.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.records.clear();
  }
}
