export type QueryCacheHitKind = "fresh" | "stale" | "miss";

export interface QueryCacheEntry<TValue = unknown> {
  key: string;
  value: TValue;
  tags: readonly string[];
  createdAtMs: number;
  freshUntilMs: number;
  staleUntilMs: number;
  lastAccessedAtMs: number;
  accessCount: number;
}

export interface QueryCacheState {
  entries: readonly QueryCacheEntry[];
}

export interface QueryCachePolicy {
  ttlMs: number;
  staleTtlMs: number;
}

export interface QueryCacheLookup<TValue = unknown> {
  kind: QueryCacheHitKind;
  entry?: QueryCacheEntry<TValue>;
  shouldRefresh: boolean;
}

export interface QueryCacheSnapshot {
  totalEntries: number;
  freshEntries: number;
  staleEntries: number;
  expiredEntries: number;
}

export function createQueryCacheState(): QueryCacheState {
  return { entries: [] };
}

export function createQueryCacheKey(input: {
  namespace: string;
  sql: string;
  params?: readonly unknown[];
}): string {
  assertNonEmpty(input.namespace, "namespace");
  assertNonEmpty(input.sql, "sql");
  return stableStringify({
    namespace: input.namespace,
    sql: normalizeSql(input.sql),
    params: input.params ?? [],
  });
}

export function putQueryResult<TValue>(
  state: QueryCacheState,
  input: {
    key: string;
    value: TValue;
    tags: readonly string[];
    nowMs: number;
    policy: QueryCachePolicy;
  },
): { state: QueryCacheState; entry: QueryCacheEntry<TValue> } {
  assertState(state);
  assertNonEmpty(input.key, "key");
  assertTags(input.tags);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPolicy(input.policy);
  const entry: QueryCacheEntry<TValue> = {
    key: input.key,
    value: cloneJson(input.value) as TValue,
    tags: [...new Set(input.tags)].sort(),
    createdAtMs: input.nowMs,
    freshUntilMs: input.nowMs + input.policy.ttlMs,
    staleUntilMs: input.nowMs + input.policy.ttlMs + input.policy.staleTtlMs,
    lastAccessedAtMs: input.nowMs,
    accessCount: 0,
  };
  return {
    state: cloneState({
      entries: [...state.entries.filter((candidate) => candidate.key !== input.key), entry],
    }),
    entry: cloneEntry(entry),
  };
}

export function readQueryResult<TValue>(
  state: QueryCacheState,
  input: {
    key: string;
    nowMs: number;
  },
): { state: QueryCacheState; lookup: QueryCacheLookup<TValue> } {
  assertState(state);
  assertNonEmpty(input.key, "key");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const entry = state.entries.find((candidate) => candidate.key === input.key);
  if (!entry || input.nowMs >= entry.staleUntilMs) {
    return { state: cloneState(state), lookup: { kind: "miss", shouldRefresh: true } };
  }

  const accessed: QueryCacheEntry = {
    ...entry,
    lastAccessedAtMs: input.nowMs,
    accessCount: entry.accessCount + 1,
  };
  const kind: QueryCacheHitKind = input.nowMs < entry.freshUntilMs ? "fresh" : "stale";
  return {
    state: replaceEntry(state, accessed),
    lookup: {
      kind,
      entry: cloneEntry(accessed) as QueryCacheEntry<TValue>,
      shouldRefresh: kind === "stale",
    },
  };
}

export function invalidateQueryCacheByTags(
  state: QueryCacheState,
  tags: readonly string[],
): { state: QueryCacheState; invalidatedKeys: string[] } {
  assertState(state);
  assertTags(tags);
  const tagSet = new Set(tags);
  const invalidated = state.entries.filter((entry) => entry.tags.some((tag) => tagSet.has(tag)));
  return {
    state: cloneState({
      entries: state.entries.filter((entry) => !invalidated.some((hit) => hit.key === entry.key)),
    }),
    invalidatedKeys: invalidated.map((entry) => entry.key).sort(),
  };
}

export function pruneExpiredQueryResults(
  state: QueryCacheState,
  nowMs: number,
): { state: QueryCacheState; prunedKeys: string[] } {
  assertState(state);
  assertNonNegativeInteger(nowMs, "nowMs");
  const expired = state.entries.filter((entry) => nowMs >= entry.staleUntilMs);
  return {
    state: cloneState({
      entries: state.entries.filter((entry) => nowMs < entry.staleUntilMs),
    }),
    prunedKeys: expired.map((entry) => entry.key).sort(),
  };
}

export function queryCacheSnapshot(state: QueryCacheState, nowMs: number): QueryCacheSnapshot {
  assertState(state);
  assertNonNegativeInteger(nowMs, "nowMs");
  return {
    totalEntries: state.entries.length,
    freshEntries: state.entries.filter((entry) => nowMs < entry.freshUntilMs).length,
    staleEntries: state.entries.filter(
      (entry) => nowMs >= entry.freshUntilMs && nowMs < entry.staleUntilMs,
    ).length,
    expiredEntries: state.entries.filter((entry) => nowMs >= entry.staleUntilMs).length,
  };
}

export function cloneQueryCacheState(state: QueryCacheState): QueryCacheState {
  assertState(state);
  return cloneState(state);
}

function replaceEntry(state: QueryCacheState, entry: QueryCacheEntry): QueryCacheState {
  return cloneState({
    entries: state.entries.map((candidate) => (candidate.key === entry.key ? entry : candidate)),
  });
}

function cloneState(state: QueryCacheState): QueryCacheState {
  return {
    entries: state.entries.map(cloneEntry),
  };
}

function cloneEntry<TValue>(entry: QueryCacheEntry<TValue>): QueryCacheEntry<TValue> {
  return {
    ...entry,
    value: cloneJson(entry.value) as TValue,
    tags: [...entry.tags],
  };
}

function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, " ").toLowerCase();
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

function assertState(state: QueryCacheState): void {
  if (!Array.isArray(state.entries)) throw new Error("entries must be an array");
}

function assertPolicy(policy: QueryCachePolicy): void {
  assertPositiveInteger(policy.ttlMs, "ttlMs");
  assertNonNegativeInteger(policy.staleTtlMs, "staleTtlMs");
}

function assertTags(tags: readonly string[]): void {
  if (!Array.isArray(tags) || tags.length === 0) throw new Error("tags are required");
  for (const tag of tags) assertNonEmpty(tag, "tag");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
