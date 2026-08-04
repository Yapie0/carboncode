import { describe, expect, it, vi } from "vitest";
import { Usage } from "../src/client.js";
import type { MultiAgentCandidateConfig } from "../src/config.js";
import type { RoleAssignment } from "../src/multi-agent/benchmarks.js";
import { runMultiAgentWorkflow } from "../src/multi-agent/orchestrator.js";
import { ToolRegistry } from "../src/tools.js";
import type { SpawnSubagentOptions, SubagentResult } from "../src/tools/subagent.js";

const candidates: MultiAgentCandidateConfig[] = [
  { id: "designer", provider: "openai", model: "design-model" },
  { id: "builder", provider: "deepseek", model: "build-model" },
  { id: "tester", provider: "openai", model: "test-model" },
  { id: "reviewer", provider: "deepseek", model: "review-model" },
];

const assignments: RoleAssignment[] = [
  { role: "design", candidate: candidates[0]!, source: "override" },
  { role: "implementation", candidate: candidates[1]!, source: "override" },
  { role: "testing", candidate: candidates[2]!, source: "override" },
  { role: "acceptance", candidate: candidates[3]!, source: "override" },
];

function success(output: string): SubagentResult {
  return {
    success: true,
    output,
    turns: 1,
    toolIters: 0,
    elapsedMs: 5,
    costUsd: 0,
    model: "test-model",
    usage: new Usage(1, 1, 2),
  };
}

function fakeToolset() {
  const tools = new ToolRegistry();
  tools.register({
    name: "read_file",
    readOnly: true,
    fn: async () => "contents",
  });
  tools.register({
    name: "write_file",
    readOnly: false,
    fn: async () => "written",
  });
  const shutdown = vi.fn(async () => undefined);
  return {
    value: {
      tools,
      jobs: { shutdown },
      registerRooted: vi.fn(),
      addRoot: vi.fn(),
      listRoots: () => [],
      reBootstrapSemantic: vi.fn(async () => ({ enabled: false })),
      semantic: { enabled: false },
    },
    shutdown,
  };
}

describe("multi-agent orchestrator", () => {
  it("runs isolated role stages in order and passes prior artifacts forward", async () => {
    const calls: SpawnSubagentOptions[] = [];
    const toolset = fakeToolset();
    const onStageStart = vi.fn();
    const onStageComplete = vi.fn();
    const spawn = vi.fn(async (options: SpawnSubagentOptions) => {
      calls.push(options);
      return success(`${options.skillName} complete`);
    });

    const result = await runMultiAgentWorkflow({
      rootDir: "C:/workspace",
      task: "Implement the feature",
      config: {},
      candidates,
      benchmarks: [],
      assignments,
      clientFactory: (candidate) =>
        ({ providerId: candidate.provider }) as SpawnSubagentOptions["client"],
      buildToolset: vi.fn(async () => toolset.value) as never,
      spawn,
      onStageStart,
      onStageComplete,
    });

    expect(result.success).toBe(true);
    expect(calls.map((call) => call.skillName)).toEqual([
      "multi-agent:design",
      "multi-agent:implementation",
      "multi-agent:testing",
      "multi-agent:acceptance",
    ]);
    expect(calls[0]?.allowedTools).toEqual(["read_file"]);
    expect(calls[1]?.allowedTools).toBeUndefined();
    expect(calls[2]?.allowedTools).toBeUndefined();
    expect(calls[3]?.allowedTools).toEqual(["read_file"]);
    expect(calls[1]?.task).toContain("multi-agent:design complete");
    expect(calls[3]?.task).toContain("multi-agent:testing complete");
    expect(toolset.shutdown).toHaveBeenCalledOnce();
    expect(onStageStart).toHaveBeenCalledTimes(4);
    expect(onStageComplete).toHaveBeenCalledTimes(4);
  });

  it("stops at the first failed stage and still shuts down jobs", async () => {
    const toolset = fakeToolset();
    const spawn = vi.fn(async (options: SpawnSubagentOptions) => {
      if (options.skillName === "multi-agent:implementation") {
        return { ...success(""), success: false, error: "implementation failed" };
      }
      return success("ok");
    });

    const result = await runMultiAgentWorkflow({
      rootDir: "C:/workspace",
      task: "Implement the feature",
      config: {},
      candidates,
      benchmarks: [],
      assignments,
      clientFactory: (candidate) =>
        ({ providerId: candidate.provider }) as SpawnSubagentOptions["client"],
      buildToolset: vi.fn(async () => toolset.value) as never,
      spawn,
    });

    expect(result).toMatchObject({ success: false, failedRole: "implementation" });
    expect(result.stages).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(toolset.shutdown).toHaveBeenCalledOnce();
  });

  it("reuses a TUI tool runtime without shutting down its jobs", async () => {
    const toolset = fakeToolset();
    const sink = { current: vi.fn() };
    const spawn = vi.fn(async () => success("ok"));

    const result = await runMultiAgentWorkflow({
      rootDir: "C:/workspace",
      task: "Implement the feature",
      config: {},
      candidates,
      benchmarks: [],
      assignments,
      clientFactory: (candidate) =>
        ({ providerId: candidate.provider }) as SpawnSubagentOptions["client"],
      toolset: toolset.value as never,
      subagentSink: sink,
      spawn,
    });

    expect(result.success).toBe(true);
    expect(spawn.mock.calls[0]?.[0].sink).toBe(sink);
    expect(toolset.shutdown).not.toHaveBeenCalled();
  });
});
