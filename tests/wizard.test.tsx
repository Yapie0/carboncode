/** Wizard data-transform — buildSpec → parseMcpSpec round-trip; bugs here = silent config-save failures. */

import { render } from "ink-testing-library";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Wizard,
  buildSpec,
  defaultArgFor,
  mcpArgsNoteFor,
  mcpArgsSummaryFor,
  mcpItems,
  placeholderFor,
  presetItems,
  validateDeepSeekApiKey,
} from "../src/cli/ui/Wizard.js";
import { setLanguageRuntime } from "../src/i18n/index.js";
import { parseMcpSpec } from "../src/mcp/spec.js";

async function nextFrame(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Wizard.buildSpec → parseMcpSpec round-trip", () => {
  it("builds a filesystem spec the parser accepts", () => {
    const spec = buildSpec("filesystem", { filesystem: "/tmp/safe" });
    expect(spec).toBe("filesystem=npx -y @modelcontextprotocol/server-filesystem /tmp/safe");
    const parsed = parseMcpSpec(spec);
    if (parsed.transport !== "stdio") throw new Error("expected stdio");
    expect(parsed.name).toBe("filesystem");
    expect(parsed.command).toBe("npx");
    expect(parsed.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/tmp/safe"]);
  });

  it("omits the trailing userArg when the catalog entry needs none", () => {
    const spec = buildSpec("memory", {});
    expect(spec).toBe("memory=npx -y @modelcontextprotocol/server-memory");
    const parsed = parseMcpSpec(spec);
    expect(parsed.name).toBe("memory");
  });

  it("quotes directory paths that contain spaces", () => {
    const spec = buildSpec("filesystem", { filesystem: "/Users/me/My Documents" });
    // Inside quotes, the parser should re-join the path as a single arg.
    const parsed = parseMcpSpec(spec);
    if (parsed.transport !== "stdio") throw new Error("expected stdio");
    expect(parsed.args.at(-1)).toBe("/Users/me/My Documents");
  });

  it("returns the name bare when the catalog entry is unknown", () => {
    // Defensive: if someone manually edits config.json and the wizard
    // sees an unfamiliar name on re-run, we degrade gracefully rather
    // than throwing.
    expect(buildSpec("not-in-catalog", {})).toBe("not-in-catalog");
  });
});

describe("Wizard — first-launch language picker", () => {
  afterEach(() => {
    setLanguageRuntime("EN");
  });

  it("shows the language step first, with both supported languages", () => {
    const { lastFrame, unmount } = render(<Wizard onComplete={() => {}} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("Choose your language");
    expect(out).toContain("English");
    expect(out).toContain("简体中文");
    unmount();
  });

  it("shows the title in zh-CN when runtime language is set to zh-CN", () => {
    setLanguageRuntime("zh-CN");
    const { lastFrame, unmount } = render(<Wizard onComplete={() => {}} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("选择语言");
    expect(out).toContain("English");
    expect(out).toContain("简体中文");
    expect(out).toContain("（已检测）");
    expect(out).not.toContain("(detected)");
    unmount();
  });

  it("allows setup steps to go back with Ctrl+B and Backspace", async () => {
    const { lastFrame, stdin, unmount } = render(
      <Wizard existingApiKey="sk-valid1234567890" onComplete={() => {}} />,
    );

    stdin.write("\r");
    await nextFrame();
    expect(lastFrame() ?? "").toContain("Choose a theme");

    stdin.write("\r");
    await nextFrame();
    expect(lastFrame() ?? "").toContain("Pick a preset");

    stdin.write("\x02");
    await nextFrame();
    expect(lastFrame() ?? "").toContain("Choose a theme");

    stdin.write("\x7f");
    await nextFrame();
    expect(lastFrame() ?? "").toContain("Choose your language");

    unmount();
  });
});

describe("Wizard — localized preset descriptions", () => {
  afterEach(() => {
    setLanguageRuntime("EN");
  });

  it("shows preset descriptions in zh-CN when runtime language is Simplified Chinese", () => {
    setLanguageRuntime("zh-CN");
    const items = presetItems();

    expect(items.map((item) => item.label)).toEqual([
      "auto — 困难轮次从 flash 升级到 pro",
      "flash — 始终使用 v4-flash",
      "pro — 始终使用 v4-pro",
    ]);
    expect(items.map((item) => item.hint).join("\n")).not.toContain("hard turns");
  });
});

describe("Wizard — localized MCP catalog descriptions", () => {
  afterEach(() => {
    setLanguageRuntime("EN");
  });

  it("shows MCP catalog summaries and notes in zh-CN", () => {
    setLanguageRuntime("zh-CN");
    const items = mcpItems();
    const mwh = items.find((item) => item.value === "mwh");
    const filesystem = items.find((item) => item.value === "filesystem");
    const github = items.find((item) => item.value === "github");
    expect(mwh?.hint).not.toContain("<dir>");

    expect(filesystem?.hint).toContain("在沙箱目录内读取、写入和搜索文件");
    expect(filesystem?.hint).toContain("需要你提供 <dir>");
    expect(filesystem?.hint).toContain("服务器会拒绝访问目录外的路径");
    expect(github?.hint).toContain("读取 issues、PR 和代码搜索");
    expect(github?.hint).toContain("启动前请在环境变量中设置 GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(items.map((item) => item.hint).join("\n")).not.toContain(
      "read/write/search files inside a sandboxed directory",
    );
  });
});

describe("Wizard MCP argument placeholders", () => {
  afterEach(() => {
    setLanguageRuntime("EN");
  });

  it("localizes the filesystem argument step copy in zh-CN", () => {
    setLanguageRuntime("zh-CN");
    const entry = {
      name: "filesystem",
      summary: "read/write/search files inside a sandboxed directory",
      package: "@modelcontextprotocol/server-filesystem",
      command: "npx",
      args: [],
      userArgs: "<dir>",
      note: "the directory is a hard sandbox — the server refuses access outside it",
    };

    expect(mcpArgsSummaryFor(entry)).toContain("沙盒");
    expect(mcpArgsSummaryFor(entry)).not.toBe(entry.summary);
    expect(mcpArgsNoteFor(entry)).toContain("目录外");
    expect(mcpArgsNoteFor(entry)).not.toBe(entry.note);
  });

  it("localizes filesystem and sqlite placeholders in zh-CN", () => {
    setLanguageRuntime("zh-CN");

    const filesystem = placeholderFor({
      name: "filesystem",
      command: "npx",
      args: [],
      userArgs: "<dir>",
    });
    const sqlite = placeholderFor({ name: "sqlite", command: "npx", args: [], userArgs: "<db>" });

    expect(defaultArgFor({ name: "filesystem", command: "npx", args: [], userArgs: "<dir>" })).toBe(
      process.cwd(),
    );
    expect(filesystem).toContain(process.cwd());
    expect(filesystem).not.toContain("例如");
    expect(sqlite).toContain("./notes.sqlite");
    expect(sqlite).not.toBe("e.g. ./notes.sqlite");
  });

  it("keeps filesystem and sqlite placeholders in EN", () => {
    expect(
      placeholderFor({ name: "filesystem", command: "npx", args: [], userArgs: "<dir>" }),
    ).toBe(`default: ${process.cwd()}`);
    expect(placeholderFor({ name: "sqlite", command: "npx", args: [], userArgs: "<db>" })).toBe(
      "e.g. ./notes.sqlite",
    );
  });
});

describe("Wizard API-key validation", () => {
  it("accepts a key when DeepSeek auth check succeeds", async () => {
    const fetcher = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });

    await expect(
      validateDeepSeekApiKey("sk-valid1234567890", { fetch: fetcher as typeof fetch }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a key when DeepSeek returns 401", async () => {
    const fetcher = async () => new Response("unauthorized", { status: 401 });

    await expect(
      validateDeepSeekApiKey("sk-invalid12345678", { fetch: fetcher as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("keeps setup on the API-key step when validation cannot complete", async () => {
    const fetcher = async () => new Response("maintenance", { status: 503 });

    await expect(
      validateDeepSeekApiKey("sk-valid1234567890", { fetch: fetcher as typeof fetch }),
    ).resolves.toMatchObject({ ok: false, reason: "failed", message: "HTTP 503" });
  });

  it("hits /models, not /user/balance — third-party endpoints (DashScope etc.) accept it", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };

    await expect(
      validateDeepSeekApiKey("sk-valid1234567890", {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        fetch: fetcher as typeof fetch,
      }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual(["https://dashscope.aliyuncs.com/compatible-mode/v1/models"]);
  });
});
