export type ConsumerMessageStatus = "processing" | "succeeded" | "failed" | "dead-letter";

export interface ConsumerMessageRecord {
  key: string;
  messageId: string;
  consumerName: string;
  status: ConsumerMessageStatus;
  attempt: number;
  maxAttempts: number;
  firstSeenAtMs: number;
  updatedAtMs: number;
  nextAttemptAtMs: number;
  lockedBy?: string;
  lockExpiresAtMs?: number;
  result?: unknown;
  lastError?: string;
}

export type BeginConsumeResult =
  | { kind: "started"; record: ConsumerMessageRecord }
  | { kind: "duplicate-success"; record: ConsumerMessageRecord }
  | { kind: "skip"; record: ConsumerMessageRecord; reason: string };

export interface ConsumerMessageSnapshot {
  total: number;
  processing: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
  dueForRetry: number;
}

export function consumerMessageKey(input: { consumerName: string; messageId: string }): string {
  assertText(input.consumerName, "consumerName");
  assertText(input.messageId, "messageId");
  return `${input.consumerName}\0${input.messageId}`;
}

export function createConsumerMessageRecord(input: {
  consumerName: string;
  messageId: string;
  workerId: string;
  nowMs: number;
  lockMs: number;
  maxAttempts?: number;
}): ConsumerMessageRecord {
  assertText(input.workerId, "workerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.lockMs, "lockMs");
  const maxAttempts = input.maxAttempts ?? 5;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  return {
    key: consumerMessageKey(input),
    messageId: input.messageId,
    consumerName: input.consumerName,
    status: "processing",
    attempt: 1,
    maxAttempts,
    firstSeenAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    nextAttemptAtMs: input.nowMs,
    lockedBy: input.workerId,
    lockExpiresAtMs: input.nowMs + input.lockMs,
  };
}

export function beginConsume(input: {
  existing?: ConsumerMessageRecord;
  consumerName: string;
  messageId: string;
  workerId: string;
  nowMs: number;
  lockMs: number;
  maxAttempts?: number;
}): BeginConsumeResult {
  if (!input.existing) {
    return {
      kind: "started",
      record: createConsumerMessageRecord(input),
    };
  }
  const record = input.existing;
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.lockMs, "lockMs");
  assertText(input.workerId, "workerId");

  if (record.status === "succeeded") {
    return { kind: "duplicate-success", record };
  }
  if (record.status === "dead-letter") {
    return { kind: "skip", record, reason: "message is dead-lettered" };
  }
  if (record.nextAttemptAtMs > input.nowMs) {
    return { kind: "skip", record, reason: "message is waiting for retry delay" };
  }
  if (
    record.status === "processing" &&
    record.lockExpiresAtMs !== undefined &&
    record.lockExpiresAtMs > input.nowMs
  ) {
    return { kind: "skip", record, reason: "message is actively processing" };
  }
  if (record.status === "processing") {
    return {
      kind: "started",
      record: {
        ...record,
        updatedAtMs: input.nowMs,
        lockedBy: input.workerId,
        lockExpiresAtMs: input.nowMs + input.lockMs,
      },
    };
  }
  if (record.attempt >= record.maxAttempts) {
    return {
      kind: "skip",
      record: markConsumerDeadLetter(record, input.nowMs),
      reason: "max attempts reached",
    };
  }

  return {
    kind: "started",
    record: {
      ...record,
      status: "processing",
      attempt: record.attempt + 1,
      updatedAtMs: input.nowMs,
      lockedBy: input.workerId,
      lockExpiresAtMs: input.nowMs + input.lockMs,
      lastError: undefined,
    },
  };
}

export function markConsumerSucceeded(
  record: ConsumerMessageRecord,
  input: { nowMs: number; workerId?: string; result?: unknown },
): ConsumerMessageRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertLockOwner(record, input.workerId);
  if (record.status !== "processing") {
    throw new Error(`cannot mark consumer message succeeded from status ${record.status}`);
  }
  return {
    ...record,
    status: "succeeded",
    updatedAtMs: input.nowMs,
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
    result: cloneJson(input.result),
    lastError: undefined,
  };
}

export function markConsumerFailed(
  record: ConsumerMessageRecord,
  input: {
    nowMs: number;
    error: string;
    workerId?: string;
    baseDelayMs: number;
    maxDelayMs: number;
  },
): ConsumerMessageRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertText(input.error, "error");
  assertPositiveInteger(input.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(input.maxDelayMs, "maxDelayMs");
  assertLockOwner(record, input.workerId);
  if (record.status !== "processing") {
    throw new Error(`cannot mark consumer message failed from status ${record.status}`);
  }
  const terminal = record.attempt >= record.maxAttempts;
  return {
    ...record,
    status: terminal ? "dead-letter" : "failed",
    updatedAtMs: input.nowMs,
    nextAttemptAtMs: terminal
      ? Number.POSITIVE_INFINITY
      : input.nowMs + consumerRetryDelayMs(record.attempt, input.baseDelayMs, input.maxDelayMs),
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
    lastError: input.error,
  };
}

export function markConsumerDeadLetter(
  record: ConsumerMessageRecord,
  nowMs: number,
): ConsumerMessageRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  return {
    ...record,
    status: "dead-letter",
    updatedAtMs: nowMs,
    nextAttemptAtMs: Number.POSITIVE_INFINITY,
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
  };
}

export function consumerRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(baseDelayMs, "baseDelayMs");
  assertPositiveInteger(maxDelayMs, "maxDelayMs");
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

export function consumerMessageSnapshot(
  records: readonly ConsumerMessageRecord[],
  nowMs: number,
): ConsumerMessageSnapshot {
  assertNonNegativeInteger(nowMs, "nowMs");
  return {
    total: records.length,
    processing: records.filter((record) => record.status === "processing").length,
    succeeded: records.filter((record) => record.status === "succeeded").length,
    failed: records.filter((record) => record.status === "failed").length,
    deadLetter: records.filter((record) => record.status === "dead-letter").length,
    dueForRetry: records.filter(
      (record) => record.status === "failed" && record.nextAttemptAtMs <= nowMs,
    ).length,
  };
}

export function cloneConsumerMessageRecord(record: ConsumerMessageRecord): ConsumerMessageRecord {
  return {
    ...record,
    result: cloneJson(record.result),
  };
}

function assertLockOwner(record: ConsumerMessageRecord, workerId?: string): void {
  if (workerId && record.lockedBy && record.lockedBy !== workerId) {
    throw new Error("consumer message is locked by another worker");
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
