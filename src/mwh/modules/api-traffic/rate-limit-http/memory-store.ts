import {
  type FixedWindowResult,
  type FixedWindowState,
  type RateLimitHttpRequest,
  type RateLimitHttpResponse,
  type SlidingWindowEvent,
  type SlidingWindowResult,
  type TokenBucketResult,
  type TokenBucketState,
  buildRateLimitResponse,
  checkFixedWindow,
  checkSlidingWindow,
  checkTokenBucket,
  createRateLimitKey,
} from "./core.js";

export interface MemoryRateLimitStoreOptions {
  now?: () => number;
}

export interface RateLimitAuditEntry {
  atMs: number;
  key: string;
  request: RateLimitHttpRequest;
  response: RateLimitHttpResponse;
}

export class MemoryRateLimitStore {
  private readonly now: () => number;
  private readonly fixedWindows = new Map<string, FixedWindowState>();
  private readonly tokenBuckets = new Map<string, TokenBucketState>();
  private readonly slidingWindows = new Map<string, readonly SlidingWindowEvent[]>();
  private readonly audit: RateLimitAuditEntry[] = [];

  constructor(opts: MemoryRateLimitStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  checkFixedWindow(key: string, opts: { limit: number; windowMs: number }): FixedWindowResult {
    const result = checkFixedWindow({
      ...opts,
      nowMs: this.now(),
      state: this.fixedWindows.get(key),
    });
    this.fixedWindows.set(key, result.state);
    return result;
  }

  checkHttpFixedWindow(
    request: RateLimitHttpRequest,
    opts: { limit: number; windowMs: number },
  ): RateLimitHttpResponse {
    const nowMs = this.now();
    const key = createRateLimitKey(request);
    const result = checkFixedWindow({
      ...opts,
      nowMs,
      state: this.fixedWindows.get(key),
    });
    this.fixedWindows.set(key, result.state);
    const response = buildRateLimitResponse({
      decision: result.decision,
      limit: opts.limit,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
      resetAtMs: result.resetAtMs,
      nowMs,
    });
    this.audit.push({
      atMs: nowMs,
      key,
      request: { ...request },
      response: cloneResponse(response),
    });
    return cloneResponse(response);
  }

  checkTokenBucket(
    key: string,
    opts: { capacity: number; refillPerMs: number; cost?: number },
  ): TokenBucketResult {
    const result = checkTokenBucket({
      ...opts,
      nowMs: this.now(),
      state: this.tokenBuckets.get(key),
    });
    this.tokenBuckets.set(key, result.state);
    return result;
  }

  checkSlidingWindow(
    key: string,
    opts: { limit: number; windowMs: number; cost?: number },
  ): SlidingWindowResult {
    const result = checkSlidingWindow({
      ...opts,
      nowMs: this.now(),
      events: this.slidingWindows.get(key),
    });
    this.slidingWindows.set(key, result.events);
    return result;
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.fixedWindows.clear();
      this.tokenBuckets.clear();
      this.slidingWindows.clear();
      return;
    }
    this.fixedWindows.delete(key);
    this.tokenBuckets.delete(key);
    this.slidingWindows.delete(key);
  }

  listAudit(): RateLimitAuditEntry[] {
    return this.audit.map((entry) => ({
      atMs: entry.atMs,
      key: entry.key,
      request: { ...entry.request },
      response: cloneResponse(entry.response),
    }));
  }
}

function cloneResponse(response: RateLimitHttpResponse): RateLimitHttpResponse {
  return { ...response, headers: { ...response.headers } };
}
