import { describe, expect, it } from "vitest";
import { runCodexParityHarness } from "./helpers/codex-parity-harness.js";

describe("Codex parity real-task harness", () => {
  it("covers inspect, failing test, patch, passing test, and concise summary", async () => {
    const result = await runCodexParityHarness();

    expect(result.firstTest.exitCode).not.toBe(0);
    expect(result.firstTest.output).toContain("discount");
    expect(result.patchOutput).toMatch(/apply_patch: applied 1 file/);
    expect(result.secondTest.exitCode).toBe(0);
    expect(result.changedFiles).toEqual(["src/pricing.js"]);
    expect(result.summary).toBe("已修复折扣计算，并通过 npm test。");
    expect(result.transcript.map((entry) => entry.kind)).toEqual([
      "inspect",
      "test-failed",
      "patch",
      "test-passed",
      "summary",
    ]);
  }, 30_000);
});
