export type RateLimitDecision = "allow" | "deny";

export interface FixedWindowState {
  windowStartMs: number;
  count: number;
}

export interface FixedWindowInput {
  nowMs: number;
  windowMs: number;
  limit: number;
  state?: FixedWindowState;
}

export interface FixedWindowResult {
  decision: RateLimitDecision;
  state: FixedWindowState;
  remaining: number;
  retryAfterMs: number;
  resetAtMs: number;
}

export interface TokenBucketState {
  tokens: number;
  updatedAtMs: number;
}

export interface TokenBucketInput {
  nowMs: number;
  capacity: number;
  refillPerMs: number;
  cost?: number;
  state?: TokenBucketState;
}

export interface TokenBucketResult {
  decision: RateLimitDecision;
  state: TokenBucketState;
  remaining: number;
  retryAfterMs: number;
}

export interface SlidingWindowEvent {
  atMs: number;
  weight: number;
}

export interface SlidingWindowInput {
  nowMs: number;
  windowMs: number;
  limit: number;
  cost?: number;
  events?: readonly SlidingWindowEvent[];
}

export interface SlidingWindowResult {
  decision: RateLimitDecision;
  events: readonly SlidingWindowEvent[];
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitHttpRequest {
  routeId: string;
  subjectId?: string;
  ip?: string;
  method?: string;
}

export interface RateLimitHttpResponse {
  allowed: boolean;
  statusCode: 200 | 429;
  headers: Record<string, string>;
}

export function checkFixedWindow(input: FixedWindowInput): FixedWindowResult {
  assertPositiveInteger(input.limit, "limit");
  assertPositiveInteger(input.windowMs, "windowMs");
  assertNonNegativeInteger(input.nowMs, "nowMs");

  const current =
    input.state && input.nowMs < input.state.windowStartMs + input.windowMs
      ? input.state
      : { windowStartMs: input.nowMs, count: 0 };
  const resetAtMs = current.windowStartMs + input.windowMs;
  if (current.count >= input.limit) {
    return {
      decision: "deny",
      state: current,
      remaining: 0,
      retryAfterMs: Math.max(0, resetAtMs - input.nowMs),
      resetAtMs,
    };
  }

  const next = { windowStartMs: current.windowStartMs, count: current.count + 1 };
  return {
    decision: "allow",
    state: next,
    remaining: input.limit - next.count,
    retryAfterMs: 0,
    resetAtMs,
  };
}

export function checkTokenBucket(input: TokenBucketInput): TokenBucketResult {
  assertPositiveFinite(input.capacity, "capacity");
  assertPositiveFinite(input.refillPerMs, "refillPerMs");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const cost = input.cost ?? 1;
  assertPositiveFinite(cost, "cost");

  const previous = input.state ?? { tokens: input.capacity, updatedAtMs: input.nowMs };
  const elapsedMs = Math.max(0, input.nowMs - previous.updatedAtMs);
  const tokens = Math.min(input.capacity, previous.tokens + elapsedMs * input.refillPerMs);
  if (tokens < cost) {
    return {
      decision: "deny",
      state: { tokens, updatedAtMs: input.nowMs },
      remaining: Math.floor(tokens),
      retryAfterMs: Math.ceil((cost - tokens) / input.refillPerMs),
    };
  }

  const nextTokens = tokens - cost;
  return {
    decision: "allow",
    state: { tokens: nextTokens, updatedAtMs: input.nowMs },
    remaining: Math.floor(nextTokens),
    retryAfterMs: 0,
  };
}

export function checkSlidingWindow(input: SlidingWindowInput): SlidingWindowResult {
  assertPositiveInteger(input.limit, "limit");
  assertPositiveInteger(input.windowMs, "windowMs");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const cost = input.cost ?? 1;
  assertPositiveFinite(cost, "cost");

  const cutoff = input.nowMs - input.windowMs;
  const active = (input.events ?? []).filter((event) => event.atMs > cutoff);
  const used = active.reduce((sum, event) => sum + event.weight, 0);
  if (used + cost > input.limit) {
    const oldest = active[0];
    const retryAfterMs = oldest
      ? Math.max(0, oldest.atMs + input.windowMs - input.nowMs)
      : input.windowMs;
    return {
      decision: "deny",
      events: active,
      remaining: Math.max(0, Math.floor(input.limit - used)),
      retryAfterMs,
    };
  }

  const events = [...active, { atMs: input.nowMs, weight: cost }];
  return {
    decision: "allow",
    events,
    remaining: Math.max(0, Math.floor(input.limit - used - cost)),
    retryAfterMs: 0,
  };
}

export function createRateLimitKey(input: RateLimitHttpRequest): string {
  assertNonEmpty(input.routeId, "routeId");
  const subject = input.subjectId?.trim() || input.ip?.trim() || "anonymous";
  const method = input.method?.trim().toUpperCase() || "*";
  return `${method}:${input.routeId}:${subject}`;
}

export function buildRateLimitResponse(input: {
  decision: RateLimitDecision;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAtMs?: number;
  nowMs: number;
}): RateLimitHttpResponse {
  assertPositiveInteger(input.limit, "limit");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const retryAfterSeconds = Math.ceil(input.retryAfterMs / 1000);
  const resetSeconds =
    input.resetAtMs === undefined
      ? retryAfterSeconds
      : Math.max(0, Math.ceil((input.resetAtMs - input.nowMs) / 1000));
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(input.limit),
    "RateLimit-Remaining": String(Math.max(0, input.remaining)),
    "RateLimit-Reset": String(resetSeconds),
  };
  if (input.decision === "deny") headers["Retry-After"] = String(retryAfterSeconds);
  return {
    allowed: input.decision === "allow",
    statusCode: input.decision === "allow" ? 200 : 429,
    headers,
  };
}

export function parseForwardedFor(value: string | undefined): string | undefined {
  return value
    ?.split(",")[0]
    ?.trim()
    .replace(/^\[|\]$/g, "");
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}
