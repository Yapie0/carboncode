import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: JWT Access + Refresh Middleware

## Purpose

Use this module as a reusable reference when implementing access-token JWT validation, refresh-token grants, login issuance, refresh rotation, logout, and compromised refresh-token handling.

This module sits above session-token-rotation. It shows the HTTP/auth workflow shape: short-lived signed access tokens plus stateful refresh grants. Production adapters can swap the built-in HS256 helper for jose, use httpOnly cookies, and persist refresh grants in SQL or Redis.

## When To Use

- APIs need short-lived bearer access JWTs.
- Browser or mobile clients need refresh-token rotation.
- Logout must revoke refresh grants while access tokens naturally expire.
- Refresh token mismatch should mark the grant compromised.

## When Not To Use

- Do not store raw refresh tokens in databases or logs.
- Do not use a shared weak JWT secret.
- Do not treat JWT validation as authorization; enforce scopes and resource policy separately.
- Do not use the memory store across multiple server instances.

## Implementation Variants

1. HS256 local signing
   - Good for a single auth service and tests.
2. jose/RS256 signing
   - Recommended when multiple services verify access tokens.
3. Cookie refresh flow
   - Store refresh token in secure, httpOnly, SameSite cookie with CSRF protection.
4. Mobile refresh flow
   - Store refresh token in platform secure storage and bind grants to device metadata.

## Recommended Architecture

- core.ts: pure JWT signing/verification, refresh grant creation, token hashing, rotation, expiry, and revocation.
- memory-store.ts: deterministic login/refresh/logout reference flow for tests.
- adapters/sql.ts: refresh_grants table with tokenHash, status, subjectId, sessionId, expiresAt.
- adapters/redis.ts: short-lived refresh grant cache with explicit revocation keys.
- http/middleware.ts: bearer JWT validation, refresh endpoint, logout endpoint, cookie flags.

## Public API Sketch

\`\`\`ts
const auth = new MemoryJwtRefreshStore({ secret: env.JWT_SECRET });
const issued = auth.issue({
  subjectId: "user_1",
  sessionId: "device_1",
  scope: ["repo:read"],
});
const refreshed = auth.refresh({
  grantId: issued.grant.grantId,
  presentedRefreshToken: issued.refreshToken,
});
const access = auth.verifyAccess(refreshed.accessToken);
\`\`\`

## Integration Rules

1. Keep access tokens short lived.
2. Store refresh-token hashes only.
3. Rotate refresh grants on every successful refresh.
4. Revoke active grants on logout and password change.
5. Validate JWT signature, expiry, subject, session, and scope before using claims.
6. Use secure cookie flags and CSRF protection for browser refresh endpoints.

## Failure Modes

- Refresh token reuse may indicate theft and should compromise the grant.
- Access tokens remain valid until expiry after logout unless a deny-list is added.
- Concurrent refresh requests need atomic compare-and-rotate in SQL/Redis adapters.
- Weak secrets allow forged access tokens.
- Clock skew can cause premature access-token expiry.

## Security Notes

- Prefer asymmetric signing when many services verify tokens.
- Rotate JWT signing keys with key ids in production.
- Use timing-safe hash comparison.
- Avoid placing private data in JWT claims.
- Rate-limit login and refresh endpoints.

## Verification Checklist

- Stateless tests cover JWT signature verification, tamper rejection, expiry, refresh grant hashing, rotation, mismatch compromise, and revocation.
- Stateful tests cover issue, verify, refresh, old refresh grant rejection, logout/revoke, session-wide revocation, and subject grant listing.
- SQL adapter tests should cover atomic rotation and concurrent refresh races.
- HTTP tests should verify bearer parsing, cookie flags, CSRF behavior, and failure clearing.

## Source References

- OWASP Session Management Cheat Sheet.
- OAuth 2.0 Security Best Current Practice refresh token rotation.
- JWT bearer token validation patterns.
- Auth0-style refresh token reuse detection.
`;

export const AUTH_JWT_REFRESH_MODULE: MwhModule = {
  id: "auth-jwt-refresh",
  title: "JWT Access + Refresh Middleware",
  summary:
    "Reusable auth-security reference for access JWT signing/verification, refresh grants, rotation, logout, and compromised-token handling.",
  version: "0.1.0",
  tags: ["auth-security", "jwt", "refresh-token", "access-token", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
