import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type SessionStatus = "active" | "revoked" | "expired" | "compromised";

export interface SessionTokenRecord {
  sessionId: string;
  subjectId: string;
  tokenHash: string;
  generation: number;
  issuedAtMs: number;
  expiresAtMs: number;
  absoluteExpiresAtMs: number;
  status: SessionStatus;
  revokedAtMs?: number;
  revokeReason?: string;
}

export interface RotateSessionResult {
  decision: "rotated" | "expired" | "revoked" | "compromised" | "reused" | "mismatch";
  record: SessionTokenRecord;
  nextToken?: string;
}

export function createSessionTokenRecord(input: {
  sessionId: string;
  subjectId: string;
  refreshToken: string;
  nowMs: number;
  ttlMs: number;
  absoluteTtlMs: number;
}): SessionTokenRecord {
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.subjectId, "subjectId");
  assertNonEmpty(input.refreshToken, "refreshToken");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  assertPositiveInteger(input.absoluteTtlMs, "absoluteTtlMs");
  if (input.absoluteTtlMs < input.ttlMs) throw new Error("absoluteTtlMs must be >= ttlMs");

  return {
    sessionId: input.sessionId,
    subjectId: input.subjectId,
    tokenHash: hashRefreshToken(input.refreshToken),
    generation: 1,
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    absoluteExpiresAtMs: input.nowMs + input.absoluteTtlMs,
    status: "active",
  };
}

export function rotateRefreshToken(
  record: SessionTokenRecord,
  input: {
    presentedToken: string;
    nextToken: string;
    nowMs: number;
    ttlMs: number;
  },
): RotateSessionResult {
  assertNonEmpty(input.presentedToken, "presentedToken");
  assertNonEmpty(input.nextToken, "nextToken");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");

  const current = classifySession(record, input.nowMs);
  if (current !== "active") {
    return { decision: current, record: { ...record, status: current } };
  }
  if (!verifyRefreshToken(input.presentedToken, record.tokenHash)) {
    return {
      decision: record.status === "compromised" ? "reused" : "mismatch",
      record:
        record.status === "compromised"
          ? record
          : revokeSession(record, {
              nowMs: input.nowMs,
              status: "compromised",
              reason: "refresh token reuse or mismatch",
            }),
    };
  }

  const remainingAbsoluteMs = record.absoluteExpiresAtMs - input.nowMs;
  const nextTtlMs = Math.min(input.ttlMs, remainingAbsoluteMs);
  if (nextTtlMs <= 0) return { decision: "expired", record: { ...record, status: "expired" } };

  return {
    decision: "rotated",
    nextToken: input.nextToken,
    record: {
      ...record,
      tokenHash: hashRefreshToken(input.nextToken),
      generation: record.generation + 1,
      issuedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + nextTtlMs,
      status: "active",
      revokedAtMs: undefined,
      revokeReason: undefined,
    },
  };
}

export function classifySession(record: SessionTokenRecord, nowMs: number): SessionStatus {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (record.status !== "active") return record.status;
  if (nowMs >= record.expiresAtMs || nowMs >= record.absoluteExpiresAtMs) return "expired";
  return "active";
}

export function revokeSession(
  record: SessionTokenRecord,
  input: {
    nowMs: number;
    status?: Extract<SessionStatus, "revoked" | "compromised">;
    reason: string;
  },
): SessionTokenRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  return {
    ...record,
    status: input.status ?? "revoked",
    revokedAtMs: input.nowMs,
    revokeReason: input.reason,
  };
}

export function hashRefreshToken(token: string): string {
  assertNonEmpty(token, "token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyRefreshToken(token: string, hash: string): boolean {
  assertNonEmpty(hash, "hash");
  const actual = Buffer.from(hashRefreshToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function generateRefreshToken(bytes = 32): string {
  assertPositiveInteger(bytes, "bytes");
  return randomBytes(bytes).toString("base64url");
}

export function cloneSessionTokenRecord(record: SessionTokenRecord): SessionTokenRecord {
  return { ...record };
}

export function cloneRotateSessionResult(result: RotateSessionResult): RotateSessionResult {
  return {
    ...result,
    record: cloneSessionTokenRecord(result.record),
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
