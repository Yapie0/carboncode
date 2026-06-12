export type EmailDeliveryStatus = "pending" | "sent" | "retryable" | "dead-lettered" | "suppressed";

export interface EmailTemplate {
  id: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailMessage {
  id: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
}

export interface EmailDeliveryRecord {
  id: string;
  message: EmailMessage;
  status: EmailDeliveryStatus;
  createdAtMs: number;
  availableAtMs: number;
  attempt: number;
  maxAttempts: number;
  providerMessageId?: string;
  sentAtMs?: number;
  lastError?: string;
  suppressedReason?: string;
}

export interface EmailProviderResult {
  ok: boolean;
  providerMessageId?: string;
  retryable?: boolean;
  error?: string;
}

export interface EmailBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export interface EmailDeliverySummary {
  pending: number;
  sent: number;
  retryable: number;
  deadLettered: number;
  suppressed: number;
  due: number;
  total: number;
}

export function renderEmailTemplate(
  template: EmailTemplate,
  variables: Record<string, string | number | boolean>,
): Pick<EmailMessage, "subject" | "text" | "html"> {
  assertNonEmpty(template.id, "template.id");
  assertNonEmpty(template.subject, "template.subject");
  assertNonEmpty(template.text, "template.text");
  return {
    subject: renderTemplateString(template.subject, variables),
    text: renderTemplateString(template.text, variables),
    html: template.html ? renderTemplateString(template.html, variables) : undefined,
  };
}

export function createEmailMessage(input: {
  id: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
  metadata?: Record<string, string>;
}): EmailMessage {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.subject, "subject");
  assertNonEmpty(input.text, "text");
  const to = normalizeEmailRecipients(input.to);
  if (input.from) assertEmailAddress(input.from, "from");
  if (input.replyTo) assertEmailAddress(input.replyTo, "replyTo");
  return {
    id: input.id,
    to,
    subject: input.subject.trim(),
    text: input.text.trim(),
    html: input.html,
    from: input.from?.trim().toLowerCase(),
    replyTo: input.replyTo?.trim().toLowerCase(),
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function createEmailDeliveryRecord(input: {
  message: EmailMessage;
  nowMs: number;
  maxAttempts?: number;
  suppressedReason?: string;
}): EmailDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const maxAttempts = input.maxAttempts ?? 3;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  return {
    id: input.message.id,
    message: cloneEmailMessage(input.message),
    status: input.suppressedReason ? "suppressed" : "pending",
    createdAtMs: input.nowMs,
    availableAtMs: input.nowMs,
    attempt: 0,
    maxAttempts,
    suppressedReason: input.suppressedReason,
  };
}

export function applyEmailProviderResult(
  record: EmailDeliveryRecord,
  input: {
    nowMs: number;
    result: EmailProviderResult;
    backoff: EmailBackoffPolicy;
  },
): EmailDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (record.status === "suppressed") throw new Error("suppressed email cannot be delivered");
  if (record.status === "sent") throw new Error("sent email cannot be delivered again");
  if (record.status === "dead-lettered") throw new Error("dead-lettered email cannot be delivered");

  if (input.result.ok) {
    return {
      ...cloneEmailDeliveryRecord(record),
      status: "sent",
      sentAtMs: input.nowMs,
      providerMessageId: input.result.providerMessageId,
      lastError: undefined,
    };
  }

  const attempt = record.attempt + 1;
  const retryable = input.result.retryable !== false && attempt < record.maxAttempts;
  return {
    ...cloneEmailDeliveryRecord(record),
    status: retryable ? "retryable" : "dead-lettered",
    attempt,
    availableAtMs: retryable
      ? input.nowMs + calculateEmailBackoffMs(attempt, input.backoff)
      : input.nowMs,
    lastError: input.result.error ?? "email provider failed",
  };
}

export function isEmailDeliveryDue(record: EmailDeliveryRecord, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return (
    (record.status === "pending" || record.status === "retryable") && nowMs >= record.availableAtMs
  );
}

export function suppressEmailDelivery(
  record: EmailDeliveryRecord,
  input: { nowMs: number; reason: string },
): EmailDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  if (record.status === "sent") throw new Error("sent email cannot be suppressed");
  return {
    ...cloneEmailDeliveryRecord(record),
    status: "suppressed",
    availableAtMs: input.nowMs,
    suppressedReason: input.reason,
  };
}

export function rescheduleEmailDelivery(
  record: EmailDeliveryRecord,
  input: { nowMs: number; availableAtMs: number },
): EmailDeliveryRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonNegativeInteger(input.availableAtMs, "availableAtMs");
  if (record.status !== "pending" && record.status !== "retryable") {
    throw new Error("only pending or retryable email can be rescheduled");
  }
  if (input.availableAtMs < input.nowMs) {
    throw new Error("availableAtMs must be >= nowMs");
  }
  return { ...cloneEmailDeliveryRecord(record), availableAtMs: input.availableAtMs };
}

export function emailDeliverySummary(
  records: readonly EmailDeliveryRecord[],
  input: { nowMs: number },
): EmailDeliverySummary {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    pending: records.filter((record) => record.status === "pending").length,
    sent: records.filter((record) => record.status === "sent").length,
    retryable: records.filter((record) => record.status === "retryable").length,
    deadLettered: records.filter((record) => record.status === "dead-lettered").length,
    suppressed: records.filter((record) => record.status === "suppressed").length,
    due: records.filter((record) => isEmailDeliveryDue(record, input.nowMs)).length,
    total: records.length,
  };
}

export function calculateEmailBackoffMs(attempt: number, policy: EmailBackoffPolicy): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * multiplier ** (attempt - 1)));
}

export function normalizeEmailRecipients(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : [input];
  if (values.length === 0) throw new Error("to must not be empty");
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  for (const address of normalized) assertEmailAddress(address, "to");
  return normalized;
}

export function cloneEmailDeliveryRecord(record: EmailDeliveryRecord): EmailDeliveryRecord {
  return {
    ...record,
    message: cloneEmailMessage(record.message),
  };
}

function cloneEmailMessage(message: EmailMessage): EmailMessage {
  return {
    ...message,
    to: [...message.to],
    metadata: message.metadata ? { ...message.metadata } : undefined,
  };
}

function renderTemplateString(
  value: string,
  variables: Record<string, string | number | boolean>,
): string {
  return value.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    const replacement = variables[key];
    return replacement === undefined ? match : String(replacement);
  });
}

function assertEmailAddress(value: string, name: string): void {
  assertNonEmpty(value, name);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`${name} must be a valid email`);
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
