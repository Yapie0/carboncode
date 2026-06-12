import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Session Store Middleware

## Purpose

Use this module as a reusable reference when implementing server-side session storage for web apps, APIs, admin consoles, or auth gateways.

The module focuses on session state rather than token cryptography: create session records, store JSON-safe session data, read with TTL classification, update data, touch sliding expiry, revoke one session, revoke all sessions for a subject, expire old sessions, and expose snapshots.

## When To Use

- Applications need server-side session data with TTL and absolute TTL.
- Logout must revoke a session immediately.
- Account compromise or password reset must revoke all sessions for one subject.
- Tests need session behavior without Redis, SQL, or a browser cookie jar.

## When Not To Use

- Do not store raw passwords, refresh tokens, or long-lived secrets in session data.
- Do not rely on sliding TTL without an absolute TTL.
- Do not use process memory for production multi-instance session storage.
- Do not confuse session storage with refresh-token rotation.

## Implementation Variants

- memory-store: deterministic in-process store for unit tests and adapter contracts.
- Redis adapter: key TTL for active sessions plus subject index for bulk revocation.
- SQL adapter: durable sessions table with status, expiry, and subject indexes.
- Cookie adapter: stores only an opaque session id in the client cookie.

## Recommended Architecture

- core.ts: pure create/read/update/touch/revoke/expire/snapshot logic.
- memory-store.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/redis.ts: SET session JSON with EX/PX and maintain subject-to-session set.
- adapters/sql.ts: sessions table with expires_at, absolute_expires_at, status, and revoked_at.
- auth middleware: loads session id from cookie/header, reads store, touches when needed, and attaches subject.

## Public API Sketch

\`\`\`ts
const store = new MemorySessionStore({
  policy: { ttlMs: 30 * 60_000, absoluteTtlMs: 24 * 60 * 60_000, touchAfterMs: 60_000 },
});

store.create({ id: "sess_1", subjectId: "user_1", data: { role: "admin" } });
const result = store.read("sess_1");
if (result.found) store.touch("sess_1");
\`\`\`

## Integration Steps

1. Generate opaque random session ids outside this module.
2. Store only JSON-safe non-secret data in the session record.
3. Read sessions on each authenticated request and reject expired/revoked records.
4. Touch sessions only after a configured interval to avoid write amplification.
5. Revoke by subject after password reset, account compromise, or admin action.
6. Run expiry scans or rely on adapter TTL features.

## Failure Modes

- Sliding TTL extends sessions forever because there is no absolute TTL.
- Subject bulk revocation misses sessions because no subject index exists.
- Returned session objects mutate store internals.
- Expired sessions continue to be treated as active.
- Session data contains secrets that leak through logs or backups.

## Security Notes

- Use high-entropy session ids and secure cookie attributes.
- Store only opaque ids in cookies.
- Pair session revocation with audit logs.
- Encrypt or avoid sensitive session data in durable stores.

## Verification Checklist

- Stateless tests cover create, read, update, touchAfter, absolute TTL cap, expire, revoke, and snapshots.
- Stateful tests cover duplicate rejection, clone-safe reads, subject revocation, filtered list, read-expiry persistence, and deterministic time.
- Adapter tests should verify Redis TTL/index behavior and SQL expiry/revocation queries.

## Source References

- Server-side session store patterns for Redis and SQL.
- Sliding session expiry with absolute lifetime limits.
- Subject-wide session revocation after credential changes.
`;

export const SESSION_STORE_MODULE: MwhModule = {
  id: "session-store",
  title: "Session Store Middleware",
  summary:
    "Reusable cache-state reference for server-side session TTL, sliding touch, revocation, subject-wide logout, expiry scans, and adapter tests.",
  version: "0.1.0",
  tags: ["cache-state", "session", "ttl", "auth", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
