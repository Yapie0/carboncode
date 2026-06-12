import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export type OtpCodeStatus = "pending" | "consumed" | "expired" | "revoked" | "locked";

export interface OtpCodeRecord {
  id: string;
  subjectId: string;
  channel: "email" | "sms" | "totp" | "voice" | "custom";
  purpose: string;
  codeHash: string;
  createdAtMs: number;
  expiresAtMs: number;
  resendAfterMs: number;
  status: OtpCodeStatus;
  attempts: number;
  maxAttempts: number;
  consumedAtMs?: number;
  revokedAtMs?: number;
  metadata?: Record<string, string>;
}

export interface OtpCodeVerification {
  status:
    | "valid"
    | "missing-code"
    | "code-mismatch"
    | "expired"
    | "consumed"
    | "revoked"
    | "locked"
    | "resend-not-ready";
  record?: OtpCodeRecord;
  retryAfterMs?: number;
}

export function generateOtpCode(length = 6): string {
  assertPositiveInteger(length, "length");
  if (length > 12) throw new Error("length must be 12 or less");
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += String(randomInt(0, 10));
  }
  return code;
}

export function hashOtpCode(input: { code: string; subjectId: string; purpose: string }): string {
  assertNonEmpty(input.code, "code");
  assertNonEmpty(input.subjectId, "subjectId");
  assertNonEmpty(input.purpose, "purpose");
  return createHash("sha256")
    .update(`${input.subjectId}.${input.purpose}.${input.code}`, "utf8")
    .digest("hex");
}

export function verifyOtpCode(
  input: { code: string; subjectId: string; purpose: string },
  codeHash: string,
): boolean {
  assertNonEmpty(codeHash, "codeHash");
  const actual = Buffer.from(hashOtpCode(input), "hex");
  const expected = Buffer.from(codeHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createOtpCodeRecord(input: {
  id: string;
  subjectId: string;
  channel: OtpCodeRecord["channel"];
  purpose: string;
  code: string;
  nowMs: number;
  ttlMs: number;
  resendCooldownMs?: number;
  maxAttempts?: number;
  metadata?: Record<string, string>;
}): OtpCodeRecord {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.subjectId, "subjectId");
  assertNonEmpty(input.purpose, "purpose");
  assertNonEmpty(input.code, "code");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  const resendCooldownMs = input.resendCooldownMs ?? 30_000;
  assertNonNegativeInteger(resendCooldownMs, "resendCooldownMs");
  const maxAttempts = input.maxAttempts ?? 5;
  assertPositiveInteger(maxAttempts, "maxAttempts");
  return {
    id: input.id,
    subjectId: input.subjectId,
    channel: input.channel,
    purpose: input.purpose,
    codeHash: hashOtpCode(input),
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    resendAfterMs: input.nowMs + resendCooldownMs,
    status: "pending",
    attempts: 0,
    maxAttempts,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function classifyOtpCode(record: OtpCodeRecord, nowMs: number): OtpCodeStatus {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.status !== "pending") return record.status;
  if (nowMs >= record.expiresAtMs) return "expired";
  if (record.attempts >= record.maxAttempts) return "locked";
  return "pending";
}

export function canResendOtpCode(record: OtpCodeRecord, nowMs: number): OtpCodeVerification {
  assertNonNegativeInteger(nowMs, "nowMs");
  const status = classifyOtpCode(record, nowMs);
  if (status !== "pending" && status !== "expired") {
    return { status, record: cloneOtpCode({ ...record, status }) };
  }
  if (nowMs < record.resendAfterMs) {
    return {
      status: "resend-not-ready",
      retryAfterMs: record.resendAfterMs - nowMs,
      record: cloneOtpCode(record),
    };
  }
  return { status: "valid", record: cloneOtpCode(record) };
}

export function verifyOtpCodeRecord(
  record: OtpCodeRecord | undefined,
  input: { code?: string; nowMs: number },
): OtpCodeVerification {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!input.code) return { status: "missing-code", record: cloneOtpCode(record) };
  if (!record) return { status: "code-mismatch" };

  const currentStatus = classifyOtpCode(record, input.nowMs);
  if (currentStatus !== "pending") {
    return {
      status: currentStatus,
      record: cloneOtpRecord({ ...record, status: currentStatus }),
    };
  }

  if (
    verifyOtpCode(
      { code: input.code, subjectId: record.subjectId, purpose: record.purpose },
      record.codeHash,
    )
  ) {
    return { status: "valid", record: cloneOtpRecord(record) };
  }

  const attempts = record.attempts + 1;
  const status: OtpCodeStatus = attempts >= record.maxAttempts ? "locked" : "pending";
  return {
    status: status === "locked" ? "locked" : "code-mismatch",
    record: cloneOtpRecord({ ...record, attempts, status }),
  };
}

export function consumeOtpCode(
  record: OtpCodeRecord,
  input: { code?: string; nowMs: number },
): OtpCodeVerification {
  const verification = verifyOtpCodeRecord(record, input);
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

export function revokeOtpCode(record: OtpCodeRecord, nowMs: number): OtpCodeRecord {
  assertNonNegativeInteger(nowMs, "nowMs");
  return {
    ...cloneOtpRecord(record),
    status: "revoked",
    revokedAtMs: nowMs,
  };
}

export function cloneOtpCode(record: OtpCodeRecord | undefined): OtpCodeRecord | undefined {
  if (!record) return undefined;
  return cloneOtpRecord(record);
}

function cloneOtpRecord(record: OtpCodeRecord): OtpCodeRecord {
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
