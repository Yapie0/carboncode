export type SmsDeliveryStatus = "pending" | "sent" | "retryable" | "dead-lettered" | "suppressed";

export interface SmsMessage {
  id: string;
  to: string;
  body: string;
  from?: string;
  metadata?: Record<string, string>;
  segmentCount: number;
}

export interface SmsDeliveryRecord {
  id: string;
  message: SmsMessage;
  status: SmsDeliveryStatus;
  createdAtMs: number;
  availableAtMs: number;
  attempt: number;
  maxAttempts: number;
  providerMessageId?: string;
  sentAtMs?: number;
  lastError?: string;
  suppressedReason?: string;
}

export interface SmsProviderResult {
  ok: boolean;
  providerMessageId?: string;
  retryable?: boolean;
  error?: string;
}

export interface SmsBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export interface SmsDeliverySummary {
  pending: number;
  sent: number;
  retryable: number;
  deadLettered: number;
  suppressed: number;
  due: number;
  total: number;
}

export function normalizeSmsPhoneNumber(value: string): string {
  assertNonEmpty(value, "phone");
  const compact = value.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw new Error("phone must be an E.164 number");
  }
  return compact;
}

export function estimateSmsSegments(body: string): number {
  assertNonEmpty(body, "body");
  const normalized = body.trim();
  const singleLimit = isGsm7(normalized) ? 160 : 70;
  const multiLimit = isGsm7(normalized) ? 153 : 67;
  if (normalized.length <= singleLimit) return 1;
  return Math.ceil(normalized.length / multiLimit);
}

export function createSmsMessage(input: {
  id: string;
  to: string;
  body: string;
  from?: string;
  metadata?: Record<string, string>;
}): SmsMessage {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.body, "body");
  if (input.from) assertNonEmpty(input.from, "from");
  const body = input.body.trim();
  return {
    id: input.id,
    to: normalizeSmsPhoneNumber(input.to),
    body,
    from: input.from?.trim(),
    metadata: input.metadata ? { ...input.metadata } : undefined,
    segmentCount: estimateSmsSegments(body),
  };
}

export function createSmsDeliveryRecord(input: {
  message: SmsMessage;
  nowMs: number;
  maxAttempts?: number;
  suppressedReason?: string;
}): SmsDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const maxAttempts = input.maxAttempts ?? 3;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  return {
    id: input.message.id,
    message: cloneSmsMessage(input.message),
    status: input.suppressedReason ? "suppressed" : "pending",
    createdAtMs: input.nowMs,
    availableAtMs: input.nowMs,
    attempt: 0,
    maxAttempts,
    suppressedReason: input.suppressedReason,
  };
}

export function applySmsProviderResult(
  record: SmsDeliveryRecord,
  input: {
    nowMs: number;
    result: SmsProviderResult;
    backoff: SmsBackoffPolicy;
  },
): SmsDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (record.status === "suppressed") throw new Error("suppressed SMS cannot be delivered");
  if (record.status === "sent") throw new Error("sent SMS cannot be delivered again");
  if (record.status === "dead-lettered") throw new Error("dead-lettered SMS cannot be delivered");

  if (input.result.ok) {
    return {
      ...cloneSmsDeliveryRecord(record),
      status: "sent",
      sentAtMs: input.nowMs,
      providerMessageId: input.result.providerMessageId,
      lastError: undefined,
    };
  }

  const attempt = record.attempt + 1;
  const retryable = input.result.retryable !== false && attempt < record.maxAttempts;
  return {
    ...cloneSmsDeliveryRecord(record),
    status: retryable ? "retryable" : "dead-lettered",
    attempt,
    availableAtMs: retryable
      ? input.nowMs + calculateSmsBackoffMs(attempt, input.backoff)
      : input.nowMs,
    lastError: input.result.error ?? "SMS provider failed",
  };
}

export function isSmsDeliveryDue(record: SmsDeliveryRecord, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return (
    (record.status === "pending" || record.status === "retryable") && nowMs >= record.availableAtMs
  );
}

export function suppressSmsDelivery(
  record: SmsDeliveryRecord,
  input: { nowMs: number; reason: string },
): SmsDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  if (record.status === "sent") throw new Error("sent SMS cannot be suppressed");
  return {
    ...cloneSmsDeliveryRecord(record),
    status: "suppressed",
    availableAtMs: input.nowMs,
    suppressedReason: input.reason,
  };
}

export function rescheduleSmsDelivery(
  record: SmsDeliveryRecord,
  input: { nowMs: number; availableAtMs: number },
): SmsDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonNegativeInteger(input.availableAtMs, "availableAtMs");
  if (record.status !== "pending" && record.status !== "retryable") {
    throw new Error("only pending or retryable SMS can be rescheduled");
  }
  if (input.availableAtMs < input.nowMs) throw new Error("availableAtMs must be >= nowMs");
  return { ...cloneSmsDeliveryRecord(record), availableAtMs: input.availableAtMs };
}

export function smsDeliverySummary(
  records: readonly SmsDeliveryRecord[],
  input: { nowMs: number },
): SmsDeliverySummary {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    pending: records.filter((record) => record.status === "pending").length,
    sent: records.filter((record) => record.status === "sent").length,
    retryable: records.filter((record) => record.status === "retryable").length,
    deadLettered: records.filter((record) => record.status === "dead-lettered").length,
    suppressed: records.filter((record) => record.status === "suppressed").length,
    due: records.filter((record) => isSmsDeliveryDue(record, input.nowMs)).length,
    total: records.length,
  };
}

export function calculateSmsBackoffMs(attempt: number, policy: SmsBackoffPolicy): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * multiplier ** (attempt - 1)));
}

export function cloneSmsDeliveryRecord(record: SmsDeliveryRecord): SmsDeliveryRecord {
  return {
    ...record,
    message: cloneSmsMessage(record.message),
  };
}

function cloneSmsMessage(message: SmsMessage): SmsMessage {
  return {
    ...message,
    metadata: message.metadata ? { ...message.metadata } : undefined,
  };
}

function isGsm7(value: string): boolean {
  const extended = "€£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ";
  return [...value].every((char) => {
    const code = char.charCodeAt(0);
    return code === 10 || code === 13 || (code >= 32 && code <= 126) || extended.includes(char);
  });
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
