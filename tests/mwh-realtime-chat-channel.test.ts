import { describe, expect, it } from "vitest";
import {
  canPostMessage,
  chatMemberKey,
  createChatMember,
  createChatMessage,
  createReadReceipt,
  historyAfter,
  planMessageFanout,
} from "../src/mwh/modules/realtime/realtime-chat-channel/core.js";
import { MemoryChatChannelStore } from "../src/mwh/modules/realtime/realtime-chat-channel/memory-store.js";

describe("MWH realtime-chat-channel stateless core", () => {
  it("creates room members and enforces viewer post permissions", () => {
    const member = createChatMember({
      roomId: "room",
      userId: "codex",
      nowMs: 1_000,
    });
    const viewer = createChatMember({
      roomId: "room",
      userId: "viewer",
      role: "viewer",
      nowMs: 1_000,
    });

    expect(member).toEqual({
      roomId: "room",
      userId: "codex",
      role: "member",
      joinedAtMs: 1_000,
    });
    expect(chatMemberKey(member)).toBe("room\0codex");
    expect(canPostMessage(member, "room")).toBe(true);
    expect(canPostMessage(viewer, "room")).toBe(false);
    expect(canPostMessage(member, "other-room")).toBe(false);
  });

  it("validates and trims messages with a max body length", () => {
    expect(
      createChatMessage({
        id: "msg-1",
        roomId: "room",
        senderId: "codex",
        body: " hello ",
        nowMs: 1_000,
        maxBodyLength: 5,
      }),
    ).toEqual({
      id: "msg-1",
      roomId: "room",
      senderId: "codex",
      body: "hello",
      createdAtMs: 1_000,
      metadata: undefined,
    });
    expect(() =>
      createChatMessage({
        id: "msg-2",
        roomId: "room",
        senderId: "codex",
        body: "too long",
        nowMs: 1_000,
        maxBodyLength: 3,
      }),
    ).toThrow("body exceeds maxBodyLength");
  });

  it("plans deterministic message fan-out excluding the sender by default", () => {
    const message = createChatMessage({
      id: "msg-1",
      roomId: "room",
      senderId: "b",
      body: "hello",
      nowMs: 1_000,
    });
    const members = [
      createChatMember({ roomId: "room", userId: "b", nowMs: 0 }),
      createChatMember({ roomId: "room", userId: "a", nowMs: 0 }),
      createChatMember({ roomId: "other", userId: "other", nowMs: 0 }),
      createChatMember({ roomId: "room", userId: "c", nowMs: 0 }),
    ];

    expect(planMessageFanout({ message, members, nowMs: 1_001 })).toEqual([
      { messageId: "msg-1", roomId: "room", recipientId: "a", deliveredAtMs: 1_001 },
      { messageId: "msg-1", roomId: "room", recipientId: "c", deliveredAtMs: 1_001 },
    ]);
  });

  it("pages history and validates read receipts against room messages", () => {
    const messages = [
      createChatMessage({ id: "msg-2", roomId: "room", senderId: "a", body: "two", nowMs: 20 }),
      createChatMessage({ id: "msg-1", roomId: "room", senderId: "a", body: "one", nowMs: 10 }),
      createChatMessage({ id: "msg-x", roomId: "other", senderId: "a", body: "x", nowMs: 5 }),
    ];

    expect(
      historyAfter({ roomId: "room", messages, limit: 1 }).map((message) => message.id),
    ).toEqual(["msg-1"]);
    expect(historyAfter({ roomId: "room", messages, afterMessageId: "msg-1" })).toEqual([
      expect.objectContaining({ id: "msg-2" }),
    ]);
    expect(
      createReadReceipt({
        roomId: "room",
        userId: "b",
        lastReadMessageId: "msg-2",
        messages,
        nowMs: 30,
      }),
    ).toEqual({
      roomId: "room",
      userId: "b",
      lastReadMessageId: "msg-2",
      readAtMs: 30,
    });
    expect(() =>
      createReadReceipt({
        roomId: "room",
        userId: "b",
        lastReadMessageId: "missing",
        messages,
        nowMs: 30,
      }),
    ).toThrow("lastReadMessageId not found in room");
  });
});

describe("MWH realtime-chat-channel stateful memory store", () => {
  it("joins members, posts messages, records delivery audit, and marks read", () => {
    let now = 1_000;
    const store = new MemoryChatChannelStore({ now: () => now });
    store.join({ roomId: "room", userId: "codex" });
    store.join({ roomId: "room", userId: "carboncode" });
    store.join({ roomId: "room", userId: "viewer", role: "viewer" });

    now = 1_100;
    const posted = store.post({
      id: "msg-1",
      roomId: "room",
      senderId: "codex",
      body: "  review upload middleware  ",
    });
    expect(posted.message).toEqual(expect.objectContaining({ body: "review upload middleware" }));
    expect(posted.deliveries.map((delivery) => delivery.recipientId)).toEqual([
      "carboncode",
      "viewer",
    ]);
    expect(store.listDeliveries("room")).toHaveLength(2);

    now = 1_200;
    expect(
      store.markRead({
        roomId: "room",
        userId: "carboncode",
        lastReadMessageId: "msg-1",
      }),
    ).toEqual({
      roomId: "room",
      userId: "carboncode",
      lastReadMessageId: "msg-1",
      readAtMs: 1_200,
    });
    expect(store.snapshot("room")).toEqual(
      expect.objectContaining({
        members: [
          expect.objectContaining({ userId: "carboncode" }),
          expect.objectContaining({ userId: "codex" }),
          expect.objectContaining({ userId: "viewer" }),
        ],
        messages: [expect.objectContaining({ id: "msg-1" })],
        receipts: [expect.objectContaining({ userId: "carboncode" })],
      }),
    );
  });

  it("rejects viewer posts, supports leave, and returns clone-safe history", () => {
    let now = 1_000;
    const store = new MemoryChatChannelStore({ now: () => now });
    store.join({ roomId: "room", userId: "writer" });
    store.join({ roomId: "room", userId: "viewer", role: "viewer" });

    expect(() =>
      store.post({ id: "msg-viewer", roomId: "room", senderId: "viewer", body: "nope" }),
    ).toThrow("sender is not allowed to post in room");

    now = 1_100;
    store.post({ id: "msg-1", roomId: "room", senderId: "writer", body: "one" });
    const history = store.history({ roomId: "room" });
    history[0]!.body = "mutated";
    expect(store.history({ roomId: "room" })[0]?.body).toBe("one");

    expect(store.leave({ roomId: "room", userId: "viewer" })).toEqual(
      expect.objectContaining({ role: "viewer" }),
    );
    expect(store.snapshot("room").members.map((member) => member.userId)).toEqual(["writer"]);
  });
});
