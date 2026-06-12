export interface DistributedLockRecord {
  key: string;
  ownerId: string;
  token: string;
  fencingToken: number;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export interface LockAcquireResult {
  acquired: boolean;
  record: DistributedLockRecord;
  reason: "available" | "expired" | "same-owner" | "held";
  retryAfterMs: number;
}

export interface LockOperationCheck {
  allowed: boolean;
  reason:
    | "active-owner"
    | "missing"
    | "expired"
    | "owner-mismatch"
    | "token-mismatch"
    | "stale-fencing-token";
}

export interface DistributedLockSnapshot {
  total: number;
  active: number;
  expired: number;
  nextExpiryAtMs?: number;
}

export function acquireDistributedLock(input: {
  current?: DistributedLockRecord;
  key: string;
  ownerId: string;
  token: string;
  nowMs: number;
  ttlMs: number;
  nextFencingToken?: number;
}): LockAcquireResult {
  assertNonEmpty(input.key, "key");
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonEmpty(input.token, "token");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");

  const nextToken = input.nextFencingToken ?? (input.current?.fencingToken ?? 0) + 1;
  const nextRecord: DistributedLockRecord = {
    key: input.key,
    ownerId: input.ownerId,
    token: input.token,
    fencingToken: nextToken,
    acquiredAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
  };

  if (!input.current) {
    return { acquired: true, record: nextRecord, reason: "available", retryAfterMs: 0 };
  }
  if (input.nowMs >= input.current.expiresAtMs) {
    return { acquired: true, record: nextRecord, reason: "expired", retryAfterMs: 0 };
  }
  if (input.current.ownerId === input.ownerId && input.current.token === input.token) {
    return {
      acquired: true,
      record: {
        ...input.current,
        expiresAtMs: input.nowMs + input.ttlMs,
      },
      reason: "same-owner",
      retryAfterMs: 0,
    };
  }
  return {
    acquired: false,
    record: input.current,
    reason: "held",
    retryAfterMs: Math.max(0, input.current.expiresAtMs - input.nowMs),
  };
}

export function renewDistributedLock(
  record: DistributedLockRecord,
  input: { ownerId: string; token: string; nowMs: number; ttlMs: number },
): DistributedLockRecord | undefined {
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonEmpty(input.token, "token");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  if (input.nowMs >= record.expiresAtMs) return undefined;
  if (record.ownerId !== input.ownerId || record.token !== input.token) return undefined;
  return { ...record, expiresAtMs: input.nowMs + input.ttlMs };
}

export function releaseDistributedLock(
  record: DistributedLockRecord | undefined,
  input: { ownerId: string; token: string },
): DistributedLockRecord | undefined {
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonEmpty(input.token, "token");
  if (!record) return undefined;
  if (record.ownerId !== input.ownerId || record.token !== input.token) return record;
  return undefined;
}

export function checkLockOperation(
  record: DistributedLockRecord | undefined,
  input: {
    ownerId: string;
    token: string;
    fencingToken: number;
    nowMs: number;
  },
): LockOperationCheck {
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonEmpty(input.token, "token");
  assertPositiveInteger(input.fencingToken, "fencingToken");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!record) return { allowed: false, reason: "missing" };
  if (input.nowMs >= record.expiresAtMs) return { allowed: false, reason: "expired" };
  if (record.ownerId !== input.ownerId) return { allowed: false, reason: "owner-mismatch" };
  if (record.token !== input.token) return { allowed: false, reason: "token-mismatch" };
  if (record.fencingToken !== input.fencingToken) {
    return { allowed: false, reason: "stale-fencing-token" };
  }
  return { allowed: true, reason: "active-owner" };
}

export function compareFencingToken(input: {
  currentFencingToken: number;
  operationFencingToken: number;
}): "current" | "stale" | "future" {
  assertPositiveInteger(input.currentFencingToken, "currentFencingToken");
  assertPositiveInteger(input.operationFencingToken, "operationFencingToken");
  if (input.operationFencingToken === input.currentFencingToken) return "current";
  return input.operationFencingToken < input.currentFencingToken ? "stale" : "future";
}

export function remainingLockTtlMs(record: DistributedLockRecord, nowMs: number): number {
  assertNonNegativeInteger(nowMs, "nowMs");
  return Math.max(0, record.expiresAtMs - nowMs);
}

export function isLockExpired(record: DistributedLockRecord, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return nowMs >= record.expiresAtMs;
}

export function lockSnapshot(
  records: readonly DistributedLockRecord[],
  nowMs: number,
): DistributedLockSnapshot {
  assertNonNegativeInteger(nowMs, "nowMs");
  const expired = records.filter((record) => isLockExpired(record, nowMs)).length;
  const activeRecords = records.filter((record) => !isLockExpired(record, nowMs));
  const nextExpiryAtMs =
    activeRecords.length === 0
      ? undefined
      : Math.min(...activeRecords.map((record) => record.expiresAtMs));
  return {
    total: records.length,
    active: activeRecords.length,
    expired,
    nextExpiryAtMs,
  };
}

export function cloneDistributedLockRecord(record: DistributedLockRecord): DistributedLockRecord {
  return { ...record };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
