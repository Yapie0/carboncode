export type ChatRoomRole = "owner" | "member" | "viewer";

export interface ChatRoomMember {
  roomId: string;
  userId: string;
  role: ChatRoomRole;
  joinedAtMs: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  createdAtMs: number;
  metadata?: Record<string, string>;
}

export interface ChatDelivery {
  messageId: string;
  roomId: string;
  recipientId: string;
  deliveredAtMs: number;
}

export interface ChatReadReceipt {
  roomId: string;
  userId: string;
  lastReadMessageId: string;
  readAtMs: number;
}

export function createChatMember(input: {
  roomId: string;
  userId: string;
  role?: ChatRoomRole;
  nowMs: number;
}): ChatRoomMember {
  assertNonEmpty(input.roomId, "roomId");
  assertNonEmpty(input.userId, "userId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    roomId: input.roomId,
    userId: input.userId,
    role: input.role ?? "member",
    joinedAtMs: input.nowMs,
  };
}

export function canPostMessage(member: ChatRoomMember | undefined, roomId: string): boolean {
  assertNonEmpty(roomId, "roomId");
  return Boolean(member && member.roomId === roomId && member.role !== "viewer");
}

export function createChatMessage(input: {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  nowMs: number;
  metadata?: Record<string, string>;
  maxBodyLength?: number;
}): ChatMessage {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.roomId, "roomId");
  assertNonEmpty(input.senderId, "senderId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const body = input.body.trim();
  if (!body) throw new Error("body is required");
  const maxBodyLength = input.maxBodyLength ?? 4_000;
  assertPositiveInteger(maxBodyLength, "maxBodyLength");
  if (body.length > maxBodyLength) throw new Error("body exceeds maxBodyLength");
  return {
    id: input.id,
    roomId: input.roomId,
    senderId: input.senderId,
    body,
    createdAtMs: input.nowMs,
    metadata: input.metadata,
  };
}

export function planMessageFanout(input: {
  message: ChatMessage;
  members: readonly ChatRoomMember[];
  nowMs: number;
  includeSender?: boolean;
}): ChatDelivery[] {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return input.members
    .filter((member) => member.roomId === input.message.roomId)
    .filter((member) => input.includeSender || member.userId !== input.message.senderId)
    .sort((a, b) => a.userId.localeCompare(b.userId))
    .map((member) => ({
      messageId: input.message.id,
      roomId: input.message.roomId,
      recipientId: member.userId,
      deliveredAtMs: input.nowMs,
    }));
}

export function createReadReceipt(input: {
  roomId: string;
  userId: string;
  lastReadMessageId: string;
  messages: readonly ChatMessage[];
  nowMs: number;
}): ChatReadReceipt {
  assertNonEmpty(input.roomId, "roomId");
  assertNonEmpty(input.userId, "userId");
  assertNonEmpty(input.lastReadMessageId, "lastReadMessageId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const exists = input.messages.some(
    (message) => message.roomId === input.roomId && message.id === input.lastReadMessageId,
  );
  if (!exists) throw new Error("lastReadMessageId not found in room");
  return {
    roomId: input.roomId,
    userId: input.userId,
    lastReadMessageId: input.lastReadMessageId,
    readAtMs: input.nowMs,
  };
}

export function historyAfter(input: {
  roomId: string;
  messages: readonly ChatMessage[];
  afterMessageId?: string;
  limit?: number;
}): ChatMessage[] {
  assertNonEmpty(input.roomId, "roomId");
  const limit = input.limit ?? 50;
  assertPositiveInteger(limit, "limit");
  const sorted = input.messages
    .filter((message) => message.roomId === input.roomId)
    .map((message) => ({ ...message }))
    .sort((a, b) => a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id));
  if (!input.afterMessageId) return sorted.slice(0, limit);
  const index = sorted.findIndex((message) => message.id === input.afterMessageId);
  if (index < 0) throw new Error("afterMessageId not found in room");
  return sorted.slice(index + 1, index + 1 + limit);
}

export function chatMemberKey(input: { roomId: string; userId: string }): string {
  assertNonEmpty(input.roomId, "roomId");
  assertNonEmpty(input.userId, "userId");
  return `${input.roomId}\0${input.userId}`;
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
