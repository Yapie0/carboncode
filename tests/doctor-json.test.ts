/** `reasonix doctor --json` — structured report shape and exit-code semantics. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DoctorCheck,
  doctorCommand,
  formatDoctorJson,
  runDoctorChecks,
} from "../src/cli/commands/doctor.js";
import { setLanguageRuntime } from "../src/i18n/index.js";
import { VERSION } from "../src/version.js";

afterEach(() => {
  setLanguageRuntime("EN");
});

describe("formatDoctorJson", () => {
  it("emits version, summary, and {id,status,message} per check", () => {
    const checks: DoctorCheck[] = [
      { id: "api-key", label: "api key", level: "ok", detail: "set via env" },
      { id: "tokenizer", label: "tokenizer", level: "warn", detail: "fallback" },
      { id: "api-reach", label: "api reach", level: "fail", detail: "boom" },
    ];
    const parsed = JSON.parse(formatDoctorJson(checks, "0.18.1"));

    expect(parsed.version).toBe("0.18.1");
    expect(parsed.summary).toEqual({ ok: 1, warn: 1, fail: 1 });
    expect(parsed.checks).toEqual([
      { id: "api-key", status: "ok", message: "set via env" },
      { id: "tokenizer", status: "warn", message: "fallback" },
      { id: "api-reach", status: "fail", message: "boom" },
    ]);
  });

  it("produces a single-line, jq-parseable document", () => {
    const out = formatDoctorJson(
      [{ id: "api-key", label: "api key", level: "ok", detail: "set" }],
      "1.2.3",
    );
    expect(out).not.toContain("\n");
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it("counts an empty check list as all zeros", () => {
    const parsed = JSON.parse(formatDoctorJson([], VERSION));
    expect(parsed.summary).toEqual({ ok: 0, warn: 0, fail: 0 });
    expect(parsed.checks).toEqual([]);
  });
});

describe("doctorCommand --json (integration)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let tmpHome: string;
  let tmpCwd: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "reasonix-doctor-home-"));
    tmpCwd = mkdtempSync(join(tmpdir(), "reasonix-doctor-cwd-"));
    vi.stubEnv("HOME", tmpHome);
    vi.stubEnv("USERPROFILE", tmpHome);
    // Ensure no API key so checkApiReach skips the network call.
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    process.chdir(tmpCwd);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllEnvs();
    process.chdir(origCwd);
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it("emits exactly one line of valid JSON when --json is set", async () => {
    await doctorCommand({ json: true });

    // No header, no per-check prints, no summary leak — only the JSON document.
    expect(logSpy).toHaveBeenCalledTimes(1);
    const out = String(logSpy.mock.calls[0]![0]);
    const parsed = JSON.parse(out);

    expect(parsed.version).toBe(VERSION);
    expect(parsed.summary).toMatchObject({
      ok: expect.any(Number),
      warn: expect.any(Number),
      fail: expect.any(Number),
    });
    expect(Array.isArray(parsed.checks)).toBe(true);
    for (const c of parsed.checks) {
      expect(typeof c.id).toBe("string");
      expect(["ok", "warn", "fail"]).toContain(c.status);
      expect(typeof c.message).toBe("string");
    }
  });

  it("exits 1 when the report contains any fail status", async () => {
    // checkApiKey returns `fail` when neither env nor config has a key —
    // our temp HOME has no config, and we deleted DEEPSEEK_API_KEY.
    await doctorCommand({ json: true });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    if (parsed.summary.fail > 0) {
      expect(exitSpy).toHaveBeenCalledWith(1);
    } else {
      expect(exitSpy).not.toHaveBeenCalled();
    }
  });
});

describe("doctorCommand i18n", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("localizes plain zh-CN check labels and common details", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "carboncode-doctor-home-"));
    const tmpCwd = mkdtempSync(join(tmpdir(), "carboncode-doctor-cwd-"));
    try {
      vi.stubEnv("HOME", tmpHome);
      vi.stubEnv("USERPROFILE", tmpHome);
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      setLanguageRuntime("zh-CN");

      const checks = await runDoctorChecks(tmpCwd);
      const apiKey = checks.find((c) => c.id === "api-key");
      const apiReach = checks.find((c) => c.id === "api-reach");
      const semantic = checks.find((c) => c.id === "semantic");

      expect(apiKey?.label.trim()).toBe("API 密钥");
      expect(apiKey?.detail).toContain("未设置");
      expect(apiReach?.label.trim()).toBe("API 连通");
      expect(apiReach?.detail).toContain("已跳过");
      expect(semantic?.label.trim()).toBe("语义索引");
      expect(semantic?.detail).toContain("未启用");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe("doctor custom provider reachability", () => {
  it("uses the standard model catalog instead of requiring a DeepSeek balance endpoint", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "carboncode-doctor-provider-home-"));
    const tmpCwd = mkdtempSync(join(tmpdir(), "carboncode-doctor-provider-cwd-"));
    const server = createServer((request, response) => {
      if (request.url === "/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-test" }] }));
        return;
      }
      response.writeHead(404).end();
    });
    try {
      vi.stubEnv("HOME", tmpHome);
      vi.stubEnv("USERPROFILE", tmpHome);
      vi.stubEnv("DEEPSEEK_API_KEY", "");
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      const configDir = join(tmpHome, ".carboncode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "config.json"),
        JSON.stringify({
          activeModelProviderId: "custom-test",
          modelProviders: [
            {
              id: "deepseek",
              kind: "deepseek",
              name: "DeepSeek",
            },
            {
              id: "custom-test",
              kind: "custom",
              name: "Test relay",
              apiKey: "opaque-test-token-1234",
              baseUrl: `http://127.0.0.1:${address.port}`,
              model: "gpt-test",
              wireApi: "auto",
              reasoningEffortMax: "auto",
            },
          ],
        }),
        "utf8",
      );

      const checks = await runDoctorChecks(tmpCwd);
      expect(checks.find((check) => check.id === "api-reach")).toMatchObject({
        level: "ok",
        detail: "Test relay: 1 models available.",
      });
    } finally {
      vi.unstubAllEnvs();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});
