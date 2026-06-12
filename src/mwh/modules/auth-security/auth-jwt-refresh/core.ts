import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type RefreshGrantStatus = "active" | "rotated" | "revoked" | "expired" | "compromised";

export interface AccessTokenClaims {
  sub: string;
  sessionId: string;
  iat: number;
  exp: number;
  scope?: string[];
}

export interface RefreshGrant {
  grantId: string;
  subjectId: string;
  sessionId: string;
  tokenHash: string;
  status: RefreshGrantStatus;
  issuedAtMs: number;
  expiresAtMs: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  revokeReason?: string;
}

export interface VerifyAccessTokenResult {
  valid: boolean;
  reason?: "format" | "signature" | "expired" | "claims";
  claims?: AccessTokenClaims;
}

export interface RotateRefreshGrantResult {
  decision: "rotated" | "expired" | "revoked" | "compromised" | "mismatch";
  grant: RefreshGrant;
  nextGrant?: RefreshGrant;
  nextRefreshToken?: string;
}

export function signAccessToken(input: {
  subjectId: string;
  sessionId: string;
  secret: string;
  nowMs: number;
  ttlMs: number;
  scope?: string[];
}): string {
  assertNonEmpty(input.subjectId, "subjectId");
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.secret, "secret");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  const claims: AccessTokenClaims = {
    sub: input.subjectId,
    sessionId: input.sessionId,
    iat: Math.floor(input.nowMs / 1000),
    exp: Math.floor((input.nowMs + input.ttlMs) / 1000),
    scope: input.scope,
  };
  return signJwt(claims, input.secret);
}

export function verifyAccessToken(input: {
  token: string;
  secret: string;
  nowMs: number;
}): VerifyAccessTokenResult {
  assertNonEmpty(input.secret, "secret");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const parts = input.token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) return { valid: false, reason: "format" };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const expected = hmacSha256(`${headerPart}.${payloadPart}`, input.secret);
  if (!safeEqual(signaturePart, expected)) return { valid: false, reason: "signature" };

  try {
    const header = JSON.parse(base64UrlDecode(headerPart).toString("utf8")) as {
      alg?: string;
      typ?: string;
    };
    if (header.alg !== "HS256" || header.typ !== "JWT") return { valid: false, reason: "format" };
    const claims = JSON.parse(base64UrlDecode(payloadPart).toString("utf8")) as AccessTokenClaims;
    if (!isAccessTokenClaims(claims)) return { valid: false, reason: "claims" };
    if (Math.floor(input.nowMs / 1000) >= claims.exp) return { valid: false, reason: "expired" };
    return { valid: true, claims };
  } catch {
    return { valid: false, reason: "format" };
  }
}

export function createRefreshGrant(input: {
  grantId: string;
  subjectId: string;
  sessionId: string;
  refreshToken: string;
  nowMs: number;
  ttlMs: number;
}): RefreshGrant {
  assertNonEmpty(input.grantId, "grantId");
  assertNonEmpty(input.subjectId, "subjectId");
  assertNonEmpty(input.sessionId, "sessionId");
  assertNonEmpty(input.refreshToken, "refreshToken");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    grantId: input.grantId,
    subjectId: input.subjectId,
    sessionId: input.sessionId,
    tokenHash: hashRefreshToken(input.refreshToken),
    status: "active",
    issuedAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
  };
}

export function rotateRefreshGrant(
  grant: RefreshGrant,
  input: {
    presentedToken: string;
    nextGrantId: string;
    nextRefreshToken: string;
    nowMs: number;
    ttlMs: number;
  },
): RotateRefreshGrantResult {
  assertNonEmpty(input.presentedToken, "presentedToken");
  assertNonEmpty(input.nextGrantId, "nextGrantId");
  assertNonEmpty(input.nextRefreshToken, "nextRefreshToken");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");

  const status = classifyRefreshGrant(grant, input.nowMs);
  if (status !== "active") {
    if (status === "rotated" && verifyRefreshToken(input.presentedToken, grant.tokenHash)) {
      return {
        decision: "compromised",
        grant: revokeRefreshGrant(grant, {
          nowMs: input.nowMs,
          status: "compromised",
          reason: "rotated refresh token reused",
        }),
      };
    }
    return { decision: status, grant: { ...grant, status } };
  }
  if (!verifyRefreshToken(input.presentedToken, grant.tokenHash)) {
    return {
      decision: "mismatch",
      grant: revokeRefreshGrant(grant, {
        nowMs: input.nowMs,
        status: "compromised",
        reason: "refresh token mismatch or reuse",
      }),
    };
  }

  const rotatedGrant: RefreshGrant = {
    ...grant,
    status: "rotated",
    rotatedAtMs: input.nowMs,
  };
  const nextGrant = createRefreshGrant({
    grantId: input.nextGrantId,
    subjectId: grant.subjectId,
    sessionId: grant.sessionId,
    refreshToken: input.nextRefreshToken,
    nowMs: input.nowMs,
    ttlMs: input.ttlMs,
  });
  return {
    decision: "rotated",
    grant: rotatedGrant,
    nextGrant,
    nextRefreshToken: input.nextRefreshToken,
  };
}

export function classifyRefreshGrant(grant: RefreshGrant, nowMs: number): RefreshGrantStatus {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (grant.status !== "active") return grant.status;
  return nowMs >= grant.expiresAtMs ? "expired" : "active";
}

export function revokeRefreshGrant(
  grant: RefreshGrant,
  input: {
    nowMs: number;
    reason: string;
    status?: Extract<RefreshGrantStatus, "revoked" | "compromised">;
  },
): RefreshGrant {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.reason, "reason");
  return {
    ...grant,
    status: input.status ?? "revoked",
    revokedAtMs: input.nowMs,
    revokeReason: input.reason,
  };
}

export function hashRefreshToken(token: string): string {
  assertNonEmpty(token, "token");
  return createHmac("sha256", "refresh-token-hash").update(token, "utf8").digest("hex");
}

export function verifyRefreshToken(token: string, hash: string): boolean {
  assertNonEmpty(hash, "hash");
  return safeEqual(hashRefreshToken(token), hash);
}

export function generateRefreshToken(bytes = 32): string {
  assertPositiveInteger(bytes, "bytes");
  return randomBytes(bytes).toString("base64url");
}

function signJwt(claims: AccessTokenClaims, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = hmacSha256(`${header}.${payload}`, secret);
  return `${header}.${payload}.${signature}`;
}

function hmacSha256(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function isAccessTokenClaims(value: AccessTokenClaims): boolean {
  return (
    typeof value.sub === "string" &&
    value.sub.trim().length > 0 &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0 &&
    Number.isInteger(value.iat) &&
    Number.isInteger(value.exp) &&
    value.exp > value.iat &&
    (value.scope === undefined ||
      (Array.isArray(value.scope) && value.scope.every((scope) => typeof scope === "string")))
  );
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
