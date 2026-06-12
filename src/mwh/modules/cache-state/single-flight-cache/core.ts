export type SingleFlightDecision = "hit" | "miss" | "expired";

export interface SingleFlightCacheEntry<T> {
  value: T;
  storedAtMs: number;
  expiresAtMs: number;
}

export interface SingleFlightWorkState {
  owner: string;
  startedAtMs: number;
  expiresAtMs: number;
}

export interface SingleFlightReadResult<T> {
  decision: SingleFlightDecision;
  value?: T;
  ageMs?: number;
  expiresAtMs?: number;
}

export interface SingleFlightAcquireResult {
  acquired: boolean;
  state: SingleFlightWorkState;
  reason: "available" | "same-owner" | "in-flight";
  retryAfterMs: number;
}

export function createSingleFlightEntry<T>(input: {
  value: T;
  nowMs: number;
  ttlMs: number;
}): SingleFlightCacheEntry<T> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    value: input.value,
    storedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
  };
}

export function readSingleFlightEntry<T>(input: {
  entry?: SingleFlightCacheEntry<T>;
  nowMs: number;
}): SingleFlightReadResult<T> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!input.entry) return { decision: "miss" };
  assertEntry(input.entry);
  if (input.nowMs >= input.entry.expiresAtMs) {
    return {
      decision: "expired",
      ageMs: Math.max(0, input.nowMs - input.entry.storedAtMs),
      expiresAtMs: input.entry.expiresAtMs,
    };
  }
  return {
    decision: "hit",
    value: input.entry.value,
    ageMs: Math.max(0, input.nowMs - input.entry.storedAtMs),
    expiresAtMs: input.entry.expiresAtMs,
  };
}

export function acquireSingleFlightWork(input: {
  state?: SingleFlightWorkState;
  owner: string;
  nowMs: number;
  ttlMs: number;
}): SingleFlightAcquireResult {
  assertNonEmpty(input.owner, "owner");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  const next = {
    owner: input.owner,
    startedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
  };
  if (!input.state || input.nowMs >= input.state.expiresAtMs) {
    return { acquired: true, state: next, reason: "available", retryAfterMs: 0 };
  }
  if (input.state.owner === input.owner) {
    return { acquired: true, state: next, reason: "same-owner", retryAfterMs: 0 };
  }
  return {
    acquired: false,
    state: input.state,
    reason: "in-flight",
    retryAfterMs: Math.max(0, input.state.expiresAtMs - input.nowMs),
  };
}

export function releaseSingleFlightWork(input: {
  state?: SingleFlightWorkState;
  owner: string;
}): SingleFlightWorkState | undefined {
  assertNonEmpty(input.owner, "owner");
  if (!input.state) return undefined;
  return input.state.owner === input.owner ? undefined : input.state;
}

function assertEntry<T>(entry: SingleFlightCacheEntry<T>): void {
  assertNonNegativeInteger(entry.storedAtMs, "storedAtMs");
  assertNonNegativeInteger(entry.expiresAtMs, "expiresAtMs");
  if (entry.expiresAtMs <= entry.storedAtMs)
    throw new Error("expiresAtMs must be after storedAtMs");
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
