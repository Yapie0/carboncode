import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chatCommand = vi.fn(async () => {});
const shutdown = vi.fn();

vi.mock("../src/cli/commands/chat.js", () => ({
  chatCommand,
}));

vi.mock("../src/code/setup.js", () => ({
  buildCodeToolset: vi.fn(async () => ({
    tools: { size: 35 },
    jobs: { shutdown },
    registerRooted: vi.fn(),
    reBootstrapSemantic: vi.fn(),
    semantic: { enabled: false },
  })),
}));

vi.mock("../src/code/prompt.js", () => ({
  codeSystemPrompt: vi.fn(() => "system prompt"),
}));

vi.mock("../src/config.js", () => ({
  loadApiKey: vi.fn(() => undefined),
  loadMcpToolProfile: vi.fn(() => "auto"),
  loadModel: vi.fn(() => undefined),
  loadPreset: vi.fn(() => "auto"),
  loadThinkingMode: vi.fn(() => "auto"),
  loadOutputStyle: vi.fn(() => "default"),
  normalizeMcpConfig: vi.fn(() => []),
  readConfig: vi.fn(() => ({})),
}));

vi.mock("../src/env.js", () => ({
  loadDotenv: vi.fn(),
}));

vi.mock("../src/memory/project.js", () => ({
  detectForeignAgentPlatform: vi.fn(() => null),
}));

describe("code command startup surface", () => {
  const originalWrite = process.stderr.write;
  let stderr = "";

  beforeEach(() => {
    stderr = "";
    chatCommand.mockClear();
    shutdown.mockClear();
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("does not print a root/session/tools banner before the TUI mounts", async () => {
    const { codeCommand } = await import("../src/cli/commands/code.js");

    await codeCommand({ dir: "/tmp/repo", noSession: true, noDashboard: true });

    expect(chatCommand).toHaveBeenCalledOnce();
    expect(stderr).not.toContain("carboncode code");
    expect(stderr).not.toContain("rooted at");
    expect(stderr).not.toContain("根目录");
    expect(stderr).not.toContain("native tool");
    expect(stderr).not.toContain("原生工具");
  });
});
