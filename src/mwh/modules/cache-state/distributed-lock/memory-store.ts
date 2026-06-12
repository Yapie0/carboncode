import { randomBytes } from "node:crypto";
import {
  type DistributedLockRecord,
  type DistributedLockSnapshot,
  type LockAcquireResult,
  type LockOperationCheck,
  acquireDistributedLock,
  checkLockOperation,
  cloneDistributedLockRecord,
  isLockExpired,
  lockSnapshot,
  releaseDistributedLock,
  remainingLockTtlMs,
  renewDistributedLock,
} from "./core.js";

export interface MemoryDistributedLockStoreOptions {
  now?: () => number;
  tokenFactory?: () => string;
}

export class MemoryDistributedLockStore {
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly locks = new Map<string, DistributedLockRecord>();
  private fencingCounter = 0;

  constructor(opts: MemoryDistributedLockStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.tokenFactory = opts.tokenFactory ?? (() => cryptoRandomToken());
  }

  acquire(key: string, ownerId: string, ttlMs: number): LockAcquireResult {
    const nowMs = this.now();
    const result = acquireDistributedLock({
      current: this.locks.get(key),
      key,
      ownerId,
      token: this.tokenFactory(),
      nowMs,
      ttlMs,
      nextFencingToken: this.fencingCounter + 1,
    });
    if (result.acquired) {
      this.fencingCounter = Math.max(this.fencingCounter, result.record.fencingToken);
      this.locks.set(key, result.record);
    }
    return cloneAcquireResult(result);
  }

  renew(
    key: string,
    ownerId: string,
    token: string,
    ttlMs: number,
  ): DistributedLockRecord | undefined {
    const current = this.locks.get(key);
    if (!current) return undefined;
    const next = renewDistributedLock(current, { ownerId, token, nowMs: this.now(), ttlMs });
    if (!next) return undefined;
    this.locks.set(key, next);
    return { ...next };
  }

  release(key: string, ownerId: string, token: string): boolean {
    const current = this.locks.get(key);
    const next = releaseDistributedLock(current, { ownerId, token });
    if (next) {
      this.locks.set(key, next);
      return false;
    }
    this.locks.delete(key);
    return current !== undefined;
  }

  pruneExpired(): number {
    let removed = 0;
    const nowMs = this.now();
    for (const [key, record] of this.locks) {
      if (isLockExpired(record, nowMs)) {
        this.locks.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get(key: string): DistributedLockRecord | undefined {
    const record = this.locks.get(key);
    return record ? cloneDistributedLockRecord(record) : undefined;
  }

  list(): DistributedLockRecord[] {
    return [...this.locks.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(cloneDistributedLockRecord);
  }

  remainingTtl(key: string): number | undefined {
    const record = this.locks.get(key);
    return record ? remainingLockTtlMs(record, this.now()) : undefined;
  }

  snapshot(): DistributedLockSnapshot {
    return lockSnapshot([...this.locks.values()], this.now());
  }

  checkOperation(input: {
    key: string;
    ownerId: string;
    token: string;
    fencingToken: number;
  }): LockOperationCheck {
    return checkLockOperation(this.locks.get(input.key), { ...input, nowMs: this.now() });
  }
}

function cloneAcquireResult(result: LockAcquireResult): LockAcquireResult {
  return { ...result, record: cloneDistributedLockRecord(result.record) };
}

function cryptoRandomToken(): string {
  return randomBytes(32).toString("base64url");
}
