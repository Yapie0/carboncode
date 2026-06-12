export type CacheReadDecision = "hit" | "stale" | "miss";

export interface CacheEntry<T> {
  value: T;
  storedAtMs: number;
  ttlMs: number;
  staleTtlMs?: number;
}

export interface CacheReadInput<T> {
  nowMs: number;
  entry?: CacheEntry<T>;
}

export interface CacheReadResult<T> {
  decision: CacheReadDecision;
  value?: T;
  ageMs?: number;
  expiresAtMs?: number;
  staleUntilMs?: number;
  shouldRefresh: boolean;
}

export interface CacheAsideReadPlan<T> {
  response: CacheReadResult<T>;
  serveCachedValue: boolean;
  runLoader: boolean;
  writeLoadedValue: boolean;
  backgroundRefresh: boolean;
}

export type CacheValueCloner<T> = (value: T) => T;

export interface RefreshLeaseState {
  owner: string;
  expiresAtMs: number;
}

export interface AcquireRefreshLeaseInput {
  nowMs: number;
  owner: string;
  ttlMs: number;
  state?: RefreshLeaseState;
}

export interface AcquireRefreshLeaseResult {
  acquired: boolean;
  state: RefreshLeaseState;
  reason: "available" | "same-owner" | "held";
  retryAfterMs: number;
}

export function readCacheEntry<T>(input: CacheReadInput<T>): CacheReadResult<T> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const entry = input.entry;
  if (!entry) return { decision: "miss", shouldRefresh: true };
  assertCacheEntry(entry);

  const ageMs = Math.max(0, input.nowMs - entry.storedAtMs);
  const expiresAtMs = entry.storedAtMs + entry.ttlMs;
  const staleUntilMs = expiresAtMs + (entry.staleTtlMs ?? 0);

  if (input.nowMs < expiresAtMs) {
    return {
      decision: "hit",
      value: entry.value,
      ageMs,
      expiresAtMs,
      staleUntilMs,
      shouldRefresh: false,
    };
  }

  if ((entry.staleTtlMs ?? 0) > 0 && input.nowMs < staleUntilMs) {
    return {
      decision: "stale",
      value: entry.value,
      ageMs,
      expiresAtMs,
      staleUntilMs,
      shouldRefresh: true,
    };
  }

  return {
    decision: "miss",
    ageMs,
    expiresAtMs,
    staleUntilMs,
    shouldRefresh: true,
  };
}

export function planCacheAsideRead<T>(input: {
  read: CacheReadResult<T>;
  refreshLease?: AcquireRefreshLeaseResult;
}): CacheAsideReadPlan<T> {
  if (input.read.decision === "hit") {
    return {
      response: input.read,
      serveCachedValue: true,
      runLoader: false,
      writeLoadedValue: false,
      backgroundRefresh: false,
    };
  }

  if (input.read.decision === "stale") {
    const canRefresh = input.refreshLease?.acquired === true;
    return {
      response: input.read,
      serveCachedValue: true,
      runLoader: canRefresh,
      writeLoadedValue: canRefresh,
      backgroundRefresh: canRefresh,
    };
  }

  return {
    response: input.read,
    serveCachedValue: false,
    runLoader: true,
    writeLoadedValue: true,
    backgroundRefresh: false,
  };
}

export function resolveCacheAsideLoad<T>(input: {
  current: CacheReadResult<T>;
  loaded?: T;
  error?: unknown;
}): CacheReadResult<T> {
  if (input.error !== undefined) {
    if (input.current.decision === "stale" && input.current.value !== undefined) {
      return {
        ...input.current,
        decision: "stale",
        shouldRefresh: true,
      };
    }
    return { decision: "miss", shouldRefresh: true };
  }
  return {
    decision: "hit",
    value: input.loaded,
    shouldRefresh: false,
  };
}

export function createCacheEntry<T>(input: {
  value: T;
  nowMs: number;
  ttlMs: number;
  staleTtlMs?: number;
}): CacheEntry<T> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  if (input.staleTtlMs !== undefined) assertNonNegativeInteger(input.staleTtlMs, "staleTtlMs");
  return {
    value: input.value,
    storedAtMs: input.nowMs,
    ttlMs: input.ttlMs,
    staleTtlMs: input.staleTtlMs,
  };
}

export function cloneCacheEntry<T>(
  entry: CacheEntry<T>,
  cloneValue: CacheValueCloner<T> = identity,
): CacheEntry<T> {
  return {
    ...entry,
    value: cloneValue(entry.value),
  };
}

export function cloneCacheReadResult<T>(
  result: CacheReadResult<T>,
  cloneValue: CacheValueCloner<T> = identity,
): CacheReadResult<T> {
  return {
    ...result,
    value: result.value === undefined ? undefined : cloneValue(result.value),
  };
}

export function acquireRefreshLease(input: AcquireRefreshLeaseInput): AcquireRefreshLeaseResult {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  if (!input.owner.trim()) throw new Error("owner is required");

  const next = { owner: input.owner, expiresAtMs: input.nowMs + input.ttlMs };
  if (!input.state || input.nowMs >= input.state.expiresAtMs) {
    return { acquired: true, state: next, reason: "available", retryAfterMs: 0 };
  }
  if (input.state.owner === input.owner) {
    return { acquired: true, state: next, reason: "same-owner", retryAfterMs: 0 };
  }
  return {
    acquired: false,
    state: input.state,
    reason: "held",
    retryAfterMs: Math.max(0, input.state.expiresAtMs - input.nowMs),
  };
}

export function releaseRefreshLease(input: {
  owner: string;
  state?: RefreshLeaseState;
}): RefreshLeaseState | undefined {
  if (!input.state) return undefined;
  return input.state.owner === input.owner ? undefined : input.state;
}

function identity<T>(value: T): T {
  return value;
}

function assertCacheEntry<T>(entry: CacheEntry<T>): void {
  assertNonNegativeInteger(entry.storedAtMs, "storedAtMs");
  assertPositiveInteger(entry.ttlMs, "ttlMs");
  if (entry.staleTtlMs !== undefined) assertNonNegativeInteger(entry.staleTtlMs, "staleTtlMs");
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
