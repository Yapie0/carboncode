/** `startDashboardServer({ host, token })` — LAN exposure + stable token (#968). */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type DashboardServerHandle, startDashboardServer } from "../src/server/index.js";

const TOKEN = "stable-pinned-token-1234567890";

function ctx(dir: string) {
  return {
    mode: "standalone" as const,
    configPath: join(dir, "config.json"),
    usageLogPath: join(dir, "usage.jsonl"),
  };
}

function isAscii(text: string): boolean {
  return [...text].every((ch) => ch.charCodeAt(0) <= 0x7f);
}

describe("startDashboardServer host + token (#968)", () => {
  let dir: string;
  let handle: DashboardServerHandle | undefined;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reasonix-dashhost-"));
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    writeSpy.mockRestore();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to 127.0.0.1 when no host is given and emits no LAN warning", async () => {
    handle = await startDashboardServer(ctx(dir), { token: TOKEN });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
    const warnings = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("Dashboard bound"));
    expect(warnings).toEqual([]);
  });

  it("reuses opts.token verbatim instead of minting a fresh one", async () => {
    handle = await startDashboardServer(ctx(dir), { token: TOKEN });
    expect(handle.token).toBe(TOKEN);
    expect(handle.url).toContain(`token=${TOKEN}`);
  });

  it("mints a shorter ephemeral token so the printed localhost URL fits typical terminals", async () => {
    handle = await startDashboardServer(ctx(dir));
    expect(handle.token).toMatch(/^[a-f0-9]{32}$/);
    expect(handle.url).toContain(`token=${handle.token}`);
  });

  it("serves unauthorized shell responses as utf-8 plain text", async () => {
    handle = await startDashboardServer(ctx(dir), { token: TOKEN });
    const url = new URL(handle.url);
    url.search = "";

    const res = await fetch(url);

    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      "unauthorized - open the URL printed by /dashboard, including ?token=...",
    );
  });

  it("binds 0.0.0.0 when requested and prints a stderr warning", async () => {
    handle = await startDashboardServer(ctx(dir), { token: TOKEN, host: "0.0.0.0" });
    expect(handle.url).toMatch(/^http:\/\/0\.0\.0\.0:\d+\/\?token=/);
    const warnings = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("Dashboard bound"));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/^WARNING:/);
    expect(warnings[0]).toContain("non-loopback");
    expect(warnings[0]).toContain("token");
    expect(isAscii(warnings[0] ?? "")).toBe(true);
  });

  it("does not warn for ::1 or localhost (still loopback)", async () => {
    handle = await startDashboardServer(ctx(dir), { token: TOKEN, host: "localhost" });
    const warnings = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("Dashboard bound"));
    expect(warnings).toEqual([]);
  });
});
