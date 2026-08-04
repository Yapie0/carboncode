import { afterEach, describe, expect, it } from "vitest";
import { formatMcpStartupSummary } from "../src/cli/ui/mcp-startup-summary.js";
import { setLanguageRuntime } from "../src/i18n/index.js";

afterEach(() => {
  setLanguageRuntime("EN");
});

describe("formatMcpStartupSummary", () => {
  it("renders one compact success row", () => {
    expect(
      formatMcpStartupSummary({
        total: 3,
        connected: 3,
        tools: 18,
        nativeTools: 37,
        activeTools: 55,
        maxTools: 128,
        disabled: 0,
        failed: 0,
      }),
    ).toBe(
      "MCP ready · 3/3 connected · 18 tools · details: /mcp · request tools: 37 native + 18 MCP = 55/128",
    );
  });

  it("keeps disabled and failed counts visible without per-server success rows", () => {
    expect(
      formatMcpStartupSummary({
        total: 4,
        connected: 2,
        tools: 9,
        nativeTools: 37,
        activeTools: 46,
        maxTools: 128,
        disabled: 1,
        failed: 1,
      }),
    ).toBe(
      "MCP ready · 2/4 connected · 9 tools · 1 disabled · 1 failed · details: /mcp · request tools: 37 native + 9 MCP = 46/128",
    );
  });

  it("uses the Chinese-first runtime copy", () => {
    setLanguageRuntime("zh-CN");
    expect(
      formatMcpStartupSummary({
        total: 2,
        connected: 2,
        tools: 7,
        nativeTools: 37,
        activeTools: 44,
        maxTools: 128,
        disabled: 0,
        failed: 0,
      }),
    ).toBe(
      "MCP 就绪 · 已连接 2/2 · 7 个工具 · 详情：/mcp · 请求工具：37 个原生 + 7 个 MCP = 44/128",
    );
  });
});
