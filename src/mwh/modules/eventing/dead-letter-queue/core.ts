export type DeadLetterStatus = "queued" | "replaying" | "resolved" | "archived";

export type DeadLetterReason = "max-attempts" | "poison-message" | "schema-error" | "handler-error";

export interface DeadLetterMessage {
  id: string;
  source: string;
  messageId: string;
  reason: DeadLetterReason;
  payload: unknown;
  headers: Record<string, string>;
  error: string;
  status: DeadLetterStatus;
  attempts: number;
  createdAtMs: number;
  updatedAtMs: number;
  replayedAtMs?: number;
  resolvedAtMs?: number;
  archivedAtMs?: number;
  lockedBy?: string;
  lockExpiresAtMs?: number;
  note?: string;
}

export interface DeadLetterSnapshot {
  queued: number;
  replaying: number;
  resolved: number;
  archived: number;
  byReason: Record<DeadLetterReason, number>;
  bySource: Record<string, number>;
}

export interface DeadLetterReplayClaim {
  kind: "claimed" | "skip";
  message: DeadLetterMessage;
  reason?: string;
}

export interface DeadLetterPurgeResult {
  purged: DeadLetterMessage[];
  retained: DeadLetterMessage[];
}

export function deadLetterId(input: { source: string; messageId: string }): string {
  assertText(input.source, "source");
  assertText(input.messageId, "messageId");
  return `${input.source}\0${input.messageId}`;
}

export function createDeadLetterMessage(input: {
  source: string;
  messageId: string;
  reason: DeadLetterReason;
  payload: unknown;
  headers?: Record<string, string>;
  error: string;
  attempts: number;
  nowMs: number;
}): DeadLetterMessage {
  assertText(input.error, "error");
  assertPositiveInteger(input.attempts, "attempts");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertDeadLetterReason(input.reason);
  return {
    id: deadLetterId(input),
    source: input.source,
    messageId: input.messageId,
    reason: input.reason,
    payload: cloneJson(input.payload),
    headers: normalizeHeaders(input.headers ?? {}),
    error: input.error,
    status: "queued",
    attempts: input.attempts,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

export function claimDeadLetterForReplay(input: {
  message: DeadLetterMessage;
  workerId: string;
  nowMs: number;
  lockMs: number;
}): DeadLetterReplayClaim {
  assertText(input.workerId, "workerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.lockMs, "lockMs");

  if (input.message.status === "resolved" || input.message.status === "archived") {
    return {
      kind: "skip",
      message: cloneDeadLetterMessage(input.message),
      reason: `message already ${input.message.status}`,
    };
  }
  if (
    input.message.status === "replaying" &&
    input.message.lockExpiresAtMs !== undefined &&
    input.message.lockExpiresAtMs > input.nowMs
  ) {
    return {
      kind: "skip",
      message: cloneDeadLetterMessage(input.message),
      reason: "message is actively replaying",
    };
  }

  return {
    kind: "claimed",
    message: cloneDeadLetterMessage({
      ...input.message,
      status: "replaying",
      updatedAtMs: input.nowMs,
      replayedAtMs: input.nowMs,
      lockedBy: input.workerId,
      lockExpiresAtMs: input.nowMs + input.lockMs,
    }),
  };
}

export function releaseDeadLetterReplay(
  message: DeadLetterMessage,
  input: { nowMs: number; workerId?: string; error: string },
): DeadLetterMessage {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertText(input.error, "error");
  assertLockOwner(message, input.workerId);
  if (message.status !== "replaying") {
    throw new Error(`cannot release dead-letter from status ${message.status}`);
  }
  return cloneDeadLetterMessage({
    ...message,
    status: "queued",
    updatedAtMs: input.nowMs,
    error: input.error,
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
  });
}

export function requeueDeadLetter(
  message: DeadLetterMessage,
  input: { nowMs: number; note?: string },
): DeadLetterMessage {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (message.status === "archived") throw new Error("cannot requeue archived dead-letter");
  return cloneDeadLetterMessage({
    ...message,
    status: "queued",
    updatedAtMs: input.nowMs,
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
    note: input.note,
  });
}

export function resolveDeadLetter(
  message: DeadLetterMessage,
  input: { nowMs: number; workerId?: string; note?: string },
): DeadLetterMessage {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertLockOwner(message, input.workerId);
  if (message.status === "archived") throw new Error("cannot resolve archived dead-letter");
  if (message.status === "resolved") return cloneDeadLetterMessage(message);
  return cloneDeadLetterMessage({
    ...message,
    status: "resolved",
    updatedAtMs: input.nowMs,
    resolvedAtMs: input.nowMs,
    note: input.note,
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
  });
}

export function archiveDeadLetter(
  message: DeadLetterMessage,
  input: { nowMs: number; note?: string },
): DeadLetterMessage {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (message.status === "replaying") throw new Error("cannot archive active replay");
  if (message.status === "archived") return cloneDeadLetterMessage(message);
  return cloneDeadLetterMessage({
    ...message,
    status: "archived",
    updatedAtMs: input.nowMs,
    archivedAtMs: input.nowMs,
    note: input.note,
    lockedBy: undefined,
    lockExpiresAtMs: undefined,
  });
}

export function deadLetterSnapshot(messages: readonly DeadLetterMessage[]): DeadLetterSnapshot {
  const byReason = emptyReasonCounts();
  const bySource: Record<string, number> = {};
  for (const message of messages) {
    byReason[message.reason] += 1;
    bySource[message.source] = (bySource[message.source] ?? 0) + 1;
  }
  return {
    queued: messages.filter((message) => message.status === "queued").length,
    replaying: messages.filter((message) => message.status === "replaying").length,
    resolved: messages.filter((message) => message.status === "resolved").length,
    archived: messages.filter((message) => message.status === "archived").length,
    byReason,
    bySource,
  };
}

export function purgeArchivedDeadLetters(
  messages: readonly DeadLetterMessage[],
  input: { olderThanMs: number; nowMs: number },
): DeadLetterPurgeResult {
  assertNonNegativeInteger(input.olderThanMs, "olderThanMs");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const purged: DeadLetterMessage[] = [];
  const retained: DeadLetterMessage[] = [];
  for (const message of messages) {
    const archiveAgeMs =
      message.status === "archived" && message.archivedAtMs !== undefined
        ? input.nowMs - message.archivedAtMs
        : -1;
    if (archiveAgeMs >= input.olderThanMs) {
      purged.push(cloneDeadLetterMessage(message));
    } else {
      retained.push(cloneDeadLetterMessage(message));
    }
  }
  return { purged, retained };
}

export function cloneDeadLetterMessage(message: DeadLetterMessage): DeadLetterMessage {
  return {
    ...message,
    payload: cloneJson(message.payload),
    headers: { ...message.headers },
  };
}

function emptyReasonCounts(): Record<DeadLetterReason, number> {
  return {
    "handler-error": 0,
    "max-attempts": 0,
    "poison-message": 0,
    "schema-error": 0,
  };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
}

function assertLockOwner(message: DeadLetterMessage, workerId?: string): void {
  if (workerId && message.lockedBy && message.lockedBy !== workerId) {
    throw new Error("dead-letter message is locked by another worker");
  }
}

function assertDeadLetterReason(reason: DeadLetterReason): void {
  if (!["max-attempts", "poison-message", "schema-error", "handler-error"].includes(reason)) {
    throw new Error("unsupported dead-letter reason");
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
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
