import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookDeliveryStatus =
  | "pending"
  | "in-flight"
  | "delivered"
  | "retryable"
  | "dead-lettered";

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  url: string;
  eventType: string;
  payload: unknown;
  createdAtMs: number;
  availableAtMs: number;
  attempt: number;
  maxAttempts: number;
  status: WebhookDeliveryStatus;
  claimedBy?: string;
  claimExpiresAtMs?: number;
  lastError?: string;
  deliveredAtMs?: number;
}

export interface WebhookSignatureInput {
  secret: string;
  timestampMs: number;
  body: string;
}

export interface WebhookSignatureHeaders {
  timestamp: string;
  signature: string;
}

export interface WebhookBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export function createWebhookDelivery(input: {
  id: string;
  endpointId: string;
  url: string;
  eventType: string;
  payload: unknown;
  nowMs: number;
  maxAttempts?: number;
}): WebhookDelivery {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.endpointId, "endpointId");
  assertNonEmpty(input.url, "url");
  assertNonEmpty(input.eventType, "eventType");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const maxAttempts = input.maxAttempts ?? 5;
  assertPositiveInteger(maxAttempts, "maxAttempts");

  return {
    id: input.id,
    endpointId: input.endpointId,
    url: input.url,
    eventType: input.eventType,
    payload: cloneJson(input.payload),
    createdAtMs: input.nowMs,
    availableAtMs: input.nowMs,
    attempt: 0,
    maxAttempts,
    status: "pending",
  };
}

export function signWebhook(input: WebhookSignatureInput): WebhookSignatureHeaders {
  assertNonEmpty(input.secret, "secret");
  assertNonNegativeInteger(input.timestampMs, "timestampMs");
  const timestamp = String(input.timestampMs);
  const signature = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.body}`)
    .digest("hex");
  return { timestamp, signature: `sha256=${signature}` };
}

export function verifyWebhookSignature(
  input: WebhookSignatureInput & { signature: string },
): boolean {
  const expected = signWebhook(input).signature;
  const actual = input.signature;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

export function claimWebhookDelivery(
  delivery: WebhookDelivery,
  input: { nowMs: number; workerId: string; leaseMs: number },
): WebhookDelivery | undefined {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.leaseMs, "leaseMs");
  assertNonEmpty(input.workerId, "workerId");

  if (delivery.status === "delivered" || delivery.status === "dead-lettered") return undefined;
  if (input.nowMs < delivery.availableAtMs) return undefined;
  if (
    delivery.status === "in-flight" &&
    delivery.claimExpiresAtMs !== undefined &&
    input.nowMs < delivery.claimExpiresAtMs &&
    delivery.claimedBy !== input.workerId
  ) {
    return undefined;
  }

  return {
    ...delivery,
    status: "in-flight",
    claimedBy: input.workerId,
    claimExpiresAtMs: input.nowMs + input.leaseMs,
  };
}

export function markWebhookDelivered(
  delivery: WebhookDelivery,
  input: { nowMs: number; workerId?: string },
): WebhookDelivery {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertOwner(delivery, input.workerId);
  return {
    ...delivery,
    status: "delivered",
    deliveredAtMs: input.nowMs,
    claimedBy: undefined,
    claimExpiresAtMs: undefined,
    lastError: undefined,
  };
}

export function markWebhookFailed(
  delivery: WebhookDelivery,
  input: {
    nowMs: number;
    error: string;
    workerId?: string;
    backoff: WebhookBackoffPolicy;
  },
): WebhookDelivery {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.error, "error");
  assertOwner(delivery, input.workerId);
  const nextAttempt = delivery.attempt + 1;
  const status: WebhookDeliveryStatus =
    nextAttempt >= delivery.maxAttempts ? "dead-lettered" : "retryable";

  return {
    ...delivery,
    status,
    attempt: nextAttempt,
    availableAtMs:
      status === "retryable"
        ? input.nowMs + calculateWebhookBackoffMs(nextAttempt, input.backoff)
        : input.nowMs,
    claimedBy: undefined,
    claimExpiresAtMs: undefined,
    lastError: input.error,
  };
}

export function releaseExpiredWebhookClaim(
  delivery: WebhookDelivery,
  nowMs: number,
): WebhookDelivery {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (
    delivery.status !== "in-flight" ||
    delivery.claimExpiresAtMs === undefined ||
    nowMs < delivery.claimExpiresAtMs
  ) {
    return delivery;
  }
  return {
    ...delivery,
    status: "retryable",
    claimedBy: undefined,
    claimExpiresAtMs: undefined,
    availableAtMs: nowMs,
    lastError: "claim expired",
  };
}

export function calculateWebhookBackoffMs(attempt: number, policy: WebhookBackoffPolicy): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  const delay = policy.baseDelayMs * multiplier ** Math.max(0, attempt - 1);
  return Math.min(policy.maxDelayMs, Math.round(delay));
}

export function cloneWebhookDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return {
    ...delivery,
    payload: cloneJson(delivery.payload),
  };
}

function assertOwner(delivery: WebhookDelivery, workerId?: string): void {
  if (workerId && delivery.claimedBy && delivery.claimedBy !== workerId) {
    throw new Error("delivery is claimed by another worker");
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
