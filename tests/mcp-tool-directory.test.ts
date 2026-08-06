import { describe, expect, it, vi } from "vitest";
import type { McpClient } from "../src/mcp/client.js";
import { bridgeMcpTools } from "../src/mcp/registry.js";
import { MCP_DIRECTORY_TOOL_NAME, McpToolDirectory } from "../src/mcp/tool-directory.js";
import type { McpTool } from "../src/mcp/types.js";
import { ToolRegistry } from "../src/tools.js";

function makeTools(count: number): McpTool[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `tool_${index}`,
    description: `Perform catalog operation ${index}`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  }));
}

describe("McpToolDirectory", () => {
  it("keeps a large MCP catalog callable while exposing only one schema", async () => {
    const registry = new ToolRegistry();
    for (let index = 0; index < 36; index++) {
      registry.register({ name: `native_${index}`, fn: () => "ok" });
    }
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => ({
      content: [{ type: "text" as const, text: JSON.stringify({ name, args }) }],
    }));
    const client = {
      listTools: vi.fn(async () => ({ tools: makeTools(132) })),
      callTool,
    } as unknown as McpClient;
    const directory = new McpToolDirectory(registry);

    const bridge = await bridgeMcpTools(client, {
      registry,
      namePrefix: "catalog_",
      serverName: "catalog",
      maxTools: 128,
      directory,
    });

    expect(bridge.registeredNames).toHaveLength(132);
    expect(bridge.exposedNames).toEqual([MCP_DIRECTORY_TOOL_NAME]);
    expect(bridge.skipped).toEqual([]);
    expect(registry.size).toBe(36 + 132 + 1);
    expect(registry.visibleSize).toBe(37);
    expect(registry.specs()).toHaveLength(37);
    expect(registry.specs().map((spec) => spec.function.name)).not.toContain("catalog_tool_0");

    const tree = JSON.parse(
      await registry.dispatch(MCP_DIRECTORY_TOOL_NAME, { action: "list" }),
    ) as { total_tools: number; servers: Array<{ server: string; count: number }> };
    expect(tree.total_tools).toBe(132);
    expect(tree.servers).toEqual([expect.objectContaining({ server: "catalog", count: 132 })]);

    const search = JSON.parse(
      await registry.dispatch(MCP_DIRECTORY_TOOL_NAME, {
        action: "search",
        query: "tool_131",
      }),
    ) as { tools: Array<{ name: string }> };
    expect(search.tools[0]?.name).toBe("catalog_tool_131");

    const description = JSON.parse(
      await registry.dispatch(MCP_DIRECTORY_TOOL_NAME, {
        action: "describe",
        name: "catalog_tool_131",
      }),
    ) as { parameters: { required: string[] } };
    expect(description.parameters.required).toEqual(["value"]);

    const called = await registry.dispatch(MCP_DIRECTORY_TOOL_NAME, {
      action: "call",
      name: "catalog_tool_131",
      arguments: { value: "hello" },
    });
    expect(called).toContain("MCP tool catalog_tool_131 result");
    expect(callTool).toHaveBeenCalledWith(
      "tool_131",
      { value: "hello" },
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("allows discovery but blocks directory dispatch in plan mode", async () => {
    const registry = new ToolRegistry();
    const directory = new McpToolDirectory(registry);
    const client = {
      listTools: vi.fn(async () => ({ tools: makeTools(1) })),
      callTool: vi.fn(async () => ({ content: [{ type: "text" as const, text: "called" }] })),
    } as unknown as McpClient;
    await bridgeMcpTools(client, { registry, directory, serverName: "catalog" });
    registry.setPlanMode(true);

    const listed = await registry.dispatch(MCP_DIRECTORY_TOOL_NAME, { action: "list" });
    expect(listed).toContain("catalog");

    const called = await registry.dispatch(MCP_DIRECTORY_TOOL_NAME, {
      action: "call",
      name: "tool_0",
      arguments: { value: "x" },
    });
    expect(called).toContain("unavailable in plan mode");
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it("removes the directory tool after the last catalog entry is unregistered", async () => {
    const registry = new ToolRegistry();
    const directory = new McpToolDirectory(registry);
    const client = {
      listTools: vi.fn(async () => ({ tools: makeTools(2) })),
      callTool: vi.fn(),
    } as unknown as McpClient;
    const bridge = await bridgeMcpTools(client, { registry, directory, serverName: "catalog" });

    for (const name of bridge.registeredNames) directory.unregister(name);
    expect(directory.detachIfEmpty()).toBe(true);
    expect(registry.has(MCP_DIRECTORY_TOOL_NAME)).toBe(false);
    expect(registry.specs()).toEqual([]);
  });
});
