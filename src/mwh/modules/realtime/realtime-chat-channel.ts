import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Realtime Chat Channel Middleware

## Purpose

Use this module as a reusable reference when implementing realtime chat, collaboration room messages, agent-to-agent conversation streams, support inboxes, or WebSocket/SSE room fan-out.

The module separates chat state rules from transport. It provides pure room-member, message, fan-out, history, and read-receipt logic plus a deterministic in-memory store for tests. Production adapters can use Socket.IO, WebSocket, SSE, Redis pub/sub, Postgres, or a local file-collaboration inbox/outbox bridge.

## When To Use

- A room needs ordered messages and member-aware fan-out.
- View-only participants should read but not post.
- Clients need incremental history after a known message id.
- Read receipts must be tracked independently from message delivery.

## When Not To Use

- Do not use memory state across multiple server processes.
- Do not treat room membership as authentication; validate access before join.
- Do not store secrets or private credentials in message metadata.
- Do not rely on transport delivery as durable persistence.

## Implementation Variants

1. In-memory channel
   - Useful for local tests, prototypes, and agent simulation.
2. Redis pub/sub plus durable SQL history
   - Redis fans out live messages while SQL stores room history and receipts.
3. Socket.IO adapter
   - Socket.IO rooms deliver messages while this module owns membership and receipt semantics.
4. File collaboration adapter
   - Map messages to local inbox/outbox JSONL files for coding-agent collaboration without ports.

## Recommended Architecture

- core.ts: pure member creation, post permission, message validation, fan-out planning, history paging, read-receipt validation.
- memory-store.ts: stateful join, leave, post, markRead, delivery audit, and room snapshot.
- adapters/socketio.ts: transport room fan-out and reconnect behavior.
- adapters/sql.ts: durable messages, room members, and read receipts.
- adapters/redis.ts: cross-process pub/sub and delivery notification.

## Public API Sketch

\`\`\`ts
const store = new MemoryChatChannelStore();
store.join({ roomId: "workspace:carboncode", userId: "codex" });
store.join({ roomId: "workspace:carboncode", userId: "carboncode" });
const posted = store.post({
  id: "msg_1",
  roomId: "workspace:carboncode",
  senderId: "codex",
  body: "Please review the upload middleware.",
});
store.markRead({
  roomId: "workspace:carboncode",
  userId: "carboncode",
  lastReadMessageId: posted.message.id,
});
\`\`\`

## Integration Rules

1. Validate authorization before joining a room.
2. Store message history durably before broadcasting when loss is unacceptable.
3. Exclude the sender from default delivery fan-out unless the transport requires echo.
4. Keep read receipts idempotent by replacing the user's latest receipt per room.
5. Page history by stable message id and deterministic createdAt/id ordering.
6. Keep presence optional; combine with presence-channel when online member snapshots are needed.

## Failure Modes

- Memory adapters lose history on restart.
- Duplicate message ids can confuse history paging unless the durable adapter enforces uniqueness.
- Viewer roles must be blocked from posting.
- Broadcast before persistence can lose messages during process crashes.
- Read receipts for missing messages indicate client/server history drift.

## Security Notes

- Authorize room membership before join, post, history, and markRead.
- Rate-limit message posts and history reads.
- Sanitize rendered message bodies in web clients.
- Avoid sensitive values in metadata because transports and logs may copy it.

## Verification Checklist

- Stateless tests cover member creation, viewer post rejection, message trimming/length validation, deterministic fan-out, history paging, and read-receipt validation.
- Stateful tests cover join, leave, post, delivery audit, viewer rejection, markRead, snapshots, and clone-safe history reads.
- SQL adapter tests should cover uniqueness, pagination, transaction-before-broadcast, and concurrent markRead updates.
- Transport adapter tests should cover reconnect, missed history replay, authorization failure, and sender echo policy.

## Source References

- Socket.IO room messaging patterns.
- WebSocket chat room fan-out patterns.
- Redis pub/sub plus SQL durable chat history architecture.
- Agent collaboration inbox/outbox protocols for local coding agents.
`;

export const REALTIME_CHAT_CHANNEL_MODULE: MwhModule = {
  id: "realtime-chat-channel",
  title: "Realtime Chat Channel Middleware",
  summary:
    "Reusable realtime chat reference with member roles, message validation, deterministic fan-out, history paging, read receipts, and stateful tests.",
  version: "0.1.0",
  tags: ["realtime", "chat", "channel", "websocket", "collaboration", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
