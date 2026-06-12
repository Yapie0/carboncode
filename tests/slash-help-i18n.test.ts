import { describe, expect, it } from "vitest";
import { SLASH_COMMANDS } from "../src/cli/ui/slash/commands.js";
import { EN } from "../src/i18n/EN.ts";
import { zhCN } from "../src/i18n/zh-CN.ts";

describe("slash help i18n coverage", () => {
  it("every registered slash command has an EN description key", () => {
    const missing = SLASH_COMMANDS.filter((c) => !EN.slash[c.cmd]?.description);
    expect(missing.map((c) => c.cmd)).toEqual([]);
  });

  it("every registered slash command has a zh-CN description key", () => {
    const missing = SLASH_COMMANDS.filter((c) => !zhCN.slash[c.cmd]?.description);
    expect(missing.map((c) => c.cmd)).toEqual([]);
  });

  it("keeps /memory help aligned with the current project and user memory files", () => {
    expect(EN.slash.memory.description).toContain("AGENTS.md/CARBON.md");
    expect(EN.slash.memory.description).toContain("~/.carboncode/memory");
    expect(EN.slash.memory.description).not.toContain("~/.carboncode/CARBON.md");

    expect(zhCN.slash.memory.description).toContain("AGENTS.md/CARBON.md");
    expect(zhCN.slash.memory.description).toContain("~/.carboncode/memory");
    expect(zhCN.slash.memory.description).not.toContain("~/.carboncode/CARBON.md");
  });

  it("localizes the zh-CN MCP registry fallback wording", () => {
    expect(zhCN.ui.mcpListDescription).toContain("Smithery 第三方目录");
    expect(zhCN.ui.mcpListDescription).toContain("本地备选");
    expect(zhCN.ui.mcpListDescription).not.toContain("fallback");
  });
});
