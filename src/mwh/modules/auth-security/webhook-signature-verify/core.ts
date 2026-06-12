import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookSignatureStatus =
  | "valid"
  | "missing-header"
  | "invalid-format"
  | "timestamp-out-of-window"
  | "signature-mismatch"
  | "replay";

export interface WebhookSignatureHeaders {
  timestamp: string;
  nonce: string;
  signature: string;
}

export interface ParsedWebhookSignature {
  timestampMs: number;
  nonce: string;
  algorithm: "sha256";
  digest: string;
}

export interface WebhookSignatureVerification {
  status: WebhookSignatureStatus;
  parsed?: ParsedWebhookSignature;
  expectedSignature?: string;
}

export function signIncomingWebhook(input: {
  secret: string;
  timestampMs: number;
  nonce: string;
  body: string;
}): WebhookSignatureHeaders {
  assertNonEmpty(input.secret, "secret");
  assertNonNegativeInteger(input.timestampMs, "timestampMs");
  assertNonEmpty(input.nonce, "nonce");
  const digest = createHmac("sha256", input.secret)
    .update(createWebhookSigningPayload(input))
    .digest("hex");
  return {
    timestamp: String(input.timestampMs),
    nonce: input.nonce,
    signature: `sha256=${digest}`,
  };
}

export function parseWebhookSignatureHeaders(input: {
  timestamp?: string;
  nonce?: string;
  signature?: string;
}): ParsedWebhookSignature | { error: WebhookSignatureStatus } {
  if (!input.timestamp || !input.nonce || !input.signature) {
    return { error: "missing-header" };
  }
  if (!/^\d+$/.test(input.timestamp)) return { error: "invalid-format" };
  if (!input.nonce.trim()) return { error: "invalid-format" };
  const match = /^sha256=([a-f0-9]{64})$/i.exec(input.signature.trim());
  if (!match) return { error: "invalid-format" };
  return {
    timestampMs: Number(input.timestamp),
    nonce: input.nonce,
    algorithm: "sha256",
    digest: match[1]!.toLowerCase(),
  };
}

export function verifyIncomingWebhookSignature(input: {
  secret: string;
  nowMs: number;
  toleranceMs: number;
  body: string;
  headers: {
    timestamp?: string;
    nonce?: string;
    signature?: string;
  };
  replayed?: boolean;
}): WebhookSignatureVerification {
  assertNonEmpty(input.secret, "secret");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.toleranceMs, "toleranceMs");
  const parsed = parseWebhookSignatureHeaders(input.headers);
  if ("error" in parsed) return { status: parsed.error };
  if (Math.abs(input.nowMs - parsed.timestampMs) > input.toleranceMs) {
    return { status: "timestamp-out-of-window", parsed };
  }
  if (input.replayed) return { status: "replay", parsed };

  const expected = signIncomingWebhook({
    secret: input.secret,
    timestampMs: parsed.timestampMs,
    nonce: parsed.nonce,
    body: input.body,
  }).signature;
  const actual = `sha256=${parsed.digest}`;
  if (!timingSafeStringEqual(expected, actual)) {
    return { status: "signature-mismatch", parsed, expectedSignature: expected };
  }
  return { status: "valid", parsed, expectedSignature: expected };
}

export function createWebhookSigningPayload(input: {
  timestampMs: number;
  nonce: string;
  body: string;
}): string {
  assertNonNegativeInteger(input.timestampMs, "timestampMs");
  assertNonEmpty(input.nonce, "nonce");
  return `${input.timestampMs}.${input.nonce}.${input.body}`;
}

export function nonceExpiresAt(input: { timestampMs: number; toleranceMs: number }): number {
  assertNonNegativeInteger(input.timestampMs, "timestampMs");
  assertPositiveInteger(input.toleranceMs, "toleranceMs");
  return input.timestampMs + input.toleranceMs;
}

function timingSafeStringEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
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
