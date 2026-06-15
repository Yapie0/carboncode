import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSlash } from "../src/cli/ui/slash/dispatch.js";
import {
  assignTask,
  checkProtocol,
  initCollab,
  listInboxMessages,
  listTasks,
  readInboxMessages,
  renderCollabConnectPrompt,
  respondToTask,
  updateTaskStatus,
} from "../src/collab/inbox.js";

describe("collab inbox protocol", () => {
  let dir: string;
  let inboxRoot: string;
  let taskFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carbon-collab-"));
    inboxRoot = join(dir, ".carboncode", "collab");
    taskFile = join(dir, "task.md");
    writeFileSync(taskFile, "# Verify video call\n\nRun the WeChat demo smoke path.\n", "utf8");
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("assigns a task, writes audit files, and delivers an unread worker message", () => {
    const task = assignTask({
      inboxRoot,
      to: "cccode",
      file: taskFile,
      workspace: "dev/wechat",
      writeScope: ["dev/wechat/client/src"],
      verification: ["npm run build"],
    });

    expect(task.title).toBe("Verify video call");
    expect(task.status).toBe("assigned");
    expect(listTasks(inboxRoot)).toHaveLength(1);
    expect(readFileSync(join(inboxRoot, "tasks", `${task.id}.md`), "utf8")).toContain(
      "Run the WeChat demo smoke path.",
    );

    const messages = listInboxMessages("cccode", inboxRoot);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      taskId: task.id,
      from: "carboncode",
      to: "cccode",
      type: "task_assigned",
      read: false,
    });
    expect(readFileSync(join(inboxRoot, "agents", "carboncode", "outbox.jsonl"), "utf8")).toContain(
      task.id,
    );
  });

  it("marks unread messages as read when the inbox is read", () => {
    const task = assignTask({ inboxRoot, to: "cccode", file: taskFile });

    const unread = readInboxMessages("cccode", { inboxRoot });
    expect(unread).toHaveLength(1);
    expect(unread[0]?.taskId).toBe(task.id);

    expect(readInboxMessages("cccode", { inboxRoot })).toEqual([]);
    expect(listInboxMessages("cccode", inboxRoot)[0]?.read).toBe(true);
  });

  it("responds to a task and can update task status", () => {
    const task = assignTask({ inboxRoot, to: "cccode", file: taskFile });
    const updated = updateTaskStatus(task.id, "running", inboxRoot);
    expect(updated.status).toBe("running");

    const response = respondToTask({
      inboxRoot,
      taskId: task.id,
      approve: true,
      requestId: "perm-1",
      note: "run the narrow build",
    });

    expect(response).toMatchObject({
      taskId: task.id,
      to: "cccode",
      type: "permission_response",
      body: { requestId: "perm-1", decision: "approved", note: "run the narrow build" },
    });
    expect(listInboxMessages("cccode", inboxRoot)).toHaveLength(2);
  });

  it("initializes protocol.md and detects external protocol edits", () => {
    const ok = initCollab({ collabRoot: inboxRoot, agent: "cccode" });
    expect(ok.ok).toBe(true);
    expect(readFileSync(join(inboxRoot, "protocol.md"), "utf8")).toContain(
      "Carbon Code Collaboration Protocol",
    );

    writeFileSync(join(inboxRoot, "protocol.md"), "# tampered\n", "utf8");
    const check = checkProtocol(inboxRoot);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("protocol hash mismatch");
  });

  it("handles /collab as a code-mode command", () => {
    const result = handleSlash("collab", ["carbon-main"], {} as never, { collabRoot: inboxRoot });
    const promptPath = join(inboxRoot, "connect-prompt.md");

    expect(result.info).toContain("collab protocol ready");
    expect(result.info).toContain(`prompt: ${promptPath}`);
    expect(result.info).toContain("Copy the prompt file to Codex");
    expect(result.info).not.toContain("Carbon Code agent name: carbon-main");
    expect(readFileSync(promptPath, "utf8")).toContain("Carbon Code agent name: carbon-main");
    expect(checkProtocol(inboxRoot).ok).toBe(true);
  });

  it("prints generic background collaboration instructions in the connect prompt", () => {
    const prompt = renderCollabConnectPrompt("carbon-main", inboxRoot);
    expect(prompt).toContain(
      "If your agent environment supports background tasks, hooks, automations, reminders, or scheduled continuations",
    );
    expect(prompt).toContain(
      "Schedule: every 2 minutes while collaboration is active, or the closest supported interval.",
    );
    expect(prompt).toContain(
      `carboncode collab inbox read --agent <your-agent-name> --root "${inboxRoot}" --json`,
    );
    expect(prompt).toContain("Do not read Carbon Code's outbox directly");
    expect(prompt).toContain(".carboncode/collab/agents/<your-agent-name>/inbox.jsonl");
  });

  it("handles /collab outside code mode when the session provides a collaboration root", () => {
    const result = handleSlash("collab", ["cccode"], {} as never, { collabRoot: inboxRoot });
    const promptPath = join(inboxRoot, "connect-prompt.md");

    expect(result.info).toContain("collab protocol ready");
    expect(result.info).toContain(`prompt: ${promptPath}`);
    expect(readFileSync(promptPath, "utf8")).toContain("Carbon Code agent name: cccode");
    expect(checkProtocol(inboxRoot).ok).toBe(true);
  });

  it("rejects /collab when no session collaboration root is available", () => {
    const result = handleSlash("collab", [], {} as never, {});
    expect(result.info).toContain("needs a collaboration root");
  });
});
