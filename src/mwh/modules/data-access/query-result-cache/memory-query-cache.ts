import {
  type QueryCacheEntry,
  type QueryCacheLookup,
  type QueryCachePolicy,
  type QueryCacheSnapshot,
  type QueryCacheState,
  cloneQueryCacheState,
  createQueryCacheKey,
  createQueryCacheState,
  invalidateQueryCacheByTags,
  pruneExpiredQueryResults,
  putQueryResult,
  queryCacheSnapshot,
  readQueryResult,
} from "./core.js";

export interface MemoryQueryResultCacheOptions {
  now?: () => number;
  policy: QueryCachePolicy;
}

export class MemoryQueryResultCache {
  private state: QueryCacheState = createQueryCacheState();
  private readonly now: () => number;
  private readonly policy: QueryCachePolicy;
  private readonly inflight = new Map<string, Promise<QueryCacheEntry>>();

  constructor(options: MemoryQueryResultCacheOptions) {
    this.now = options.now ?? Date.now;
    this.policy = { ...options.policy };
  }

  key(input: { namespace: string; sql: string; params?: readonly unknown[] }): string {
    return createQueryCacheKey(input);
  }

  put<TValue>(input: {
    namespace: string;
    sql: string;
    params?: readonly unknown[];
    tags: readonly string[];
    value: TValue;
  }): QueryCacheEntry<TValue> {
    const result = putQueryResult(this.state, {
      key: this.key(input),
      value: input.value,
      tags: input.tags,
      nowMs: this.now(),
      policy: this.policy,
    });
    this.state = result.state;
    return result.entry;
  }

  read<TValue>(input: {
    namespace: string;
    sql: string;
    params?: readonly unknown[];
  }): QueryCacheLookup<TValue> {
    const result = readQueryResult<TValue>(this.state, {
      key: this.key(input),
      nowMs: this.now(),
    });
    this.state = result.state;
    return result.lookup;
  }

  async getOrLoad<TValue>(input: {
    namespace: string;
    sql: string;
    params?: readonly unknown[];
    tags: readonly string[];
    allowStaleWhileRefresh?: boolean;
    loader: () => Promise<TValue> | TValue;
  }): Promise<QueryCacheLookup<TValue>> {
    const key = this.key(input);
    const lookup = this.read<TValue>(input);
    if (lookup.kind === "fresh") return lookup;
    if (lookup.kind === "stale" && input.allowStaleWhileRefresh) {
      void this.refresh({ ...input, key });
      return lookup;
    }
    const entry = await this.refresh<TValue>({ ...input, key });
    return { kind: "fresh", entry, shouldRefresh: false };
  }

  invalidateTags(tags: readonly string[]): string[] {
    const result = invalidateQueryCacheByTags(this.state, tags);
    this.state = result.state;
    return result.invalidatedKeys;
  }

  pruneExpired(): string[] {
    const result = pruneExpiredQueryResults(this.state, this.now());
    this.state = result.state;
    return result.prunedKeys;
  }

  snapshot(): QueryCacheSnapshot {
    return queryCacheSnapshot(this.state, this.now());
  }

  listEntries(): QueryCacheEntry[] {
    return cloneQueryCacheState(this.state).entries.map((entry) => ({ ...entry }));
  }

  private async refresh<TValue>(input: {
    key: string;
    namespace: string;
    sql: string;
    params?: readonly unknown[];
    tags: readonly string[];
    loader: () => Promise<TValue> | TValue;
  }): Promise<QueryCacheEntry<TValue>> {
    const existing = this.inflight.get(input.key) as Promise<QueryCacheEntry<TValue>> | undefined;
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(() => input.loader())
      .then((value) =>
        this.put<TValue>({
          namespace: input.namespace,
          sql: input.sql,
          params: input.params,
          tags: input.tags,
          value,
        }),
      )
      .finally(() => {
        this.inflight.delete(input.key);
      });
    this.inflight.set(input.key, promise as Promise<QueryCacheEntry>);
    return promise;
  }
}
