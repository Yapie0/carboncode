import { createHash } from "node:crypto";

export type IdempotencyRecordStatus = "processing" | "completed" | "failed";
export type IdempotencyDecisionKind = "start" | "replay" | "conflict" | "in-flight" | "expired";

export interface IdempotencyRequest {
  method: string;
  route: string;
  body?: unknown;
  actor?: string;
}

export interface IdempotencyResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  status: IdempotencyRecordStatus;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  response?: IdempotencyResponse;
}

export interface EvaluateIdempotencyInput {
  key: string;
  request: IdempotencyRequest;
  nowMs: number;
  ttlMs: number;
  existing?: IdempotencyRecord;
}

export type IdempotencyDecision =
  | { kind: "start"; record: IdempotencyRecord }
  | { kind: "replay"; record: IdempotencyRecord; response: IdempotencyResponse }
  | { kind: "conflict"; record: IdempotencyRecord; reason: string }
  | { kind: "in-flight"; record: IdempotencyRecord; retryAfterMs: number }
  | { kind: "expired"; record: IdempotencyRecord; next: IdempotencyRecord };

export function fingerprintRequest(request: IdempotencyRequest): string {
  const normalized = {
    method: request.method.trim().toUpperCase(),
    route: normalizeRoute(request.route),
    actor: request.actor ?? "",
    body: normalizeJsonValue(request.body ?? null),
  };
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export function evaluateIdempotency(input: EvaluateIdempotencyInput): IdempotencyDecision {
  assertKey(input.key);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");

  const fingerprint = fingerprintRequest(input.request);
  const next = newProcessingRecord(input.key, fingerprint, input.nowMs, input.ttlMs);
  if (!input.existing) return { kind: "start", record: next };

  if (input.existing.expiresAtMs <= input.nowMs) {
    return { kind: "expired", record: input.existing, next };
  }

  if (input.existing.fingerprint !== fingerprint) {
    return {
      kind: "conflict",
      record: input.existing,
      reason: "idempotency key reused with a different request fingerprint",
    };
  }

  if (input.existing.status === "completed" && input.existing.response) {
    return { kind: "replay", record: input.existing, response: input.existing.response };
  }

  return {
    kind: "in-flight",
    record: input.existing,
    retryAfterMs: Math.max(1, Math.min(1000, input.existing.expiresAtMs - input.nowMs)),
  };
}

export function completeIdempotencyRecord(
  record: IdempotencyRecord,
  response: IdempotencyResponse,
  nowMs: number,
): IdempotencyRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.status !== "processing") {
    throw new Error(`cannot complete idempotency record from status ${record.status}`);
  }
  return {
    ...record,
    status: "completed",
    updatedAtMs: nowMs,
    response: cloneResponse(response),
  };
}

export function failIdempotencyRecord(record: IdempotencyRecord, nowMs: number): IdempotencyRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.status !== "processing") {
    throw new Error(`cannot fail idempotency record from status ${record.status}`);
  }
  return { ...record, status: "failed", updatedAtMs: nowMs };
}

export function cloneIdempotencyResponse(response: IdempotencyResponse): IdempotencyResponse {
  return cloneResponse(response);
}

export function cloneIdempotencyRecord(record: IdempotencyRecord): IdempotencyRecord {
  return {
    ...record,
    response: record.response ? cloneResponse(record.response) : undefined,
  };
}

export function cloneIdempotencyDecision(decision: IdempotencyDecision): IdempotencyDecision {
  if (decision.kind === "replay") {
    return {
      ...decision,
      record: cloneIdempotencyRecord(decision.record),
      response: cloneResponse(decision.response),
    };
  }
  if (decision.kind === "expired") {
    return {
      ...decision,
      record: cloneIdempotencyRecord(decision.record),
      next: cloneIdempotencyRecord(decision.next),
    };
  }
  return {
    ...decision,
    record: cloneIdempotencyRecord(decision.record),
  };
}

function newProcessingRecord(
  key: string,
  fingerprint: string,
  nowMs: number,
  ttlMs: number,
): IdempotencyRecord {
  return {
    key,
    fingerprint,
    status: "processing",
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
  };
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeJsonValue(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = normalizeJsonValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function cloneResponse(response: IdempotencyResponse): IdempotencyResponse {
  return {
    statusCode: response.statusCode,
    body: normalizeJsonValue(response.body),
    headers: response.headers ? { ...response.headers } : undefined,
  };
}

function assertKey(key: string): void {
  if (!key.trim()) throw new Error("idempotency key is required");
  if (key.length > 256) throw new Error("idempotency key is too long");
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
