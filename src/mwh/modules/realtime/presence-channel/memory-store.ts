import {
  type ChannelSnapshot,
  type PresenceEvent,
  type PresenceMember,
  clonePresenceEvent,
  clonePresenceMember,
  createChannelSnapshot,
  createPresenceEvent,
  createPresenceMember,
  presenceKey,
  refreshPresenceMember,
  splitExpiredPresence,
} from "./core.js";

export interface JoinPresenceResult {
  member: PresenceMember;
  event: PresenceEvent;
  replaced: boolean;
}

export interface LeavePresenceResult {
  member: PresenceMember;
  event: PresenceEvent;
}

export interface MemoryPresenceStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

export class MemoryPresenceStore {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly members = new Map<string, PresenceMember>();
  private readonly events: PresenceEvent[] = [];

  constructor(opts: MemoryPresenceStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 30_000;
    if (!Number.isInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("ttlMs must be a positive integer");
    }
  }

  join(input: {
    userId: string;
    connectionId: string;
    channelId: string;
    metadata?: Record<string, string>;
  }): JoinPresenceResult {
    const member = createPresenceMember({ ...input, nowMs: this.now() });
    const key = presenceKey(member);
    const replaced = this.members.has(key);
    this.members.set(key, member);
    const event = createPresenceEvent({ type: "joined", member, nowMs: member.joinedAtMs });
    this.events.push(event);
    return { member: clonePresenceMember(member), event: clonePresenceEvent(event), replaced };
  }

  heartbeat(input: {
    connectionId: string;
    channelId: string;
    metadata?: Record<string, string>;
  }): PresenceMember | null {
    const key = presenceKey(input);
    const existing = this.members.get(key);
    if (!existing) return null;
    const next = refreshPresenceMember(existing, {
      nowMs: this.now(),
      metadata: input.metadata,
    });
    this.members.set(key, next);
    this.events.push(
      createPresenceEvent({ type: "heartbeat", member: next, nowMs: next.lastSeenAtMs }),
    );
    return clonePresenceMember(next);
  }

  leave(input: { connectionId: string; channelId: string }): LeavePresenceResult | null {
    const key = presenceKey(input);
    const member = this.members.get(key);
    if (!member) return null;
    this.members.delete(key);
    const event = createPresenceEvent({ type: "left", member, nowMs: this.now() });
    this.events.push(event);
    return { member: clonePresenceMember(member), event: clonePresenceEvent(event) };
  }

  pruneExpired(): PresenceEvent[] {
    const nowMs = this.now();
    const { expired } = splitExpiredPresence([...this.members.values()], {
      nowMs,
      ttlMs: this.ttlMs,
    });
    const events = expired.map((member) => {
      this.members.delete(presenceKey(member));
      return createPresenceEvent({ type: "expired", member, nowMs });
    });
    this.events.push(...events);
    return events.map(clonePresenceEvent);
  }

  snapshot(channelId: string): ChannelSnapshot {
    return createChannelSnapshot({
      channelId,
      members: [...this.members.values()],
      nowMs: this.now(),
    });
  }

  listEvents(): PresenceEvent[] {
    return this.events.map(clonePresenceEvent);
  }
}
