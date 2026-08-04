import { describe, expect, it } from "vitest";
import { selectCodeMcpToolProfile } from "../src/mcp/tool-profile.js";

describe("selectCodeMcpToolProfile", () => {
  const specs = [
    "filesystem=npx -y @modelcontextprotocol/server-filesystem C:\\repo",
    "memory=npx -y @modelcontextprotocol/server-memory",
    "github=npx -y @modelcontextprotocol/server-github",
    "playwright=npx -y @playwright/mcp",
    "everything=npx -y @modelcontextprotocol/server-everything",
    "MiddlewaveHub=node cli.js mwh mcp-server",
  ];

  it("drops code-mode filesystem duplication and the MCP test server by default", () => {
    const selected = selectCodeMcpToolProfile(specs);

    expect(selected.active).toEqual([specs[1], specs[2], specs[3], specs[5]]);
    expect(selected.skipped).toEqual(["filesystem", "everything"]);
  });

  it("detects unnamed official redundant servers by package", () => {
    const selected = selectCodeMcpToolProfile([
      "npx -y @modelcontextprotocol/server-filesystem C:\\repo",
      "npx -y @modelcontextprotocol/server-everything",
    ]);

    expect(selected.active).toEqual([]);
    expect(selected.skipped).toEqual(["filesystem", "everything"]);
  });

  it("keeps all configured servers in the full profile", () => {
    expect(selectCodeMcpToolProfile(specs, "full")).toEqual({
      active: specs,
      skipped: [],
    });
  });

  it("keeps invalid specs so the regular MCP error path remains visible", () => {
    expect(selectCodeMcpToolProfile(["bad="])).toEqual({
      active: ["bad="],
      skipped: [],
    });
  });
});
