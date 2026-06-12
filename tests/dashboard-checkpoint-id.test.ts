import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleCheckpointDelete } from "../src/server/api/checkpoint-delete.js";
import { handleCheckpointRestore } from "../src/server/api/checkpoint-restore.js";
import type { DashboardContext } from "../src/server/context.js";

let root: string;

function ctx(): DashboardContext {
  return {
    mode: "standalone",
    configPath: join(root, ".carboncode", "config.json"),
    usageLogPath: join(root, ".carboncode", "usage.jsonl"),
    getCurrentCwd: () => root,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "carboncode-checkpoint-id-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("dashboard checkpoint id validation", () => {
  it("rejects non-string restore ids", async () => {
    const result = await handleCheckpointRestore("POST", [], JSON.stringify({ id: 123 }), ctx());

    expect(result).toEqual({ status: 400, body: { error: "missing id" } });
  });

  it("rejects non-string delete ids", async () => {
    const result = await handleCheckpointDelete("POST", [], JSON.stringify({ id: ["cp"] }), ctx());

    expect(result).toEqual({ status: 400, body: { error: "missing id" } });
  });
});
