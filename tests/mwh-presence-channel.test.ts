import { describe, expect, it } from "vitest";
import {
  clonePresenceMember,
  createChannelSnapshot,
  createPresenceEvent,
  createPresenceMember,
  isPresenceExpired,
  presenceKey,
  refreshPresenceMember,
  splitExpiredPresence,
} from "../src/mwh/modules/realtime/presence-channel/core.js";
import { MemoryPresenceStore } from "../src/mwh/modules/realtime/presence-channel/memory-store.js";

describe("MWH presence-channel middleware", () => {
  it("creates members, refreshes heartbeat state, and emits pure events", () => {
    const metadata = { role: "agent" };
    const member = createPresenceMember({
      userId: "codex",
      connectionId: "conn-1",
      channelId: "workspace:carboncode",
      nowMs: 1_000,
      metadata,
    });
    metadata.role = "mutated";

    expect(member).toEqual({
      userId: "codex",
      connectionId: "conn-1",
      channelId: "workspace:carboncode",
      joinedAtMs: 1_000,
      lastSeenAtMs: 1_000,
      metadata: { role: "agent" },
    });
    const cloned = clonePresenceMember(member);
    cloned.metadata!.role = "mutated";
    expect(member.metadata).toEqual({ role: "agent" });
    expect(
      refreshPresenceMember(member, {
        nowMs: 1_500,
        metadata: { role: "agent", status: "busy" },
      }),
    ).toEqual({
      ...member,
      lastSeenAtMs: 1_500,
      metadata: { role: "agent", status: "busy" },
    });
    expect(createPresenceEvent({ type: "joined", member, nowMs: 1_000 })).toEqual({
      type: "joined",
      channelId: "workspace:carboncode",
      userId: "codex",
      connectionId: "conn-1",
      occurredAtMs: 1_000,
    });
  });

  it("splits expired and active members with deterministic TTL logic", () => {
    const oldMember = createPresenceMember({
      userId: "old",
      connectionId: "conn-old",
      channelId: "room",
      nowMs: 1_000,
    });
    const freshMember = createPresenceMember({
      userId: "fresh",
      connectionId: "conn-fresh",
      channelId: "room",
      nowMs: 1_800,
    });

    expect(isPresenceExpired(oldMember, { nowMs: 2_000, ttlMs: 1_000 })).toBe(true);
    expect(isPresenceExpired(freshMember, { nowMs: 2_000, ttlMs: 1_000 })).toBe(false);
    expect(
      splitExpiredPresence([oldMember, freshMember], {
        nowMs: 2_000,
        ttlMs: 1_000,
      }),
    ).toEqual({ active: [freshMember], expired: [oldMember] });
  });

  it("creates stable keys and sorted channel snapshots without cross-channel members", () => {
    const b = createPresenceMember({
      userId: "b",
      connectionId: "conn-b",
      channelId: "room",
      nowMs: 1_000,
    });
    const a = createPresenceMember({
      userId: "a",
      connectionId: "conn-a",
      channelId: "room",
      nowMs: 1_000,
    });
    const other = createPresenceMember({
      userId: "other",
      connectionId: "conn-other",
      channelId: "other-room",
      nowMs: 1_000,
    });

    expect(presenceKey(a)).toBe("room\0conn-a");
    expect(
      createChannelSnapshot({ channelId: "room", members: [b, other, a], nowMs: 2_000 }),
    ).toEqual({
      channelId: "room",
      members: [a, b],
      generatedAtMs: 2_000,
    });
  });

  it("joins, replaces duplicate connections, heartbeats, leaves, and records events", () => {
    let now = 1_000;
    const store = new MemoryPresenceStore({ now: () => now, ttlMs: 1_000 });

    expect(
      store.join({
        userId: "codex",
        connectionId: "conn-1",
        channelId: "room",
      }),
    ).toEqual(expect.objectContaining({ replaced: false }));
    now = 1_100;
    expect(
      store.join({
        userId: "codex",
        connectionId: "conn-1",
        channelId: "room",
        metadata: { reconnected: "true" },
      }),
    ).toEqual(expect.objectContaining({ replaced: true }));

    now = 1_200;
    expect(
      store.heartbeat({
        connectionId: "conn-1",
        channelId: "room",
        metadata: { status: "active" },
      }),
    ).toEqual(expect.objectContaining({ lastSeenAtMs: 1_200 }));
    expect(store.snapshot("room").members).toEqual([
      expect.objectContaining({
        userId: "codex",
        connectionId: "conn-1",
        metadata: { status: "active" },
      }),
    ]);

    const snapshot = store.snapshot("room");
    snapshot.members[0]!.metadata!.status = "mutated";
    expect(store.snapshot("room").members[0]?.metadata).toEqual({ status: "active" });

    now = 1_300;
    expect(store.leave({ connectionId: "conn-1", channelId: "room" })).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: "left", occurredAtMs: 1_300 }),
      }),
    );
    expect(store.snapshot("room").members).toEqual([]);
    expect(store.listEvents().map((event) => event.type)).toEqual([
      "joined",
      "joined",
      "heartbeat",
      "left",
    ]);
  });

  it("keeps returned join and heartbeat members clone-safe", () => {
    let now = 1_000;
    const store = new MemoryPresenceStore({ now: () => now, ttlMs: 1_000 });
    const joined = store.join({
      userId: "codex",
      connectionId: "conn-1",
      channelId: "room",
      metadata: { status: "joined" },
    });
    joined.member.metadata!.status = "mutated";

    now = 1_100;
    expect(
      store.heartbeat({
        connectionId: "conn-1",
        channelId: "room",
      }),
    ).toEqual(expect.objectContaining({ metadata: { status: "joined" } }));

    const heartbeat = store.heartbeat({
      connectionId: "conn-1",
      channelId: "room",
      metadata: { status: "active" },
    })!;
    heartbeat.metadata!.status = "mutated-again";
    expect(store.snapshot("room").members[0]?.metadata).toEqual({ status: "active" });
  });

  it("prunes expired members while keeping fresh members in state", () => {
    let now = 1_000;
    const store = new MemoryPresenceStore({ now: () => now, ttlMs: 500 });
    store.join({ userId: "old", connectionId: "old-conn", channelId: "room" });
    now = 1_400;
    store.join({ userId: "fresh", connectionId: "fresh-conn", channelId: "room" });

    now = 1_500;
    expect(store.pruneExpired()).toEqual([
      expect.objectContaining({
        type: "expired",
        userId: "old",
        connectionId: "old-conn",
        occurredAtMs: 1_500,
      }),
    ]);
    expect(store.snapshot("room").members.map((member) => member.userId)).toEqual(["fresh"]);
  });
});
