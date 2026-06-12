import {
  type AcquireRefreshLeaseResult,
  type CacheEntry,
  type CacheReadResult,
  type CacheValueCloner,
  type RefreshLeaseState,
  acquireRefreshLease,
  cloneCacheEntry,
  cloneCacheReadResult,
  createCacheEntry,
  planCacheAsideRead,
  readCacheEntry,
  releaseRefreshLease,
  resolveCacheAsideLoad,
} from "./core.js";

export interface MemoryCacheAsideStoreOptions {
  now?: () => number;
}

export class MemoryCacheAsideStore<T = unknown> {
  private readonly now: () => number;
  private readonly cloneValue: CacheValueCloner<T>;
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly leases = new Map<string, RefreshLeaseState>();

  constructor(opts: MemoryCacheAsideStoreOptions & { cloneValue?: CacheValueCloner<T> } = {}) {
    this.now = opts.now ?? Date.now;
    this.cloneValue = opts.cloneValue ?? ((value) => value);
  }

  get(key: string): CacheReadResult<T> {
    return cloneCacheReadResult(
      readCacheEntry({ nowMs: this.now(), entry: this.entries.get(key) }),
      this.cloneValue,
    );
  }

  set(key: string, value: T, opts: { ttlMs: number; staleTtlMs?: number }): CacheEntry<T> {
    const entry = createCacheEntry({ value: this.cloneValue(value), nowMs: this.now(), ...opts });
    this.entries.set(key, entry);
    return cloneCacheEntry(entry, this.cloneValue);
  }

  async getOrLoad(
    key: string,
    loader: () => T | Promise<T>,
    opts: { ttlMs: number; staleTtlMs?: number; owner: string; leaseTtlMs: number },
  ): Promise<CacheReadResult<T>> {
    const current = this.get(key);
    const lease =
      current.decision === "stale"
        ? this.acquireRefreshLease(key, { owner: opts.owner, ttlMs: opts.leaseTtlMs })
        : undefined;
    const plan = planCacheAsideRead({ read: current, refreshLease: lease });
    if (!plan.runLoader) return plan.response;

    try {
      const loaded = await loader();
      if (plan.writeLoadedValue) this.set(key, loaded, opts);
      return cloneCacheReadResult(resolveCacheAsideLoad({ current, loaded }), this.cloneValue);
    } catch (error) {
      return cloneCacheReadResult(resolveCacheAsideLoad({ current, error }), this.cloneValue);
    } finally {
      if (lease?.acquired) this.releaseRefreshLease(key, opts.owner);
    }
  }

  delete(key: string): boolean {
    this.leases.delete(key);
    return this.entries.delete(key);
  }

  acquireRefreshLease(
    key: string,
    opts: { owner: string; ttlMs: number },
  ): AcquireRefreshLeaseResult {
    const result = acquireRefreshLease({
      nowMs: this.now(),
      owner: opts.owner,
      ttlMs: opts.ttlMs,
      state: this.leases.get(key),
    });
    this.leases.set(key, result.state);
    return result;
  }

  releaseRefreshLease(key: string, owner: string): void {
    const next = releaseRefreshLease({ owner, state: this.leases.get(key) });
    if (next) this.leases.set(key, next);
    else this.leases.delete(key);
  }

  pruneExpired(): number {
    let removed = 0;
    const nowMs = this.now();
    for (const [key, entry] of this.entries) {
      if (readCacheEntry({ nowMs, entry }).decision === "miss") {
        this.entries.delete(key);
        removed += 1;
      }
    }
    for (const [key, lease] of this.leases) {
      if (nowMs >= lease.expiresAtMs) this.leases.delete(key);
    }
    return removed;
  }

  size(): number {
    return this.entries.size;
  }
}
