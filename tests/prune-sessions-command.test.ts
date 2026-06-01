import { describe, expect, it, vi } from "vitest";
import { pruneSessionsCommand } from "../src/cli/commands/prune-sessions.js";

describe("pruneSessionsCommand", () => {
  it("rejects fractional --days values", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    pruneSessionsCommand({ days: 1.5, dryRun: true });

    expect(err).toHaveBeenCalledWith("--days must be a positive integer (got 1.5).");
    expect(log).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);

    err.mockRestore();
    log.mockRestore();
    exit.mockRestore();
  });
});
