export interface PresenceMember {
  userId: string;
  connectionId: string;
  channelId: string;
  joinedAtMs: number;
  lastSeenAtMs: number;
  metadata?: Record<string, string>;
}

export interface PresenceEvent {
  type: "joined" | "heartbeat" | "left" | "expired";
  channelId: string;
  userId: string;
  connectionId: string;
  occurredAtMs: number;
}

export interface ChannelSnapshot {
  channelId: string;
  members: PresenceMember[];
  generatedAtMs: number;
}

export function createPresenceMember(input: {
  userId: string;
  connectionId: string;
  channelId: string;
  nowMs: number;
  metadata?: Record<string, string>;
}): PresenceMember {
  assertNonEmpty(input.userId, "userId");
  assertNonEmpty(input.connectionId, "connectionId");
  assertNonEmpty(input.channelId, "channelId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    userId: input.userId,
    connectionId: input.connectionId,
    channelId: input.channelId,
    joinedAtMs: input.nowMs,
    lastSeenAtMs: input.nowMs,
    metadata: cloneMetadata(input.metadata),
  };
}

export function refreshPresenceMember(
  member: PresenceMember,
  input: { nowMs: number; metadata?: Record<string, string> },
): PresenceMember {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.nowMs < member.joinedAtMs) {
    throw new Error("nowMs must not be earlier than joinedAtMs");
  }
  return {
    ...member,
    lastSeenAtMs: input.nowMs,
    metadata: cloneMetadata(input.metadata ?? member.metadata),
  };
}

export function isPresenceExpired(
  member: PresenceMember,
  input: { nowMs: number; ttlMs: number },
): boolean {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return input.nowMs - member.lastSeenAtMs >= input.ttlMs;
}

export function splitExpiredPresence(
  members: readonly PresenceMember[],
  input: { nowMs: number; ttlMs: number },
): { active: PresenceMember[]; expired: PresenceMember[] } {
  const active: PresenceMember[] = [];
  const expired: PresenceMember[] = [];
  for (const member of members) {
    if (isPresenceExpired(member, input)) expired.push(member);
    else active.push(member);
  }
  return { active, expired };
}

export function createPresenceEvent(input: {
  type: PresenceEvent["type"];
  member: PresenceMember;
  nowMs: number;
}): PresenceEvent {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    type: input.type,
    channelId: input.member.channelId,
    userId: input.member.userId,
    connectionId: input.member.connectionId,
    occurredAtMs: input.nowMs,
  };
}

export function createChannelSnapshot(input: {
  channelId: string;
  members: readonly PresenceMember[];
  nowMs: number;
}): ChannelSnapshot {
  assertNonEmpty(input.channelId, "channelId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    channelId: input.channelId,
    members: input.members
      .filter((member) => member.channelId === input.channelId)
      .map(clonePresenceMember)
      .sort(
        (a, b) => a.userId.localeCompare(b.userId) || a.connectionId.localeCompare(b.connectionId),
      ),
    generatedAtMs: input.nowMs,
  };
}

export function presenceKey(input: { channelId: string; connectionId: string }): string {
  assertNonEmpty(input.channelId, "channelId");
  assertNonEmpty(input.connectionId, "connectionId");
  return `${input.channelId}\0${input.connectionId}`;
}

export function clonePresenceMember(member: PresenceMember): PresenceMember {
  return {
    ...member,
    metadata: cloneMetadata(member.metadata),
  };
}

export function clonePresenceEvent(event: PresenceEvent): PresenceEvent {
  return { ...event };
}

function cloneMetadata(
  metadata: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return metadata ? { ...metadata } : undefined;
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
