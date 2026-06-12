import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type PasswordResetTokenStatus = "pending" | "consumed" | "expired" | "revoked" | "locked";

export interface PasswordResetTokenRecord {
  id: string;
  subjectId: string;
  tokenHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: PasswordResetTokenStatus;
  attempts: number;
  maxAttempts: number;
  consumedAtMs?: number;
  revokedAtMs?: number;
  reason?: string;
  metadata?: Record<string, string>;
}

export interface PasswordResetTokenVerification {
  status:
    | "valid"
    | "missing-token"
    | "token-mismatch"
    | "expired"
    | "consumed"
    | "revoked"
    | "locked";
  record?: PasswordResetTokenRecord;
}

export function generatePasswordResetToken(bytes = 32): string {
  assertPositiveInteger(bytes, "bytes");
  return randomBytes(bytes).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  assertNonEmpty(token, "token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyPasswordResetToken(token: string, tokenHash: string): boolean {
  assertNonEmpty(token, "token");
  assertNonEmpty(tokenHash, "tokenHash");
  const actual = Buffer.from(hashPasswordResetToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createPasswordResetTokenRecord(input: {
  id: string;
  subjectId: string;
  token: string;
  nowMs: number;
  ttlMs: number;
  maxAttempts?: number;
  metadata?: Record<string, string>;
}): PasswordResetTokenRecord {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.subjectId, "subjectId");
  assertNonEmpty(input.token, "token");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  const maxAttempts = input.maxAttempts ?? 5;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  return {
    id: input.id,
    subjectId: input.subjectId,
    tokenHash: hashPasswordResetToken(input.token),
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    status: "pending",
    attempts: 0,
    maxAttempts,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function classifyPasswordResetToken(
  record: PasswordResetTokenRecord,
  nowMs: number,
): PasswordResetTokenStatus {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.status !== "pending") return record.status;
  if (nowMs >= record.expiresAtMs) return "expired";
  if (record.attempts >= record.maxAttempts) return "locked";
  return "pending";
}

export function verifyPasswordResetTokenRecord(
  record: PasswordResetTokenRecord | undefined,
  input: { token?: string; nowMs: number },
): PasswordResetTokenVerification {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!input.token) return { status: "missing-token", record: clonePasswordResetToken(record) };
  if (!record) return { status: "token-mismatch" };

  const currentStatus = classifyPasswordResetToken(record, input.nowMs);
  if (currentStatus !== "pending") {
    return {
      status: currentStatus,
      record: clonePasswordResetRecord({ ...record, status: currentStatus }),
    };
  }

  if (verifyPasswordResetToken(input.token, record.tokenHash)) {
    return { status: "valid", record: clonePasswordResetRecord(record) };
  }

  const attempts = record.attempts + 1;
  const status: PasswordResetTokenStatus = attempts >= record.maxAttempts ? "locked" : "pending";
  return {
    status: status === "locked" ? "locked" : "token-mismatch",
    record: clonePasswordResetRecord({ ...record, attempts, status }),
  };
}

export function consumePasswordResetToken(
  record: PasswordResetTokenRecord,
  input: { token?: string; nowMs: number },
): PasswordResetTokenVerification {
  const verification = verifyPasswordResetTokenRecord(record, input);
  if (verification.status !== "valid" || !verification.record) return verification;
  return {
    status: "valid",
    record: {
      ...verification.record,
      status: "consumed",
      consumedAtMs: input.nowMs,
    },
  };
}

export function revokePasswordResetToken(
  record: PasswordResetTokenRecord,
  input: { nowMs: number; reason: string },
): PasswordResetTokenRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  return {
    ...clonePasswordResetRecord(record),
    status: "revoked",
    revokedAtMs: input.nowMs,
    reason: input.reason,
  };
}

export function clonePasswordResetToken(
  record: PasswordResetTokenRecord | undefined,
): PasswordResetTokenRecord | undefined {
  if (!record) return undefined;
  return clonePasswordResetRecord(record);
}

function clonePasswordResetRecord(record: PasswordResetTokenRecord): PasswordResetTokenRecord {
  return {
    ...record,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
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
