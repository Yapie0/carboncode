import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Presence Channel Middleware

## Purpose

Use this module as a reusable reference for realtime presence, collaboration rooms, chat online members, cursor/session liveness, and agent collaboration channels.

The module contains stateless presence logic plus a stateful in-memory store. Production adapters can replace the memory store with Redis, Postgres, durable files, Socket.IO rooms, WebSocket connection registries, or a Carbon Code collaboration inbox/outbox bridge.

## When To Use

- Track which users, agents, or browser connections are online in a channel.
- Build collaboration rooms with join, heartbeat, leave, and expiry events.
- Add deterministic presence behavior before choosing Socket.IO, WebSocket, SSE, or file polling transport.
- Share a common presence contract across CLI, dashboard, and external agents.

## When Not To Use

- Do not use process-local memory as the source of truth across multiple server instances.
- Do not treat presence as authorization; enforce permissions separately.
- Do not expose raw connection metadata to untrusted peers.
- Do not use presence heartbeats as durable audit logs.

## Implementation Variants

- Memory store for local tests and single-process prototypes.
- Redis hash/sorted-set adapter for multi-instance rooms and TTL pruning.
- Postgres table adapter for durable presence snapshots and audit-friendly channels.
- Socket.IO adapter where transport rooms are used for fan-out while this module owns the state contract.
- File polling adapter for local agent collaboration without opening network ports.

## Recommended Architecture

- core.ts: pure member creation, heartbeat refresh, expiry detection, event creation, stable keys, and channel snapshots.
- memory-store.ts: stateful join, heartbeat, leave, pruneExpired, event history, and snapshots.
- adapters/redis.ts: distributed presence with key expiry and pub/sub events.
- adapters/socketio.ts: transport fan-out while retaining the same presence state transitions.
- adapters/file-collab.ts: Carbon Code style inbox/outbox bridge for local multi-agent collaboration.

## Public API Sketch

\`\`\`ts
const store = new MemoryPresenceStore({ ttlMs: 30_000 });
store.join({
  userId: "codex",
  connectionId: "codex-session-1",
  channelId: "workspace:carboncode",
});
store.heartbeat({ connectionId: "codex-session-1", channelId: "workspace:carboncode" });
const snapshot = store.snapshot("workspace:carboncode");
const expiredEvents = store.pruneExpired();
\`\`\`

## Integration Rules

1. Treat join, heartbeat, leave, and expired as explicit state transitions.
2. Use connectionId for one device/process and userId for the logical participant.
3. Prune by TTL so crashed clients eventually leave the channel.
4. Broadcast presence events after state mutation succeeds.
5. Keep authorization outside presence; check channel access before join.
6. Keep adapters replaceable by depending on the core contract, not Socket.IO-specific APIs.

## Failure Modes

- Crashed clients remain online until TTL expiry.
- Clock skew can expire members too early in distributed deployments.
- Multi-instance memory stores diverge without Redis/Postgres/shared storage.
- Reused connection IDs replace existing members in the same channel.
- Heartbeat storms can overload storage when intervals are too aggressive.

## Security Notes

- Validate channel access before accepting join or heartbeat.
- Avoid storing secrets, tokens, or private file paths in presence metadata.
- Rate-limit heartbeat and join events by connection/user.
- Treat presence snapshots as potentially sensitive collaboration metadata.

## Verification Checklist

- Stateless tests cover member creation, heartbeat refresh, TTL expiry, expired/active split, stable keys, and sorted channel snapshots.
- Stateful tests cover join replacement, heartbeat updates, leave events, TTL pruning, event history, and per-channel snapshots.
- Redis/Postgres adapters should test duplicate connection IDs, concurrent heartbeats, TTL cleanup, and event ordering.
- Transport adapters should test reconnects, duplicate joins, and authorization failures.

## Source References

- Socket.IO rooms and presence patterns.
- Redis presence patterns using hashes, sorted sets, expiry, and pub/sub.
- WebSocket heartbeat/liveness patterns.
- Local file-polling collaboration protocols used by coding agents.
`;

export const PRESENCE_CHANNEL_MODULE: MwhModule = {
  id: "presence-channel",
  title: "Presence Channel Middleware",
  summary:
    "Reusable realtime presence reference with join, heartbeat, leave, TTL expiry, channel snapshots, and adapter-ready state tests.",
  version: "0.1.0",
  tags: ["realtime", "presence", "channel", "collaboration", "websocket", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
