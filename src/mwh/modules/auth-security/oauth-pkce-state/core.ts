import { createHash, timingSafeEqual } from "node:crypto";

export type OAuthStateStatus = "pending" | "consumed" | "expired" | "failed";

export interface OAuthPkceStateRecord {
  state: string;
  providerId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAtMs: number;
  expiresAtMs: number;
  status: OAuthStateStatus;
  consumedAtMs?: number;
  failureReason?: string;
  metadata?: Record<string, string>;
}

export interface OAuthRedirectInput {
  state?: string;
  code?: string;
  error?: string;
  redirectUri: string;
}

export interface OAuthRedirectVerification {
  status:
    | "valid"
    | "missing-state"
    | "missing-code"
    | "provider-error"
    | "state-mismatch"
    | "expired"
    | "consumed"
    | "redirect-uri-mismatch";
  record?: OAuthPkceStateRecord;
  error?: string;
}

export function pkceCodeChallenge(verifier: string): string {
  assertNonEmpty(verifier, "verifier");
  if (verifier.length < 43 || verifier.length > 128) {
    throw new Error("verifier length must be between 43 and 128 characters");
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(verifier)) {
    throw new Error("verifier contains invalid PKCE characters");
  }
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function createOAuthPkceState(input: {
  state: string;
  providerId: string;
  redirectUri: string;
  codeVerifier: string;
  nowMs: number;
  ttlMs: number;
  metadata?: Record<string, string>;
}): OAuthPkceStateRecord {
  assertNonEmpty(input.state, "state");
  assertNonEmpty(input.providerId, "providerId");
  assertNonEmpty(input.redirectUri, "redirectUri");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    state: input.state,
    providerId: input.providerId,
    redirectUri: input.redirectUri,
    codeChallenge: pkceCodeChallenge(input.codeVerifier),
    codeChallengeMethod: "S256",
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    status: "pending",
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function verifyOAuthRedirect(
  record: OAuthPkceStateRecord | undefined,
  input: OAuthRedirectInput & { nowMs: number },
): OAuthRedirectVerification {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!input.state) return { status: "missing-state" };
  if (input.error)
    return { status: "provider-error", error: input.error, record: cloneOAuthPkceState(record) };
  if (!record || !timingSafeStringEqual(record.state, input.state))
    return { status: "state-mismatch" };
  if (record.redirectUri !== input.redirectUri)
    return { status: "redirect-uri-mismatch", record: cloneOAuthPkceRecord(record) };
  if (record.status === "consumed")
    return { status: "consumed", record: cloneOAuthPkceRecord(record) };
  if (input.nowMs >= record.expiresAtMs || record.status === "expired") {
    return { status: "expired", record: cloneOAuthPkceRecord({ ...record, status: "expired" }) };
  }
  if (!input.code) return { status: "missing-code", record: cloneOAuthPkceRecord(record) };
  return { status: "valid", record: cloneOAuthPkceRecord(record) };
}

export function consumeOAuthState(
  record: OAuthPkceStateRecord,
  input: { nowMs: number },
): OAuthPkceStateRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (record.status !== "pending") return cloneOAuthPkceRecord(record);
  if (input.nowMs >= record.expiresAtMs) {
    return { ...cloneOAuthPkceRecord(record), status: "expired" };
  }
  return {
    ...cloneOAuthPkceRecord(record),
    status: "consumed",
    consumedAtMs: input.nowMs,
  };
}

export function failOAuthState(
  record: OAuthPkceStateRecord,
  input: { nowMs: number; reason: string },
): OAuthPkceStateRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  return {
    ...cloneOAuthPkceRecord(record),
    status: "failed",
    failureReason: input.reason,
  };
}

export function cloneOAuthPkceState(
  record: OAuthPkceStateRecord | undefined,
): OAuthPkceStateRecord | undefined {
  if (!record) return undefined;
  return cloneOAuthPkceRecord(record);
}

function cloneOAuthPkceRecord(record: OAuthPkceStateRecord): OAuthPkceStateRecord {
  return {
    ...record,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function timingSafeStringEqual(left: string, right: string): boolean {
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
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}
