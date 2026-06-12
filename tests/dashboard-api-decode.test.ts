import { describe, expect, it } from "vitest";
import { handleFileRead } from "../src/server/api/file-read.js";
import { handleSessions } from "../src/server/api/sessions.js";
import type { DashboardContext } from "../src/server/context.js";

const CTX: DashboardContext = {
  mode: "standalone",
  configPath: "config.json",
  usageLogPath: "usage.jsonl",
  getCurrentCwd: () => process.cwd(),
};

describe("dashboard API URL decoding", () => {
  it("returns 400 for malformed file-read path encoding", async () => {
    const result = await handleFileRead("GET", ["%E0%A4%A"], "", CTX);

    expect(result).toEqual({
      status: 400,
      body: { error: "invalid file path encoding" },
    });
  });

  it("returns 400 for malformed session name encoding", async () => {
    const result = await handleSessions("GET", ["%E0%A4%A"], "", CTX);

    expect(result).toEqual({
      status: 400,
      body: { error: "invalid session name encoding" },
    });
  });
});
