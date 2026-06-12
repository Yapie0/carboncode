import {
  type SingleFlightCacheEntry,
  type SingleFlightReadResult,
  type SingleFlightWorkState,
  createSingleFlightEntry,
  readSingleFlightEntry,
} from "./core.js";

export interface SingleFlightLoadContext {
  key: string;
  owner: string;
}

export interface SingleFlightLoadResult<T> {
  value: T;
  source: "cache" | "loader" | "in-flight";
}

export class MemorySingleFlightCache<T = unknown> {
  private readonly now: () => number;
  private readonly entries = new Map<string, SingleFlightCacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly work = new Map<string, SingleFlightWorkState>();

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  get(key: string): SingleFlightReadResult<T> {
    return readSingleFlightEntry({ entry: this.entries.get(key), nowMs: this.now() });
  }

  set(key: string, value: T, ttlMs: number): SingleFlightCacheEntry<T> {
    const entry = createSingleFlightEntry({ value, ttlMs, nowMs: this.now() });
    this.entries.set(key, entry);
    return { ...entry };
  }

  async getOrLoad(
    key: string,
    input: {
      owner: string;
      ttlMs: number;
      workTtlMs: number;
      loader: (context: SingleFlightLoadContext) => Promise<T> | T;
    },
  ): Promise<SingleFlightLoadResult<T>> {
    const cached = this.get(key);
    if (cached.decision === "hit") return { value: cached.value as T, source: "cache" };

    const existing = this.inFlight.get(key);
    if (existing) return { value: await existing, source: "in-flight" };

    const startedAtMs = this.now();
    const work = { owner: input.owner, startedAtMs, expiresAtMs: startedAtMs + input.workTtlMs };
    this.work.set(key, work);
    const loading = Promise.resolve().then(() => input.loader({ key, owner: input.owner }));
    this.inFlight.set(key, loading);

    try {
      const value = await loading;
      this.entries.set(
        key,
        createSingleFlightEntry({ value, ttlMs: input.ttlMs, nowMs: this.now() }),
      );
      return { value, source: "loader" };
    } finally {
      this.inFlight.delete(key);
      const current = this.work.get(key);
      if (current?.owner === input.owner) this.work.delete(key);
    }
  }

  delete(key: string): boolean {
    this.inFlight.delete(key);
    this.work.delete(key);
    return this.entries.delete(key);
  }

  pruneExpired(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (readSingleFlightEntry({ entry, nowMs }).decision !== "hit") {
        this.entries.delete(key);
        removed += 1;
      }
    }
    for (const [key, state] of this.work) {
      if (nowMs >= state.expiresAtMs) this.work.delete(key);
    }
    return removed;
  }

  snapshot(): {
    entries: Array<[string, SingleFlightCacheEntry<T>]>;
    work: Array<[string, SingleFlightWorkState]>;
  } {
    return {
      entries: [...this.entries.entries()].map(([key, entry]) => [key, { ...entry }]),
      work: [...this.work.entries()].map(([key, state]) => [key, { ...state }]),
    };
  }
}
