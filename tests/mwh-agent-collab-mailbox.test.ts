import { describe, expect, it } from "vitest";
import {
  collabThread,
  createCollabMessage,
  createCollabReply,
  createInboxEntry,
  createOutboxEntry,
  filterInbox,
  markInboxRead,
} from "../src/mwh/modules/ai-infra/agent-collab-mailbox/core.js";
import { MemoryAgentCollabMailbox } from "../src/mwh/modules/ai-infra/agent-collab-mailbox/memory-mailbox.js";

describe("MWH agent-collab-mailbox middleware", () => {
  it("creates validated collaboration messages and permission requests", () => {
    const message = createCollabMessage({
      id: "msg-1",
      from: "carboncode",
      to: "codex",
      type: "task",
      taskId: "task-1",
      body: { title: "implement module" },
      nowMs: 1_000,
    });

    expect(message).toEqual({
      id: "msg-1",
      from: "carboncode",
      to: "codex",
      type: "task",
      taskId: "task-1",
      body: { title: "implement module" },
      createdAtMs: 1_000,
    });
    expect(() =>
      createCollabMessage({
        id: "msg-2",
        from: "bad agent",
        to: "codex",
        type: "note",
        body: {},
        nowMs: 1_000,
      }),
    ).toThrow("from must be a stable agent id");
    expect(() =>
      createCollabMessage({
        id: "msg-3",
        from: "carboncode",
        to: "codex",
        type: "permission_request",
        body: {},
        nowMs: 1_000,
      }),
    ).toThrow("permission_request body.reason is required");
    expect(() =>
      createCollabMessage({
        id: "msg-4",
        from: "carboncode",
        to: "codex",
        type: "permission_response",
        body: {},
        nowMs: 1_000,
      }),
    ).toThrow("permission_response body.approved is required");
  });

  it("creates task-scoped replies and rejects spoofed reply senders", () => {
    const original = createCollabMessage({
      id: "msg-1",
      from: "carboncode",
      to: "codex",
      type: "permission_request",
      taskId: "task-1",
      body: { reason: "run tests" },
      nowMs: 1_000,
    });

    expect(
      createCollabReply({
        id: "msg-2",
        replyTo: original,
        type: "permission_response",
        body: { approved: true },
        nowMs: 1_100,
      }),
    ).toEqual({
      id: "msg-2",
      from: "codex",
      to: "carboncode",
      type: "permission_response",
      taskId: "task-1",
      body: { approved: true },
      createdAtMs: 1_100,
    });
    expect(() =>
      createCollabReply({
        id: "msg-3",
        replyTo: original,
        from: "other-agent",
        type: "ack",
        body: {},
        nowMs: 1_100,
      }),
    ).toThrow("reply sender must be the original recipient");
  });

  it("creates inbox/outbox entries, marks reads, filters inboxes, and builds threads", () => {
    const first = createCollabMessage({
      id: "msg-1",
      from: "carboncode",
      to: "codex",
      type: "task",
      taskId: "task-1",
      body: { title: "work" },
      nowMs: 1_000,
    });
    const second = createCollabMessage({
      id: "msg-2",
      from: "codex",
      to: "carboncode",
      type: "result",
      taskId: "task-1",
      body: { ok: true },
      nowMs: 1_100,
    });
    const inbox = [createInboxEntry(first)];
    const read = markInboxRead(inbox[0]!, { nowMs: 1_200 });

    expect(read.readAtMs).toBe(1_200);
    expect(filterInbox([read], { unreadOnly: true })).toEqual([]);
    expect(filterInbox([read], { from: "carboncode", taskId: "task-1" })).toHaveLength(1);
    expect(collabThread([read], [createOutboxEntry(second, { nowMs: 1_100 })], "task-1")).toEqual([
      first,
      second,
    ]);
  });

  it("runs stateful send, inbox/outbox audit, unread counts, markRead, filters, threads, and clone-safe bodies", () => {
    let now = 1_000;
    const mailbox = new MemoryAgentCollabMailbox<{ title?: string; ok?: boolean; reason?: string }>(
      {
        now: () => now,
      },
    );
    const task = mailbox.send({
      from: "carboncode",
      to: "codex",
      type: "task",
      taskId: "task-1",
      body: { title: "implement mailbox" },
    });
    now = 1_100;
    mailbox.send({
      from: "codex",
      to: "carboncode",
      type: "permission_request",
      taskId: "task-1",
      body: { reason: "run tests" },
    });
    now = 1_200;
    mailbox.send({
      from: "codex",
      to: "carboncode",
      type: "result",
      taskId: "task-1",
      body: { ok: true },
    });

    expect(mailbox.unreadCount("codex")).toBe(1);
    expect(mailbox.readInbox("codex", { unreadOnly: true })[0]?.message.id).toBe(task.id);
    mailbox.markRead("codex", task.id);
    expect(mailbox.unreadCount("codex")).toBe(0);
    expect(mailbox.readOutbox("carboncode")).toEqual([
      expect.objectContaining({ message: expect.objectContaining({ id: task.id }) }),
    ]);
    expect(mailbox.readInbox("carboncode", { from: "codex", taskId: "task-1" })).toHaveLength(2);
    expect(mailbox.thread("carboncode", "task-1").map((message) => message.type)).toEqual([
      "task",
      "permission_request",
      "result",
    ]);

    const read = mailbox.readInbox("carboncode")[0]!;
    read.message.body.reason = "mutated";
    expect(mailbox.readInbox("carboncode")[0]?.message.body).toEqual({ reason: "run tests" });
  });

  it("runs stateful replies and acknowledgements from inbox messages", () => {
    let now = 1_000;
    const mailbox = new MemoryAgentCollabMailbox<Record<string, unknown>>({ now: () => now });
    const request = mailbox.send({
      from: "carboncode",
      to: "codex",
      type: "permission_request",
      taskId: "task-1",
      body: { reason: "run tests" },
    });

    now = 1_100;
    expect(
      mailbox.reply({
        agent: "codex",
        messageId: request.id,
        type: "permission_response",
        body: { approved: true },
      }),
    ).toEqual({
      id: "msg-2",
      from: "codex",
      to: "carboncode",
      type: "permission_response",
      taskId: "task-1",
      body: { approved: true },
      createdAtMs: 1_100,
    });

    now = 1_200;
    expect(mailbox.ack("carboncode", "msg-2", { seen: true })).toEqual({
      id: "msg-3",
      from: "carboncode",
      to: "codex",
      type: "ack",
      taskId: "task-1",
      body: { seen: true },
      createdAtMs: 1_200,
    });
    expect(() =>
      mailbox.reply({
        agent: "codex",
        messageId: "missing",
        type: "ack",
        body: {},
      }),
    ).toThrow("message not found");
    expect(mailbox.thread("codex", "task-1").map((message) => message.type)).toEqual([
      "permission_request",
      "permission_response",
      "ack",
    ]);
  });
});
