import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type CsrfTokenStatus = "active" | "consumed" | "expired" | "revoked";

export interface CsrfTokenRecord {
  id: string;
  sessionId: string;
  secretId: string;
  nonce: string;
  tokenHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: CsrfTokenStatus;
  consumedAtMs?: number;
  revokedAtMs?: number;
}

export interface CsrfValidationResult {
  valid: boolean;
  status:
    | "valid"
    | "missing-token"
    | "missing-record"
    | "session-mismatch"
    | "token-mismatch"
    | "expired"
    | "consumed"
    | "revoked";
  record?: CsrfTokenRecord;
}

export interface ParsedCsrfToken {
  secretId: string;
  nonce: string;
  signature: string;
}

export function generateCsrfNonce(bytes = 24): string {
  assertPositiveInteger(bytes, "bytes");
  return randomBytes(bytes).toString("base64url");
}

export function signCsrfToken(input: {
  sessionId: string;
  nonce: string;
  secret: string;
  secretId: string;
}): string {
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.nonce, "nonce");
  assertNonEmpty(input.secret, "secret");
  assertNonEmpty(input.secretId, "secretId");
  const signature = createHmac("sha256", input.secret)
    .update(`${input.sessionId}.${input.nonce}`)
    .digest("base64url");
  return `${input.secretId}.${input.nonce}.${signature}`;
}

export function parseCsrfToken(token: string | undefined): ParsedCsrfToken | undefined {
  if (!token) return undefined;
  const [secretId, nonce, signature, ...extra] = token.split(".");
  if (extra.length > 0 || !secretId || !nonce || !signature) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(secretId)) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return undefined;
  return { secretId, nonce, signature };
}

export function hashCsrfToken(token: string): string {
  assertNonEmpty(token, "token");
  return createHmac("sha256", "csrf-token-hash").update(token).digest("hex");
}

export function createCsrfTokenRecord(input: {
  id: string;
  sessionId: string;
  secretId: string;
  token: string;
  nonce: string;
  nowMs: number;
  ttlMs: number;
}): CsrfTokenRecord {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.secretId, "secretId");
  assertNonEmpty(input.token, "token");
  assertNonEmpty(input.nonce, "nonce");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    id: input.id,
    sessionId: input.sessionId,
    secretId: input.secretId,
    nonce: input.nonce,
    tokenHash: hashCsrfToken(input.token),
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    status: "active",
  };
}

export function validateCsrfToken(
  record: CsrfTokenRecord | undefined,
  input: {
    sessionId: string;
    token?: string;
    secret: string;
    nowMs: number;
  },
): CsrfValidationResult {
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.secret, "secret");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!input.token)
    return { valid: false, status: "missing-token", record: cloneCsrfToken(record) };
  if (!record) return { valid: false, status: "missing-record" };
  const parsed = parseCsrfToken(input.token);
  if (!parsed || parsed.secretId !== record.secretId || parsed.nonce !== record.nonce) {
    return { valid: false, status: "token-mismatch", record: cloneCsrfToken(record) };
  }
  if (record.sessionId !== input.sessionId) {
    return { valid: false, status: "session-mismatch", record: cloneCsrfToken(record) };
  }
  if (record.status !== "active") {
    return { valid: false, status: record.status, record: cloneCsrfToken(record) };
  }
  if (input.nowMs >= record.expiresAtMs) {
    return {
      valid: false,
      status: "expired",
      record: cloneCsrfToken({ ...record, status: "expired" }),
    };
  }
  const expected = signCsrfToken({
    sessionId: record.sessionId,
    nonce: record.nonce,
    secret: input.secret,
    secretId: record.secretId,
  });
  if (
    !safeEqual(input.token, expected) ||
    !safeEqual(hashCsrfToken(input.token), record.tokenHash)
  ) {
    return { valid: false, status: "token-mismatch", record: cloneCsrfToken(record) };
  }
  return { valid: true, status: "valid", record: cloneCsrfToken(record) };
}

export function consumeCsrfToken(
  record: CsrfTokenRecord,
  input: { token?: string; secret: string; sessionId: string; nowMs: number },
): CsrfValidationResult {
  const validation = validateCsrfToken(record, input);
  if (!validation.valid || !validation.record) return validation;
  return {
    valid: true,
    status: "valid",
    record: {
      ...validation.record,
      status: "consumed",
      consumedAtMs: input.nowMs,
    },
  };
}

export function revokeCsrfToken(record: CsrfTokenRecord, nowMs: number): CsrfTokenRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  const copy = cloneCsrfToken(record)!;
  return {
    ...copy,
    status: "revoked",
    revokedAtMs: nowMs,
  };
}

export function revokeActiveSessionCsrfTokens(
  records: readonly CsrfTokenRecord[],
  input: { sessionId: string; nowMs: number },
): { records: CsrfTokenRecord[]; revokedIds: string[] } {
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const revokedIds: string[] = [];
  const next = records.map((record) => {
    if (record.sessionId !== input.sessionId || record.status !== "active") {
      return cloneCsrfToken(record)!;
    }
    revokedIds.push(record.id);
    return revokeCsrfToken(record, input.nowMs);
  });
  return { records: next, revokedIds };
}

export function csrfTokenSnapshot(records: readonly CsrfTokenRecord[]): {
  active: number;
  consumed: number;
  expired: number;
  revoked: number;
  total: number;
} {
  return {
    active: records.filter((record) => record.status === "active").length,
    consumed: records.filter((record) => record.status === "consumed").length,
    expired: records.filter((record) => record.status === "expired").length,
    revoked: records.filter((record) => record.status === "revoked").length,
    total: records.length,
  };
}

export function cloneCsrfToken(record: CsrfTokenRecord | undefined): CsrfTokenRecord | undefined {
  if (!record) return undefined;
  return { ...record };
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
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
