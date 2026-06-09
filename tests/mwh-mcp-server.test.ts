import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpClient } from "../src/mcp/client.js";
import { StdioTransport } from "../src/mcp/stdio.js";

const NODE_CMD = process.execPath;

describe("MWH MCP server", () => {
  let projectRoot: string;
  let client: McpClient | null = null;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "carbon-mwh-mcp-"));
  });

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("exposes reusable middleware CRUD tools over MCP", async () => {
    client = new McpClient({
      transport: new StdioTransport({
        command: NODE_CMD,
        args: ["--import", "tsx", "src/cli/index.ts", "mwh", "mcp-server", "--root", projectRoot],
        shell: false,
      }),
      requestTimeoutMs: 15_000,
    });
    const info = await client.initialize();
    expect(info.serverInfo.name).toBe("carboncode-mwh");
    expect(info.capabilities.tools).toBeDefined();
    expect(info.capabilities.resources).toBeDefined();

    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toContain("mwh_read_module");
    expect(tools).toContain("mwh_create_module");
    expect(tools).toContain("mwh_delete_module");

    const read = await client.callTool("mwh_read_module", { id: "video-call-webrtc" });
    expect(text(read)).toContain("CallProvider");

    const create = await client.callTool("mwh_create_module", {
      id: "demo-module",
      title: "Demo Module",
      summary: "Demo reusable middleware module",
      version: "0.1.0",
      tags: ["demo"],
      content: "# Demo Module\n",
    });
    expect(text(create)).toContain("demo-module");

    const deleteWithoutConfirm = await client.callTool("mwh_delete_module", { id: "demo-module" });
    expect(text(deleteWithoutConfirm)).toContain("confirm: true");

    const deleted = await client.callTool("mwh_delete_module", {
      id: "demo-module",
      confirm: true,
    });
    expect(text(deleted)).toContain("demo-module");
  }, 30_000);
});

function text(result: Awaited<ReturnType<McpClient["callTool"]>>): string {
  return result.content.map((block) => ("text" in block ? block.text : "")).join("\n");
}
