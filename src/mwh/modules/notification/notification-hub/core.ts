import type { NotificationChannel } from "../notification-router/core.js";

export type NotificationDeliveryStatus =
  | "pending"
  | "sent"
  | "retryable"
  | "dead-lettered"
  | "suppressed";

export interface NotificationEnvelope {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
  createdAtMs: number;
  data?: Record<string, string | number | boolean>;
}

export interface NotificationContact {
  userId: string;
  channel: NotificationChannel;
  destination: string;
  enabled: boolean;
}

export interface NotificationDelivery {
  id: string;
  messageId: string;
  userId: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  createdAtMs: number;
  availableAtMs: number;
  attempt: number;
  maxAttempts: number;
  destination?: string;
  providerMessageId?: string;
  sentAtMs?: number;
  lastError?: string;
  suppressedReason?: string;
}

export interface NotificationBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export function createNotificationEnvelope(input: {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  priority?: NotificationEnvelope["priority"];
  createdAtMs: number;
  data?: Record<string, string | number | boolean>;
}): NotificationEnvelope {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.userId, "userId");
  assertNonEmpty(input.type, "type");
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.body, "body");
  assertNonNegativeInteger(input.createdAtMs, "createdAtMs");
  return {
    id: input.id,
    userId: input.userId,
    type: input.type,
    title: input.title.trim(),
    body: input.body.trim(),
    priority: input.priority ?? "normal",
    createdAtMs: input.createdAtMs,
    data: input.data ? { ...input.data } : undefined,
  };
}

export function createNotificationContact(input: {
  userId: string;
  channel: NotificationChannel;
  destination: string;
  enabled?: boolean;
}): NotificationContact {
  assertNonEmpty(input.userId, "userId");
  assertChannel(input.channel);
  assertNonEmpty(input.destination, "destination");
  return {
    userId: input.userId,
    channel: input.channel,
    destination: input.destination.trim(),
    enabled: input.enabled ?? true,
  };
}

export function planNotificationDeliveries(input: {
  envelope: NotificationEnvelope;
  channels: readonly NotificationChannel[];
  contacts: readonly NotificationContact[];
  nowMs: number;
  maxAttempts?: number;
}): NotificationDelivery[] {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertChannels(input.channels);
  const maxAttempts = input.maxAttempts ?? 3;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  const contactsByChannel = new Map(
    input.contacts
      .filter((contact) => contact.userId === input.envelope.userId)
      .map((contact) => [contact.channel, contact]),
  );
  return [...new Set(input.channels)].map((channel) => {
    const contact = contactsByChannel.get(channel);
    const base = {
      id: `${input.envelope.id}:${channel}`,
      messageId: input.envelope.id,
      userId: input.envelope.userId,
      channel,
      createdAtMs: input.nowMs,
      availableAtMs: input.nowMs,
      attempt: 0,
      maxAttempts,
    };
    if (!contact) {
      return { ...base, status: "suppressed", suppressedReason: "missing contact" };
    }
    if (!contact.enabled) {
      return { ...base, status: "suppressed", suppressedReason: "contact disabled" };
    }
    return { ...base, status: "pending", destination: contact.destination };
  });
}

export function markNotificationSent(
  delivery: NotificationDelivery,
  input: { nowMs: number; providerMessageId?: string },
): NotificationDelivery {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (delivery.status === "suppressed") throw new Error("suppressed delivery cannot be sent");
  if (delivery.status === "dead-lettered") throw new Error("dead-lettered delivery cannot be sent");
  return {
    ...delivery,
    status: "sent",
    sentAtMs: input.nowMs,
    providerMessageId: input.providerMessageId,
    lastError: undefined,
  };
}

export function markNotificationFailed(
  delivery: NotificationDelivery,
  input: { nowMs: number; error: string; backoff: NotificationBackoffPolicy },
): NotificationDelivery {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.error, "error");
  if (delivery.status === "suppressed") throw new Error("suppressed delivery cannot fail");
  if (delivery.status === "sent") throw new Error("sent delivery cannot fail");
  const attempt = delivery.attempt + 1;
  const status: NotificationDeliveryStatus =
    attempt >= delivery.maxAttempts ? "dead-lettered" : "retryable";
  return {
    ...delivery,
    status,
    attempt,
    availableAtMs:
      status === "retryable"
        ? input.nowMs + calculateNotificationBackoffMs(attempt, input.backoff)
        : input.nowMs,
    lastError: input.error,
  };
}

export function isNotificationDue(delivery: NotificationDelivery, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return (
    (delivery.status === "pending" || delivery.status === "retryable") &&
    nowMs >= delivery.availableAtMs
  );
}

export function calculateNotificationBackoffMs(
  attempt: number,
  policy: NotificationBackoffPolicy,
): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * multiplier ** (attempt - 1)));
}

function assertChannels(channels: readonly NotificationChannel[]): void {
  if (channels.length === 0) throw new Error("channels must not be empty");
  for (const channel of channels) assertChannel(channel);
}

function assertChannel(channel: NotificationChannel): void {
  if (!["email", "sms", "push", "in-app", "webhook"].includes(channel)) {
    throw new Error(`unsupported notification channel: ${channel}`);
  }
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
