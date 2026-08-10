import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingDiagnostics,
  flushDiagnostics,
  reportDiagnosticError,
} from "../src/diagnostics.js";

describe("diagnostics", () => {
  let dir: string;
  const originalDir = process.env.CARBONCODE_DIAGNOSTICS_DIR;
  const originalEnabled = process.env.CARBONCODE_DIAGNOSTICS;
  const originalEndpoint = process.env.CARBONCODE_DIAGNOSTICS_ENDPOINT;
  const originalDesktopVersion = process.env.CARBONCODE_DESKTOP_VERSION;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "carboncode-diagnostics-"));
    process.env.CARBONCODE_DIAGNOSTICS_DIR = dir;
    process.env.CARBONCODE_DIAGNOSTICS = "1";
    process.env.CARBONCODE_DIAGNOSTICS_ENDPOINT = "https://collector.example/events";
    clearPendingDiagnostics();
  });

  afterEach(() => {
    clearPendingDiagnostics();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
    restoreEnv("CARBONCODE_DIAGNOSTICS_DIR", originalDir);
    restoreEnv("CARBONCODE_DIAGNOSTICS", originalEnabled);
    restoreEnv("CARBONCODE_DIAGNOSTICS_ENDPOINT", originalEndpoint);
    restoreEnv("CARBONCODE_DESKTOP_VERSION", originalDesktopVersion);
    restoreEnv("NODE_ENV", originalNodeEnv);
  });

  it("redacts sensitive values before writing the local spool", () => {
    const id = reportDiagnosticError({
      category: "network",
      component: "deepseek-client",
      errorCode: "HTTP_REQUEST_FAILED",
      message:
        "Bearer abc.def user@example.com https://example.test/a?token=secret api_key=sk-secretsecret",
      stack: "at run (C:\\Users\\Alice\\private\\app.ts:12:3)",
      context: { endpoint: "/chat/completions", prompt: "must not be retained" },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);

    const pending = join(dir, "pending");
    const files = readdirSync(pending);
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(pending, files[0]!), "utf8");
    for (const forbidden of [
      "abc.def",
      "user@example.com",
      "token=secret",
      "sk-secretsecret",
      "C:\\Users\\Alice",
      "must not be retained",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("uploads a batch and removes acknowledged spool files", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ code: 0 }), { status: 202 });
    });
    reportDiagnosticError({
      category: "process",
      component: "cli",
      errorCode: "TEST_FAILURE",
      message: "test error",
    });

    await flushDiagnostics(1_000);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://collector.example/events");
    expect(requests[0]?.body.schema_version).toBe(1);
    expect(requests[0]?.body.installation_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(requests[0]?.body.events).toHaveLength(1);
    expect(readdirSync(join(dir, "pending"))).toHaveLength(0);
    expect(existsSync(join(dir, "installation-id"))).toBe(true);
  });

  it("retains events when the collector is unavailable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    reportDiagnosticError({
      category: "network",
      component: "cli",
      message: "offline",
    });

    await flushDiagnostics(1_000);

    expect(readdirSync(join(dir, "pending"))).toHaveLength(1);
  });

  it("does not send test-runner failures without an explicit diagnostics opt-in", async () => {
    Reflect.deleteProperty(process.env, "CARBONCODE_DIAGNOSTICS");
    process.env.NODE_ENV = "test";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const id = reportDiagnosticError({
      category: "network",
      component: "model-provider-client",
      message: "expected test failure",
    });
    await flushDiagnostics(1_000);

    expect(id).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "pending"))).toBe(false);
  });

  it("never sends test-runner failures to the production collector", async () => {
    process.env.NODE_ENV = "test";
    process.env.CARBONCODE_DIAGNOSTICS = "1";
    process.env.CARBONCODE_DIAGNOSTICS_ENDPOINT =
      "https://code.ai6666.com/api/v1/client-diagnostics/events";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const id = reportDiagnosticError({
      category: "network",
      component: "model-provider-client",
      message: "expected test failure",
    });
    await flushDiagnostics(1_000);

    expect(id).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "pending"))).toBe(false);
  });

  it("drains multiple batches in one flush", async () => {
    const batches: number[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      batches.push(JSON.parse(String(init.body)).events.length);
      return new Response(null, { status: 202 });
    });
    for (let index = 0; index < 25; index++) {
      reportDiagnosticError({ category: "process", component: "cli", message: `error ${index}` });
    }

    await flushDiagnostics(1_000);

    expect(batches).toEqual([20, 5]);
    expect(readdirSync(join(dir, "pending"))).toHaveLength(0);
  });

  it("uses the desktop package version while retaining the bundled CLI version", async () => {
    process.env.CARBONCODE_DESKTOP_VERSION = "0.44.2";
    let body: any;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(null, { status: 202 });
    });
    reportDiagnosticError({
      source: "desktop",
      category: "ui",
      component: "desktop-webview",
      message: "test",
    });

    await flushDiagnostics(1_000);

    expect(body.events[0].app_version).toBe("0.44.2");
    expect(body.events[0].runtime).toMatch(/^desktop-cli-0\.2\.14-node-/);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}
