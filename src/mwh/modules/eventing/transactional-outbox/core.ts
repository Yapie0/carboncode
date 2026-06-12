export type OutboxEventStatus = "pending" | "claimed" | "published" | "failed" | "dead-letter";

export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: OutboxEventStatus;
  attempt: number;
  maxAttempts: number;
  createdAtMs: number;
  updatedAtMs: number;
  nextAttemptAtMs: number;
  claimedBy?: string;
  claimedAtMs?: number;
  publishedAtMs?: number;
  lastError?: string;
}

export interface CreateOutboxEventInput {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  nowMs: number;
  maxAttempts?: number;
}

export interface ClaimOutboxEventInput {
  event: OutboxEvent;
  workerId: string;
  nowMs: number;
  claimTimeoutMs: number;
}

export type ClaimOutboxEventResult =
  | { kind: "claimed"; event: OutboxEvent }
  | { kind: "skip"; event: OutboxEvent; reason: string };

export interface FailOutboxEventInput {
  event: OutboxEvent;
  nowMs: number;
  error: string;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface OutboxSummary {
  pending: number;
  claimed: number;
  published: number;
  failed: number;
  deadLetter: number;
  retryDue: number;
  total: number;
}

export function createOutboxEvent(input: CreateOutboxEventInput): OutboxEvent {
  assertText(input.id, "id");
  assertText(input.aggregateType, "aggregateType");
  assertText(input.aggregateId, "aggregateId");
  assertText(input.eventType, "eventType");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const maxAttempts = input.maxAttempts ?? 5;
  assertPositiveInteger(maxAttempts, "maxAttempts");

  return {
    id: input.id,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: cloneJson(input.payload),
    status: "pending",
    attempt: 0,
    maxAttempts,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    nextAttemptAtMs: input.nowMs,
  };
}

export function claimOutboxEvent(input: ClaimOutboxEventInput): ClaimOutboxEventResult {
  assertText(input.workerId, "workerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.claimTimeoutMs, "claimTimeoutMs");

  const event = input.event;
  if (event.status === "published" || event.status === "dead-letter") {
    return { kind: "skip", event, reason: `event already ${event.status}` };
  }
  if (event.nextAttemptAtMs > input.nowMs) {
    return { kind: "skip", event, reason: "event is waiting for retry delay" };
  }
  if (
    event.status === "claimed" &&
    event.claimedAtMs !== undefined &&
    event.claimedAtMs + input.claimTimeoutMs > input.nowMs
  ) {
    return { kind: "skip", event, reason: "event is actively claimed" };
  }

  return {
    kind: "claimed",
    event: {
      ...event,
      status: "claimed",
      claimedBy: input.workerId,
      claimedAtMs: input.nowMs,
      updatedAtMs: input.nowMs,
    },
  };
}

export function markOutboxPublished(event: OutboxEvent, nowMs: number): OutboxEvent {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (event.status !== "claimed")
    throw new Error(`cannot publish event from status ${event.status}`);
  return {
    ...event,
    status: "published",
    updatedAtMs: nowMs,
    publishedAtMs: nowMs,
    lastError: undefined,
  };
}

export function failOutboxEvent(input: FailOutboxEventInput): OutboxEvent {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(input.maxDelayMs, "maxDelayMs");
  if (input.event.status !== "claimed") {
    throw new Error(`cannot fail event from status ${input.event.status}`);
  }

  const attempt = input.event.attempt + 1;
  const terminal = attempt >= input.event.maxAttempts;
  return {
    ...input.event,
    status: terminal ? "dead-letter" : "failed",
    attempt,
    updatedAtMs: input.nowMs,
    nextAttemptAtMs: terminal
      ? Number.POSITIVE_INFINITY
      : input.nowMs + retryDelayMs(attempt, input.baseDelayMs, input.maxDelayMs),
    lastError: input.error,
    claimedBy: undefined,
    claimedAtMs: undefined,
  };
}

export function releaseFailedForRetry(event: OutboxEvent, nowMs: number): OutboxEvent {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (event.status !== "failed")
    throw new Error(`cannot release event from status ${event.status}`);
  if (event.nextAttemptAtMs > nowMs) return event;
  return { ...event, status: "pending", updatedAtMs: nowMs };
}

export function summarizeOutboxEvents(
  events: readonly OutboxEvent[],
  input: { nowMs: number },
): OutboxSummary {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    pending: events.filter((event) => event.status === "pending").length,
    claimed: events.filter((event) => event.status === "claimed").length,
    published: events.filter((event) => event.status === "published").length,
    failed: events.filter((event) => event.status === "failed").length,
    deadLetter: events.filter((event) => event.status === "dead-letter").length,
    retryDue: events.filter(
      (event) => event.status === "failed" && event.nextAttemptAtMs <= input.nowMs,
    ).length,
    total: events.length,
  };
}

export function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(baseDelayMs, "baseDelayMs");
  assertPositiveInteger(maxDelayMs, "maxDelayMs");
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

export function cloneOutboxEvent(event: OutboxEvent): OutboxEvent {
  return {
    ...event,
    payload: cloneJson(event.payload),
  };
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
