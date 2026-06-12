import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: In-App Notification Store

## Purpose

Use this module as a reusable reference for storing and reading in-app notifications: create user-scoped records, page newest-first inbox views, track unread counts, mark notifications read, archive old items, and expire TTL-bound notifications.

The module is intentionally separate from email, SMS, push, and webhook delivery adapters. It models the durable in-app inbox that a UI can query after notification routing decides an in-app channel should receive a message.

## When To Use

- Need a notification center or inbox inside an application.
- Need unread counts and cursor pagination.
- Need deterministic tests before adding SQL, Redis, or document-store persistence.
- Need archive and expiry behavior separate from provider delivery state.

## When Not To Use

- Do not use this store as a cross-channel delivery worker.
- Do not expose notifications without checking user authorization.
- Do not keep sensitive notification bodies indefinitely without retention policy.
- Do not use process memory as production storage.

## Implementation Variants

- Memory store for tests and local prototypes.
- SQL table with user_id, status, created_at, read_at, archived_at, expires_at indexes.
- Redis sorted set for short-lived notification centers.
- Document store collection for rich inbox metadata.
- Realtime adapter that emits unread-count changes over WebSocket or SSE.

## Recommended Architecture

- core.ts: pure record creation, status classification, read/archive/expire transitions, clone helpers, and paging.
- memory-store.ts: stateful create, markRead, archive, page, unreadCount, pruneExpired, get, and list behavior.
- adapters/sql.ts: durable inbox table and unread-count query.
- adapters/redis.ts: sorted-set inbox plus hash payloads for transient notifications.
- integrations/realtime.ts: publish inbox changes to connected clients.

## Public API Sketch

\`\`\`ts
const store = new MemoryInAppNotificationStore();
store.create({
  id: "n1",
  userId: "u1",
  type: "deploy.finished",
  title: "Deploy finished",
  body: "Production is live.",
});

const page = store.page({ userId: "u1", limit: 20 });
store.markRead("n1");
\`\`\`

## Integration Rules

1. Store notifications with a stable user scope.
2. Page newest-first with a stable cursor.
3. Keep unread counts derived from non-archived, non-expired records.
4. Archive instead of deleting when user history matters.
5. Apply TTL for transient operational notifications.
6. Authorize every inbox read by user/session scope.

## Failure Modes

- Cursor paging becomes unstable without a deterministic tie-breaker.
- Unread counts include archived or expired records.
- Expired records remain visible in UI queries.
- Memory stores lose inbox state on restart.
- Missing user authorization leaks notification contents.

## Security Notes

- Treat notification body and metadata as user data.
- Avoid storing secrets or full sensitive event payloads.
- Enforce access control before list/get operations.
- Apply retention policy for compliance-sensitive notifications.

## Verification Checklist

- Stateless tests cover creation, read/archive/expire transitions, paging, cursor behavior, unread counts, and clone safety.
- Stateful tests cover create, duplicate rejection, markRead, archive, page, unreadCount, TTL pruning, get/list, and clone-safe records.
- SQL adapter tests should verify user_id/status indexes and stable pagination.
- Realtime integration tests should verify unread-count updates after create/read/archive.

## Source References

- In-app notification center patterns.
- Cursor pagination and unread-count inbox models.
- SQL status-indexed notification tables.
- Realtime unread-count update patterns.
`;

export const IN_APP_NOTIFICATION_STORE_MODULE: MwhModule = {
  id: "in-app-notification-store",
  title: "In-App Notification Store",
  summary:
    "Reusable notification reference for user-scoped in-app inbox storage, unread counts, cursor paging, read/archive transitions, TTL expiry, and stateful tests.",
  version: "0.1.0",
  tags: ["notification", "in-app", "inbox", "unread", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
