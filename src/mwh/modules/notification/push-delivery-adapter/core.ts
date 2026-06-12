export type PushPlatform = "apns" | "fcm" | "web";
export type PushDeliveryStatus = "pending" | "sent" | "retryable" | "dead-lettered" | "suppressed";

export interface PushTarget {
  userId: string;
  platform: PushPlatform;
  token: string;
  enabled: boolean;
}

export interface PushMessage {
  id: string;
  userId: string;
  platform: PushPlatform;
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  collapseKey?: string;
  ttlMs?: number;
}

export interface PushDeliveryRecord {
  id: string;
  message: PushMessage;
  status: PushDeliveryStatus;
  createdAtMs: number;
  availableAtMs: number;
  attempt: number;
  maxAttempts: number;
  providerMessageId?: string;
  sentAtMs?: number;
  lastError?: string;
  suppressedReason?: string;
}

export interface PushProviderResult {
  ok: boolean;
  providerMessageId?: string;
  retryable?: boolean;
  invalidToken?: boolean;
  error?: string;
}

export interface PushBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export interface PushDeliverySummary {
  pending: number;
  sent: number;
  retryable: number;
  deadLettered: number;
  suppressed: number;
  due: number;
  total: number;
}

export function createPushTarget(input: {
  userId: string;
  platform: PushPlatform;
  token: string;
  enabled?: boolean;
}): PushTarget {
  assertNonEmpty(input.userId, "userId");
  assertPlatform(input.platform);
  assertNonEmpty(input.token, "token");
  return {
    userId: input.userId,
    platform: input.platform,
    token: input.token.trim(),
    enabled: input.enabled ?? true,
  };
}

export function createPushMessage(input: {
  id: string;
  userId: string;
  platform: PushPlatform;
  token: string;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
  collapseKey?: string;
  ttlMs?: number;
}): PushMessage {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.userId, "userId");
  assertPlatform(input.platform);
  assertNonEmpty(input.token, "token");
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.body, "body");
  if (input.ttlMs !== undefined) assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    id: input.id,
    userId: input.userId,
    platform: input.platform,
    token: input.token.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
    data: input.data ? normalizePushData(input.data) : undefined,
    collapseKey: input.collapseKey?.trim(),
    ttlMs: input.ttlMs,
  };
}

export function planPushMessages(input: {
  id: string;
  userId: string;
  title: string;
  body: string;
  targets: readonly PushTarget[];
  data?: Record<string, string | number | boolean>;
  collapseKey?: string;
  ttlMs?: number;
}): PushMessage[] {
  assertNonEmpty(input.id, "id");
  const targets = input.targets.filter(
    (target) => target.userId === input.userId && target.enabled,
  );
  return targets.map((target, index) =>
    createPushMessage({
      id: `${input.id}:${target.platform}:${index}`,
      userId: input.userId,
      platform: target.platform,
      token: target.token,
      title: input.title,
      body: input.body,
      data: input.data,
      collapseKey: input.collapseKey,
      ttlMs: input.ttlMs,
    }),
  );
}

export function createPushDeliveryRecord(input: {
  message: PushMessage;
  nowMs: number;
  maxAttempts?: number;
  suppressedReason?: string;
}): PushDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const maxAttempts = input.maxAttempts ?? 3;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  return {
    id: input.message.id,
    message: clonePushMessage(input.message),
    status: input.suppressedReason ? "suppressed" : "pending",
    createdAtMs: input.nowMs,
    availableAtMs: input.nowMs,
    attempt: 0,
    maxAttempts,
    suppressedReason: input.suppressedReason,
  };
}

export function applyPushProviderResult(
  record: PushDeliveryRecord,
  input: {
    nowMs: number;
    result: PushProviderResult;
    backoff: PushBackoffPolicy;
  },
): PushDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (record.status === "suppressed") throw new Error("suppressed push cannot be delivered");
  if (record.status === "sent") throw new Error("sent push cannot be delivered again");
  if (record.status === "dead-lettered") throw new Error("dead-lettered push cannot be delivered");

  if (input.result.ok) {
    return {
      ...clonePushDeliveryRecord(record),
      status: "sent",
      sentAtMs: input.nowMs,
      providerMessageId: input.result.providerMessageId,
      lastError: undefined,
    };
  }

  const attempt = record.attempt + 1;
  const retryable =
    input.result.retryable !== false && !input.result.invalidToken && attempt < record.maxAttempts;
  return {
    ...clonePushDeliveryRecord(record),
    status: retryable ? "retryable" : "dead-lettered",
    attempt,
    availableAtMs: retryable
      ? input.nowMs + calculatePushBackoffMs(attempt, input.backoff)
      : input.nowMs,
    lastError: input.result.error ?? "push provider failed",
  };
}

export function isPushDeliveryDue(record: PushDeliveryRecord, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  const notExpired =
    record.message.ttlMs === undefined || nowMs < record.createdAtMs + record.message.ttlMs;
  return (
    notExpired &&
    (record.status === "pending" || record.status === "retryable") &&
    nowMs >= record.availableAtMs
  );
}

export function expirePushDelivery(record: PushDeliveryRecord, nowMs: number): PushDeliveryRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.message.ttlMs === undefined || nowMs < record.createdAtMs + record.message.ttlMs) {
    return clonePushDeliveryRecord(record);
  }
  if (record.status === "pending" || record.status === "retryable") {
    return {
      ...clonePushDeliveryRecord(record),
      status: "dead-lettered",
      lastError: "push TTL expired",
      availableAtMs: nowMs,
    };
  }
  return clonePushDeliveryRecord(record);
}

export function suppressPushDelivery(
  record: PushDeliveryRecord,
  input: { nowMs: number; reason: string },
): PushDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  if (record.status === "sent") throw new Error("sent push cannot be suppressed");
  return {
    ...clonePushDeliveryRecord(record),
    status: "suppressed",
    availableAtMs: input.nowMs,
    suppressedReason: input.reason,
  };
}

export function reschedulePushDelivery(
  record: PushDeliveryRecord,
  input: { nowMs: number; availableAtMs: number },
): PushDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonNegativeInteger(input.availableAtMs, "availableAtMs");
  if (record.status !== "pending" && record.status !== "retryable") {
    throw new Error("only pending or retryable push can be rescheduled");
  }
  if (input.availableAtMs < input.nowMs) throw new Error("availableAtMs must be >= nowMs");
  return { ...clonePushDeliveryRecord(record), availableAtMs: input.availableAtMs };
}

export function pushDeliverySummary(
  records: readonly PushDeliveryRecord[],
  input: { nowMs: number },
): PushDeliverySummary {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const current = records.map((record) => expirePushDelivery(record, input.nowMs));
  return {
    pending: current.filter((record) => record.status === "pending").length,
    sent: current.filter((record) => record.status === "sent").length,
    retryable: current.filter((record) => record.status === "retryable").length,
    deadLettered: current.filter((record) => record.status === "dead-lettered").length,
    suppressed: current.filter((record) => record.status === "suppressed").length,
    due: current.filter((record) => isPushDeliveryDue(record, input.nowMs)).length,
    total: current.length,
  };
}

export function calculatePushBackoffMs(attempt: number, policy: PushBackoffPolicy): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * multiplier ** (attempt - 1)));
}

export function clonePushDeliveryRecord(record: PushDeliveryRecord): PushDeliveryRecord {
  return {
    ...record,
    message: clonePushMessage(record.message),
  };
}

function clonePushMessage(message: PushMessage): PushMessage {
  return {
    ...message,
    data: message.data ? { ...message.data } : undefined,
  };
}

function normalizePushData(
  input: Record<string, string | number | boolean>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)]));
}

function assertPlatform(platform: PushPlatform): void {
  if (!["apns", "fcm", "web"].includes(platform))
    throw new Error(`unsupported push platform: ${platform}`);
}

function assertNonEmpty(value: string, name: string): void {
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
