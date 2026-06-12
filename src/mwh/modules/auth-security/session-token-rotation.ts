import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Session Token Rotation Middleware

## Purpose

Use this module as a reusable reference when implementing login sessions, refresh token rotation, device sessions, logout, stolen-token detection, and session revocation.

The module keeps the session state machine independent from JWT or cookie libraries. Production adapters can issue signed access tokens, store hashed refresh tokens in SQL/Redis, and reuse the same rotation rules.

## When To Use

- Rotate refresh tokens on every refresh request.
- Store only refresh token hashes server-side.
- Detect refresh token reuse and mark a session compromised.
- Revoke one device session or all sessions for a subject.

## When Not To Use

- Do not store raw refresh tokens in databases or logs.
- Do not treat access-token JWT signing as the same concern as refresh-token state.
- Do not allow indefinite sliding sessions without an absolute expiry.

## Recommended Architecture

- core.ts: pure session creation, token hashing, verification, rotation, expiry, and revocation.
- memory-store.ts: deterministic stateful store for tests and local demos.
- adapters/sql.ts: durable session table with tokenHash, generation, status, expiresAt, and absoluteExpiresAt columns.
- adapters/redis.ts: short-lived refresh-session store for low-latency auth services.
- http/cookie.ts: secure cookie binding and CSRF-aware refresh endpoint wrapper.

## Public API Sketch

\`\`\`ts
const store = new MemorySessionTokenStore({
  refreshTtlMs: 7 * 24 * 60 * 60 * 1000,
  absoluteTtlMs: 30 * 24 * 60 * 60 * 1000,
});

const created = store.create(userId);
setRefreshCookie(created.refreshToken);

const rotated = store.rotate(created.record.sessionId, presentedRefreshToken);
if (rotated.decision === "rotated") {
  setRefreshCookie(rotated.nextToken);
}
if (rotated.decision === "mismatch" || rotated.decision === "reused") {
  clearSessionCookies();
}
\`\`\`

## Integration Rules

1. Generate high-entropy refresh tokens and store only hashes.
2. Rotate refresh tokens on every successful refresh.
3. Keep an absolute session expiry even when sliding refresh expiry is extended.
4. Mark refresh-token mismatch as compromised unless the product chooses a softer policy.
5. Bind sessions to subject, device, and risk metadata in production stores.
6. Revoke sessions on logout, password change, and suspicious reuse.

## Failure Modes

- Raw refresh tokens leaked through logs or database snapshots.
- Replay attacks when old refresh tokens remain valid after rotation.
- Permanent sessions when absolute expiry is missing.
- Cross-device logout bugs when session ids and subject ids are not indexed separately.
- Race conditions from two refresh requests using the same token concurrently.

## Security Notes

- Use secure, httpOnly, SameSite cookies for browser refresh tokens.
- Include CSRF protection on cookie-based refresh endpoints.
- Compare token hashes with constant-time comparison.
- Consider storing family id and generation for forensic investigation.

## Verification Checklist

- Stateless tests cover hash verification, active/expired classification, rotation, revoke, mismatch, and compromised state.
- Stateful tests cover create, rotate, old-token reuse detection, revoke, expiry, and subject session listing.
- Adapter tests should verify atomic compare-and-swap token rotation under concurrent refresh requests.
- HTTP tests should verify secure cookie flags and refresh failure clearing behavior.

## Source References

- OAuth 2.0 Security Best Current Practice: refresh token rotation and reuse detection.
- Auth0 refresh token rotation model: token family invalidation on reuse.
- OWASP Session Management Cheat Sheet: session identifier entropy, expiry, and revocation.
`;

export const SESSION_TOKEN_ROTATION_MODULE: MwhModule = {
  id: "session-token-rotation",
  title: "Session Token Rotation Middleware",
  summary:
    "Reusable session and refresh-token rotation reference with token hashing, reuse detection, revocation, and stateful tests.",
  version: "0.1.0",
  tags: ["auth-security", "session", "refresh-token", "rotation", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
