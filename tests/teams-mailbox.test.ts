import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ack,
  markAllRead,
  markRead,
  readInbox,
  readOutbox,
  reply,
  sendMessage,
  thread,
  unreadCount,
} from "../src/teams/mailbox.js";
import { createTeam } from "../src/teams/store.js";
import type { TeamAgent } from "../src/teams/types.js";

const TEST_AGENT_A: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "backend-dev",
  displayName: "后端开发者",
  capabilities: ["typescript"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

const TEST_AGENT_B: Omit<TeamAgent, "id" | "inboxPath" | "outboxPath"> = {
  role: "researcher",
  displayName: "研究员",
  capabilities: ["code-search"],
  status: "idle",
  modelPreference: "deepseek-v4-flash",
};

describe("teams-mailbox", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-teams-mail-"));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  describe("input validation", () => {
    it("rejects empty agent id", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      expect(() =>
        sendMessage(dir, "demo", {
          from: "",
          to: "backend-dev",
          type: "note",
          body: {},
        }),
      ).toThrow("from is required");
    });

    it("rejects self-loop", () => {
      expect(() =>
        sendMessage(dir, "demo", {
          from: "backend-dev",
          to: "backend-dev",
          type: "note",
          body: {},
        }),
      ).toThrow("different agents");
    });

    it("rejects permission_request without reason", () => {
      expect(() =>
        sendMessage(dir, "demo", {
          from: "researcher",
          to: "backend-dev",
          type: "permission_request",
          body: {},
        }),
      ).toThrow("body.reason");
    });
  });

  describe("sendMessage / readInbox / readOutbox", () => {
    it("sends a message and reads it from inbox", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const msg = sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "task",
        taskId: "task-1",
        body: { title: "Research complete" },
      });

      expect(msg.id).toBeDefined();
      expect(msg.readAtMs).toBeUndefined();

      const inbox = readInbox(dir, "demo", "backend-dev");
      expect(inbox).toHaveLength(1);
      expect(inbox[0]!.body.title).toBe("Research complete");

      const outbox = readOutbox(dir, "demo", "researcher");
      expect(outbox).toHaveLength(1);
      expect(outbox[0]!.id).toBe(msg.id);
    });

    it("filters unread messages", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "note",
        body: {},
      });

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "note",
        body: {},
      });

      markRead(dir, "demo", "backend-dev", readInbox(dir, "demo", "backend-dev")[0]!.id);

      const unread = readInbox(dir, "demo", "backend-dev", { unreadOnly: true });
      expect(unread).toHaveLength(1);
    });

    it("filters by taskId", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "task",
        taskId: "task-1",
        body: {},
      });

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "task",
        taskId: "task-2",
        body: {},
      });

      const filtered = readInbox(dir, "demo", "backend-dev", { taskId: "task-1" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.taskId).toBe("task-1");
    });

    it("filters by sender", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "note",
        body: {},
      });

      sendMessage(dir, "demo", {
        from: "team-lead",
        to: "backend-dev",
        type: "note",
        body: {},
      });

      const filtered = readInbox(dir, "demo", "backend-dev", { from: "team-lead" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.from).toBe("team-lead");
    });
  });

  describe("markRead / markAllRead / unreadCount", () => {
    it("marks with readAtMs timestamp", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "note",
        body: {},
      });
      const all = readInbox(dir, "demo", "backend-dev");

      const before = Date.now();
      const marked = markRead(dir, "demo", "backend-dev", all[0]!.id);
      expect(marked.id).toBe(all[0]!.id);
      expect(marked.readAtMs).toBeGreaterThanOrEqual(before);

      const after = readInbox(dir, "demo", "backend-dev");
      expect(after[0]!.readAtMs).toBeDefined();
    });

    it("marks all messages as read", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      sendMessage(dir, "demo", {
        from: "carboncode",
        to: "backend-dev",
        type: "note",
        body: {},
      });
      sendMessage(dir, "demo", {
        from: "codex",
        to: "backend-dev",
        type: "note",
        body: {},
      });

      const count = markAllRead(dir, "demo", "backend-dev");
      expect(count).toBe(2);

      expect(unreadCount(dir, "demo", "backend-dev")).toBe(0);
    });

    it("throws on non-existent message id", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      expect(() => markRead(dir, "demo", "backend-dev", "nonexistent")).toThrow(
        "message not found",
      );
    });
  });

  describe("reply / ack", () => {
    it("replies to a message with auto-flipped from/to", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      // researcher → backend-dev
      const msg = sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "task",
        taskId: "task-1",
        body: { title: "Research" },
      });

      // backend-dev replies
      const r = reply(dir, "demo", {
        agent: "backend-dev",
        replyToId: msg.id,
        type: "result",
        body: { status: "done" },
      });

      expect(r.from).toBe("backend-dev");
      expect(r.to).toBe("researcher");
      expect(r.taskId).toBe("task-1");
      expect(r.inReplyTo).toBe(msg.id);
    });

    it("ack is shorthand for reply type:ack", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      const msg = sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "note",
        body: {},
      });

      const a = ack(dir, "demo", "backend-dev", msg.id);
      expect(a.type).toBe("ack");
      expect(a.inReplyTo).toBe(msg.id);
    });
  });

  describe("thread", () => {
    it("returns combined inbox + outbox for a task", () => {
      const createResult = createTeam({
        workspaceRoot: dir,
        teamId: "demo",
        name: "Demo",
        goal: "Test",
        agents: [TEST_AGENT_A, TEST_AGENT_B],
      });
      if (!createResult.ok) throw new Error("createTeam failed");

      sendMessage(dir, "demo", {
        from: "researcher",
        to: "backend-dev",
        type: "task",
        taskId: "task-1",
        body: { msg: 1 },
      });

      sendMessage(dir, "demo", {
        from: "backend-dev",
        to: "researcher",
        type: "progress",
        taskId: "task-1",
        body: { msg: 2 },
      });

      const threadA = thread(dir, "demo", "backend-dev", "task-1");
      expect(threadA).toHaveLength(2);
    });
  });
});
