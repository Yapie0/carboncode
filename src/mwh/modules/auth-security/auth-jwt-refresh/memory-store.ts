import {
  type AccessTokenClaims,
  type RefreshGrant,
  createRefreshGrant,
  generateRefreshToken,
  revokeRefreshGrant,
  rotateRefreshGrant,
  signAccessToken,
  verifyAccessToken,
} from "./core.js";

export interface MemoryJwtRefreshStoreOptions {
  secret: string;
  now?: () => number;
  idFactory?: () => string;
  tokenFactory?: () => string;
  accessTtlMs?: number;
  refreshTtlMs?: number;
}

export interface JwtRefreshIssueResult {
  accessToken: string;
  refreshToken: string;
  grant: RefreshGrant;
}

export interface JwtRefreshRotateResult {
  decision: "rotated" | "expired" | "revoked" | "compromised" | "mismatch";
  accessToken?: string;
  refreshToken?: string;
  grant: RefreshGrant;
}

export class MemoryJwtRefreshStore {
  private readonly secret: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;
  private readonly grants = new Map<string, RefreshGrant>();

  constructor(options: MemoryJwtRefreshStoreOptions) {
    this.secret = options.secret;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `grant_${generateRefreshToken(12)}`);
    this.tokenFactory = options.tokenFactory ?? (() => generateRefreshToken(32));
    this.accessTtlMs = options.accessTtlMs ?? 15 * 60 * 1000;
    this.refreshTtlMs = options.refreshTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  issue(input: { subjectId: string; sessionId: string; scope?: string[] }): JwtRefreshIssueResult {
    const refreshToken = this.tokenFactory();
    const grant = createRefreshGrant({
      grantId: this.idFactory(),
      subjectId: input.subjectId,
      sessionId: input.sessionId,
      refreshToken,
      nowMs: this.now(),
      ttlMs: this.refreshTtlMs,
    });
    this.grants.set(grant.grantId, grant);
    return {
      accessToken: this.sign(input),
      refreshToken,
      grant: { ...grant },
    };
  }

  refresh(input: {
    grantId: string;
    presentedRefreshToken: string;
    scope?: string[];
  }): JwtRefreshRotateResult {
    const grant = this.require(input.grantId);
    const result = rotateRefreshGrant(grant, {
      presentedToken: input.presentedRefreshToken,
      nextGrantId: this.idFactory(),
      nextRefreshToken: this.tokenFactory(),
      nowMs: this.now(),
      ttlMs: this.refreshTtlMs,
    });
    this.grants.set(grant.grantId, result.grant);
    if (!result.nextGrant || !result.nextRefreshToken) {
      return { decision: result.decision, grant: { ...result.grant } };
    }
    this.grants.set(result.nextGrant.grantId, result.nextGrant);
    return {
      decision: "rotated",
      accessToken: this.sign({
        subjectId: result.nextGrant.subjectId,
        sessionId: result.nextGrant.sessionId,
        scope: input.scope,
      }),
      refreshToken: result.nextRefreshToken,
      grant: { ...result.nextGrant },
    };
  }

  verifyAccess(token: string): { valid: boolean; claims?: AccessTokenClaims; reason?: string } {
    return verifyAccessToken({ token, secret: this.secret, nowMs: this.now() });
  }

  revoke(grantId: string, reason: string): RefreshGrant {
    const grant = revokeRefreshGrant(this.require(grantId), { nowMs: this.now(), reason });
    this.grants.set(grantId, grant);
    return { ...grant };
  }

  revokeSession(sessionId: string, reason: string): RefreshGrant[] {
    const revoked: RefreshGrant[] = [];
    for (const [grantId, grant] of this.grants.entries()) {
      if (grant.sessionId !== sessionId || grant.status !== "active") continue;
      const next = revokeRefreshGrant(grant, { nowMs: this.now(), reason });
      this.grants.set(grantId, next);
      revoked.push({ ...next });
    }
    return revoked;
  }

  get(grantId: string): RefreshGrant | undefined {
    const grant = this.grants.get(grantId);
    return grant ? { ...grant } : undefined;
  }

  listBySubject(subjectId: string): RefreshGrant[] {
    return [...this.grants.values()]
      .filter((grant) => grant.subjectId === subjectId)
      .map((grant) => ({ ...grant }));
  }

  private sign(input: { subjectId: string; sessionId: string; scope?: string[] }): string {
    return signAccessToken({
      ...input,
      secret: this.secret,
      nowMs: this.now(),
      ttlMs: this.accessTtlMs,
    });
  }

  private require(grantId: string): RefreshGrant {
    const grant = this.grants.get(grantId);
    if (!grant) throw new Error(`unknown refresh grant: ${grantId}`);
    return grant;
  }
}
