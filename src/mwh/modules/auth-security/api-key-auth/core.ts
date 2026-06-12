import { createHash, timingSafeEqual } from "node:crypto";

export type ApiKeyStatus = "active" | "disabled" | "revoked" | "expired";

export interface ApiKeyRecord {
  id: string;
  ownerId: string;
  prefix: string;
  keyHash: string;
  scopes: readonly string[];
  status: ApiKeyStatus;
  createdAtMs: number;
  expiresAtMs?: number;
  lastUsedAtMs?: number;
  revokedAtMs?: number;
  revokeReason?: string;
}

export interface ApiKeyAuthDecision {
  allowed: boolean;
  status: ApiKeyStatus | "not-found" | "scope-denied" | "mismatch";
  keyId?: string;
  ownerId?: string;
  reason: string;
}

export function createApiKeyRecord(input: {
  id: string;
  ownerId: string;
  rawKey: string;
  scopes: readonly string[];
  nowMs: number;
  expiresAtMs?: number;
}): ApiKeyRecord {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonEmpty(input.rawKey, "rawKey");
  assertNonEmptyArray(input.scopes, "scopes");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.expiresAtMs !== undefined && input.expiresAtMs <= input.nowMs) {
    throw new Error("expiresAtMs must be greater than nowMs");
  }
  return {
    id: input.id,
    ownerId: input.ownerId,
    prefix: apiKeyPrefix(input.rawKey),
    keyHash: hashApiKey(input.rawKey),
    scopes: [...new Set(input.scopes)],
    status: "active",
    createdAtMs: input.nowMs,
    expiresAtMs: input.expiresAtMs,
  };
}

export function authenticateApiKey(
  record: ApiKeyRecord | undefined,
  input: { rawKey: string; requiredScope?: string; nowMs: number },
): ApiKeyAuthDecision {
  assertNonEmpty(input.rawKey, "rawKey");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!record) return { allowed: false, status: "not-found", reason: "api key not found" };
  const status = classifyApiKey(record, input.nowMs);
  if (status !== "active") {
    return {
      allowed: false,
      status,
      keyId: record.id,
      ownerId: record.ownerId,
      reason: `api key is ${status}`,
    };
  }
  if (!verifyApiKey(input.rawKey, record.keyHash)) {
    return {
      allowed: false,
      status: "mismatch",
      keyId: record.id,
      ownerId: record.ownerId,
      reason: "api key secret mismatch",
    };
  }
  if (input.requiredScope && !scopeAllowed(record.scopes, input.requiredScope)) {
    return {
      allowed: false,
      status: "scope-denied",
      keyId: record.id,
      ownerId: record.ownerId,
      reason: "required scope is not allowed",
    };
  }
  return {
    allowed: true,
    status: "active",
    keyId: record.id,
    ownerId: record.ownerId,
    reason: "api key accepted",
  };
}

export function markApiKeyUsed(record: ApiKeyRecord, nowMs: number): ApiKeyRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  return { ...record, lastUsedAtMs: nowMs };
}

export function setApiKeyEnabled(record: ApiKeyRecord, enabled: boolean): ApiKeyRecord {
  if (record.status === "revoked") return record;
  return { ...record, status: enabled ? "active" : "disabled" };
}

export function revokeApiKey(
  record: ApiKeyRecord,
  input: { nowMs: number; reason: string },
): ApiKeyRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  return {
    ...record,
    status: "revoked",
    revokedAtMs: input.nowMs,
    revokeReason: input.reason,
  };
}

export function rotateApiKey(
  record: ApiKeyRecord,
  input: { rawKey: string; nowMs: number; expiresAtMs?: number },
): ApiKeyRecord {
  assertNonEmpty(input.rawKey, "rawKey");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.expiresAtMs !== undefined && input.expiresAtMs <= input.nowMs) {
    throw new Error("expiresAtMs must be greater than nowMs");
  }
  return {
    ...record,
    prefix: apiKeyPrefix(input.rawKey),
    keyHash: hashApiKey(input.rawKey),
    status: "active",
    expiresAtMs: input.expiresAtMs,
    revokedAtMs: undefined,
    revokeReason: undefined,
    lastUsedAtMs: undefined,
  };
}

export function classifyApiKey(record: ApiKeyRecord, nowMs: number): ApiKeyStatus {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.status !== "active") return record.status;
  if (record.expiresAtMs !== undefined && nowMs >= record.expiresAtMs) return "expired";
  return "active";
}

export function scopeAllowed(scopes: readonly string[], requiredScope: string): boolean {
  assertNonEmpty(requiredScope, "requiredScope");
  return scopes.some((scope) => scope === "*" || wildcardScopeMatches(scope, requiredScope));
}

export function wildcardScopeMatches(pattern: string, scope: string): boolean {
  assertNonEmpty(pattern, "pattern");
  assertNonEmpty(scope, "scope");
  if (pattern === "*") return true;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(scope);
}

export function apiKeyPrefix(rawKey: string): string {
  assertNonEmpty(rawKey, "rawKey");
  return rawKey.slice(0, Math.min(8, rawKey.length));
}

export function hashApiKey(rawKey: string): string {
  assertNonEmpty(rawKey, "rawKey");
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function verifyApiKey(rawKey: string, hash: string): boolean {
  assertNonEmpty(hash, "hash");
  const actual = Buffer.from(hashApiKey(rawKey), "hex");
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonEmptyArray(value: readonly string[], name: string): void {
  if (!value.length) throw new Error(`${name} is required`);
  for (const item of value) assertNonEmpty(item, `${name}[]`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
