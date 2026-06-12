import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Password Reset Token

## Purpose

Use this module as a reusable reference for account recovery flows: issue high-entropy reset tokens, store only token hashes, enforce TTL, track failed attempts, lock suspicious tokens, consume valid tokens exactly once, and revoke pending tokens when needed.

The module focuses on reset-token lifecycle and storage semantics. Email/SMS delivery, user lookup, and final password policy enforcement remain adapters so the same core can be reused across web apps, admin consoles, and mobile account-recovery flows.

## When To Use

- Need password reset or account recovery links.
- Need deterministic token lifecycle tests before adding Redis, SQL, or email-provider adapters.
- Need one-time consume semantics so reset links cannot be replayed.
- Need brute-force protection through attempt tracking and lockout.

## When Not To Use

- Do not store raw reset tokens.
- Do not keep reset tokens valid after password change.
- Do not reveal whether an email or account exists in public request responses.
- Do not use an in-memory store for production account recovery.

## Implementation Variants

- Memory store for tests and local prototypes.
- Redis store using SET NX EX for issue and atomic consume/delete.
- SQL table with token_hash, subject_id, status, attempts, expires_at, and consumed_at.
- Email adapter for provider-specific delivery and template rendering.
- Session/security adapter that revokes existing sessions after a successful reset.

## Recommended Architecture

- core.ts: pure token generation, SHA-256 hashing, timing-safe verification, lifecycle classification, consume/revoke transitions, and clone helpers.
- memory-store.ts: stateful issue, verify, consume, revoke, pruneExpired, get, and list behavior.
- adapters/redis.ts: atomic issue, failed-attempt increment, lock, and consume with transactions or Lua.
- adapters/sql.ts: durable reset-token rows and audit-friendly status transitions.
- integrations/email.ts: provider-specific reset-link delivery.
- integrations/session.ts: revoke subject sessions after successful password reset.

## Public API Sketch

\`\`\`ts
const store = new MemoryPasswordResetTokenStore();
const token = generatePasswordResetToken();

store.issue({
  id: "reset-1",
  subjectId: "user-1",
  token,
  ttlMs: 900_000,
});

const result = store.consume("reset-1", token);
if (result.status !== "valid") throw new Error("invalid reset token");
\`\`\`

## Integration Rules

1. Generate reset tokens with at least 32 random bytes.
2. Store only hashes of reset tokens.
3. Expire tokens aggressively, typically 10 to 30 minutes.
4. Consume a valid token exactly once before changing the password.
5. Revoke other outstanding reset tokens for the subject after password reset.
6. Log lifecycle transitions without logging raw tokens.

## Failure Modes

- Raw token storage leaks active account-recovery links.
- Missing TTL leaves reset links valid indefinitely.
- Non-atomic consume allows replay under concurrent requests.
- Public account existence responses enable user enumeration.
- Memory stores lose pending reset flows on restart.

## Security Notes

- Use timing-safe token hash comparison.
- Use Redis/SQL atomic transitions for production.
- Rate-limit reset requests per account and IP.
- Return generic public responses for request and consume failures.
- Revoke sessions after a successful password reset when appropriate.

## Verification Checklist

- Stateless tests cover generation, hashing, timing-safe verification, record creation, expiry classification, mismatch attempt tracking, lockout, consume, revoke, and clone safety.
- Stateful tests cover issue, duplicate rejection, verify, failed-attempt persistence, lockout, consume once, replay rejection, revoke, pruneExpired, subject filtering, and clone-safe records.
- Redis/SQL adapters should test atomic one-time consume and concurrent failed-attempt updates.
- Email integration tests should verify reset links are built without logging raw token values.

## Source References

- Account recovery and forgot-password token patterns.
- OWASP forgot password guidance.
- Redis SET NX EX one-time token storage.
- SQL status-transition tables for audit-friendly recovery flows.
`;

export const PASSWORD_RESET_TOKEN_MODULE: MwhModule = {
  id: "password-reset-token",
  title: "Password Reset Token",
  summary:
    "Reusable auth-security reference for hashed one-time reset tokens, expiry, failed-attempt lockout, consume, revoke, and stateful account-recovery tests.",
  version: "0.1.0",
  tags: ["auth-security", "password-reset", "token", "account-recovery", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
