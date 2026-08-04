import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSlash } from "../src/cli/ui/slash/dispatch.js";
import { readConfig } from "../src/config.js";

describe("/multi-agent slash handler", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "carbon-multi-agent-slash-"));
    configPath = join(tmp, "config.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("opens the masked provider setup inside the TUI", () => {
    const result = handleSlash("multi-agent", ["setup"], {} as never, { configPath });

    expect(result).toEqual({ openModelSetup: {} });
  });

  it("enables an explicit set of candidates in the user config", () => {
    const result = handleSlash(
      "multi-agent",
      ["enable", "deepseek-pro", "openai-luna"],
      {} as never,
      { configPath },
    );

    expect(result.info).toContain("deepseek-pro, openai-luna");
    expect(readConfig(configPath).experimental?.multiAgent).toMatchObject({
      enabled: true,
      candidateIds: ["deepseek-pro", "openai-luna"],
    });
  });

  it("explains that run needs an active code-mode runtime", () => {
    const result = handleSlash("multi-agent", ["run", "实现", "一个功能"], {} as never, {
      configPath,
    });

    expect(result.info).toMatch(/code 模式/);
  });

  it("routes a task to the active TUI multi-agent runner", () => {
    const runMultiAgentTask = vi.fn(() => "已开始四阶段执行");
    const result = handleSlash("multiagent", ["run", "实现", "并测试", "功能"], {} as never, {
      configPath,
      runMultiAgentTask,
    });

    expect(runMultiAgentTask).toHaveBeenCalledWith("实现 并测试 功能");
    expect(result.info).toBe("已开始四阶段执行");
  });
});
