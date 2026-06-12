import { describe, expect, it } from "vitest";
import { parseMcpSpec } from "../src/mcp/spec.js";
import { appendBuiltinMwhMcpSpec, buildBuiltinMwhMcpSpec } from "../src/mwh/mcp-spec.js";

describe("built-in MWH MCP spec", () => {
  it("builds a named stdio MCP spec for the workspace root", () => {
    const raw = buildBuiltinMwhMcpSpec("C:\\repo", "C:\\repo\\src\\cli\\index.ts");
    const parsed = parseMcpSpec(raw);
    expect(parsed.transport).toBe("stdio");
    expect(parsed.name).toBe("MiddlewaveHub");
    if (parsed.transport !== "stdio") throw new Error("expected stdio");
    expect(parsed.command).toBe(process.execPath);
    expect(parsed.args).toContain("--import");
    expect(parsed.args).toContain("tsx");
    expect(parsed.args).toContain("mcp-server");
    expect(parsed.args).not.toContain("--root");
    expect(parsed.args).not.toContain("C:\\repo");
  });

  it("resolves the Carbon Code CLI entrypoint without relying on process argv", () => {
    const raw = buildBuiltinMwhMcpSpec("C:\\repo");
    const parsed = parseMcpSpec(raw);
    expect(parsed.name).toBe("MiddlewaveHub");
    if (parsed.transport !== "stdio") throw new Error("expected stdio");
    expect(parsed.args.join(" ")).toContain("cli");
    expect(parsed.args.join(" ")).toContain("index.");
    expect(parsed.args).not.toContain("-");
  });

  it("appends MWH unless already configured or disabled", () => {
    expect(
      appendBuiltinMwhMcpSpec(["fs=cmd"], {}, "C:\\repo", "C:\\repo\\dist\\cli\\index.js"),
    ).toHaveLength(2);
    expect(
      appendBuiltinMwhMcpSpec(["mwh=cmd"], {}, "C:\\repo", "C:\\repo\\dist\\cli\\index.js"),
    ).toEqual(["mwh=cmd"]);
    expect(
      appendBuiltinMwhMcpSpec(
        ["MiddlewaveHub=cmd"],
        {},
        "C:\\repo",
        "C:\\repo\\dist\\cli\\index.js",
      ),
    ).toEqual(["MiddlewaveHub=cmd"]);
    expect(
      appendBuiltinMwhMcpSpec(
        ["fs=cmd"],
        { mcpDisabled: ["mwh"] },
        "C:\\repo",
        "C:\\repo\\dist\\cli\\index.js",
      ),
    ).toEqual(["fs=cmd"]);
    expect(
      appendBuiltinMwhMcpSpec(
        ["fs=cmd"],
        { mcpDisabled: ["MiddlewaveHub"] },
        "C:\\repo",
        "C:\\repo\\dist\\cli\\index.js",
      ),
    ).toEqual(["fs=cmd"]);
  });
});
