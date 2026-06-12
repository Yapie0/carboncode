import {
  type ChatDelivery,
  type ChatMessage,
  type ChatReadReceipt,
  type ChatRoomMember,
  type ChatRoomRole,
  canPostMessage,
  chatMemberKey,
  createChatMember,
  createChatMessage,
  createReadReceipt,
  historyAfter,
  planMessageFanout,
} from "./core.js";

export interface MemoryChatChannelOptions {
  now?: () => number;
  maxBodyLength?: number;
}

export interface PostChatMessageResult {
  message: ChatMessage;
  deliveries: ChatDelivery[];
}

export interface ChatRoomSnapshot {
  roomId: string;
  members: ChatRoomMember[];
  messages: ChatMessage[];
  receipts: ChatReadReceipt[];
  generatedAtMs: number;
}

export class MemoryChatChannelStore {
  private readonly now: () => number;
  private readonly maxBodyLength: number;
  private readonly members = new Map<string, ChatRoomMember>();
  private readonly messages: ChatMessage[] = [];
  private readonly deliveries: ChatDelivery[] = [];
  private readonly receipts = new Map<string, ChatReadReceipt>();

  constructor(options: MemoryChatChannelOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxBodyLength = options.maxBodyLength ?? 4_000;
  }

  join(input: { roomId: string; userId: string; role?: ChatRoomRole }): ChatRoomMember {
    const member = createChatMember({ ...input, nowMs: this.now() });
    this.members.set(chatMemberKey(member), member);
    return { ...member };
  }

  leave(input: { roomId: string; userId: string }): ChatRoomMember | null {
    const key = chatMemberKey(input);
    const member = this.members.get(key);
    if (!member) return null;
    this.members.delete(key);
    return { ...member };
  }

  post(input: {
    id: string;
    roomId: string;
    senderId: string;
    body: string;
    metadata?: Record<string, string>;
  }): PostChatMessageResult {
    const sender = this.members.get(
      chatMemberKey({ roomId: input.roomId, userId: input.senderId }),
    );
    if (!canPostMessage(sender, input.roomId)) {
      throw new Error("sender is not allowed to post in room");
    }
    const message = createChatMessage({
      ...input,
      nowMs: this.now(),
      maxBodyLength: this.maxBodyLength,
    });
    this.messages.push(message);
    const deliveries = planMessageFanout({
      message,
      members: [...this.members.values()],
      nowMs: message.createdAtMs,
    });
    this.deliveries.push(...deliveries);
    return {
      message: { ...message },
      deliveries: deliveries.map((delivery) => ({ ...delivery })),
    };
  }

  markRead(input: {
    roomId: string;
    userId: string;
    lastReadMessageId: string;
  }): ChatReadReceipt {
    if (!this.members.has(chatMemberKey({ roomId: input.roomId, userId: input.userId }))) {
      throw new Error("reader is not a room member");
    }
    const receipt = createReadReceipt({
      ...input,
      messages: this.messages,
      nowMs: this.now(),
    });
    this.receipts.set(chatMemberKey(input), receipt);
    return { ...receipt };
  }

  history(input: { roomId: string; afterMessageId?: string; limit?: number }): ChatMessage[] {
    return historyAfter({ ...input, messages: this.messages });
  }

  listDeliveries(roomId?: string): ChatDelivery[] {
    return this.deliveries
      .filter((delivery) => !roomId || delivery.roomId === roomId)
      .map((delivery) => ({ ...delivery }));
  }

  snapshot(roomId: string): ChatRoomSnapshot {
    return {
      roomId,
      members: [...this.members.values()]
        .filter((member) => member.roomId === roomId)
        .map((member) => ({ ...member }))
        .sort((a, b) => a.userId.localeCompare(b.userId)),
      messages: this.history({ roomId }),
      receipts: [...this.receipts.values()]
        .filter((receipt) => receipt.roomId === roomId)
        .map((receipt) => ({ ...receipt }))
        .sort((a, b) => a.userId.localeCompare(b.userId)),
      generatedAtMs: this.now(),
    };
  }
}
