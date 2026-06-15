import { describe, expect, it } from "vitest";
import { formatCollabPrompt } from "../src/cli/ui/collab-prompt.js";
import type { CollabMessage } from "../src/collab/inbox.js";

function message(body: Record<string, unknown>): CollabMessage {
  return {
    id: "msg-1",
    taskId: "task-1",
    from: "codex",
    to: "carboncode",
    type: "task",
    createdAt: "2026-06-15T00:00:00.000Z",
    read: false,
    body,
  };
}

describe("formatCollabPrompt", () => {
  it("summarizes prompt-file messages without inlining the full prompt", () => {
    const longPrompt = "implement teams\n".repeat(500);
    const prompt = formatCollabPrompt(
      message({
        title: "Teams MVP",
        promptFile: ".carboncode/inbox/teams.md",
        prompt: longPrompt,
      }),
    );

    expect(prompt).toContain("From: codex");
    expect(prompt).toContain("promptFile: .carboncode/inbox/teams.md");
    expect(prompt).toContain(`prompt: omitted from TUI (${longPrompt.length} chars)`);
    expect(prompt).not.toContain(longPrompt.slice(0, 200));
  });

  it("caps direct prompt bodies when no prompt file is available", () => {
    const longPrompt = "x".repeat(5000);
    const prompt = formatCollabPrompt(message({ prompt: longPrompt }));

    expect(prompt).toContain("chars omitted");
    expect(prompt.length).toBeLessThan(3600);
  });
});
