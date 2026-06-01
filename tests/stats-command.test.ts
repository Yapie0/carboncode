import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { statsCommand } from "../src/cli/commands/stats.js";

describe("statsCommand", () => {
  it("stops after reporting a missing transcript path", () => {
    const missing = join("tmp", "missing-transcript.jsonl");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    expect(() => statsCommand({ transcript: missing })).not.toThrow();

    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      `no such transcript: ${missing}`,
    );

    err.mockRestore();
    exit.mockRestore();
  });
});
