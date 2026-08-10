import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

describe("desktop provider registry protocol", () => {
  let child: ChildProcessWithoutNullStreams | null = null;
  let server: Server | null = null;
  let root = "";
  let authorizationHeaders: Array<string | undefined> = [];

  afterEach(async () => {
    if (child && !child.killed) {
      child.stdin.write(`${JSON.stringify({ cmd: "runtime_bye" })}\n`);
      await new Promise((resolveExit) => {
        const timer = setTimeout(() => {
          child?.kill();
          resolveExit(undefined);
        }, 2_000);
        child?.once("exit", () => {
          clearTimeout(timer);
          resolveExit(undefined);
        });
      });
    }
    child = null;
    if (server?.listening) {
      await new Promise<void>((resolveClose) => server?.close(() => resolveClose()));
    }
    server = null;
    authorizationHeaders = [];
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("persists, activates, and restores independent provider records", async () => {
    root = mkdtempSync(join(tmpdir(), "carboncode-desktop-provider-"));
    const workspace = join(root, "workspace");
    const configDir = join(root, ".carboncode");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        modelProviders: [
          {
            id: "deepseek",
            kind: "deepseek",
            name: "DeepSeek",
            apiKey: "sk-deepseek-secret",
            model: "deepseek-v4-flash",
            preset: "flash",
            reasoningEffortMax: "max",
          },
        ],
        activeModelProviderId: "deepseek",
        modelProvider: "deepseek",
        preset: "flash",
      }),
      "utf8",
    );

    server = createServer((request, response) => {
      if (request.url === "/v1/models") {
        authorizationHeaders.push(request.headers.authorization);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [{ id: "gpt-test" }] }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolveListen) => server?.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
    child = spawn(process.execPath, [tsxCli, "src/cli/index.ts", "desktop", "--dir", workspace], {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        DEEPSEEK_API_KEY: "",
        DEEPSEEK_BASE_URL: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const events: Array<Record<string, unknown>> = [];
    const readline = createInterface({ input: child.stdout });
    readline.on("line", (line) => {
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Desktop stdout is expected to be JSONL; ignore startup noise defensively.
      }
    });

    child.stdin.write(`${JSON.stringify({ cmd: "runtime_hello" })}\n`);
    await waitForEvent(events, (event) => event.type === "$settings");

    child.stdin.write(`${JSON.stringify({ cmd: "provider_probe", nonce: 100, baseUrl })}\n`);
    await waitForEvent(
      events,
      (event) =>
        event.type === "$provider_probe" &&
        event.nonce === 100 &&
        event.ok === false &&
        event.code === "api_key_required",
    );
    expect(authorizationHeaders).toHaveLength(0);

    child.stdin.write(
      `${JSON.stringify({
        cmd: "provider_save",
        nonce: 101,
        kind: "custom",
        name: "GPT relay",
        baseUrl,
        model: "gpt-test",
        apiKey: "k",
        reasoningEffortMax: "xhigh",
        wireApi: "responses",
      })}\n`,
    );
    await waitForEvent(
      events,
      (event) => event.type === "$provider_probe" && event.nonce === 101 && event.saved === true,
    );
    const activeCustom = await waitForEvent(
      events,
      (event) => event.type === "$settings" && event.activeModelProviderId !== "deepseek",
    );
    const customId = String(activeCustom.activeModelProviderId);
    expect(activeCustom.model).toBe("gpt-test");
    expect(activeCustom.modelProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deepseek", kind: "deepseek" }),
        expect.objectContaining({
          id: customId,
          kind: "custom",
          name: "GPT relay",
          models: ["gpt-test"],
          reasoningEffortMax: "xhigh",
          wireApi: "responses",
        }),
      ]),
    );

    const activateEventStart = events.length;
    child.stdin.write(`${JSON.stringify({ cmd: "provider_activate", id: "deepseek" })}\n`);
    await waitForEvent(
      events,
      (event) => event.type === "$settings" && event.activeModelProviderId === "deepseek",
      activateEventStart,
    );

    const persisted = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8"));
    expect(persisted.activeModelProviderId).toBe("deepseek");
    expect(persisted.modelProviders).toHaveLength(2);
    expect(persisted.modelProviders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: customId,
          apiKey: "k",
          models: ["gpt-test"],
          reasoningEffortMax: "xhigh",
          wireApi: "responses",
        }),
      ]),
    );
  }, 20_000);

  it("restores the active provider model on launch and completes a desktop turn", async () => {
    root = mkdtempSync(join(tmpdir(), "carboncode-desktop-turn-"));
    const workspace = join(root, "workspace");
    const configDir = join(root, ".carboncode");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const requestBodies: Array<Record<string, unknown>> = [];
    server = createServer((request, response) => {
      if (request.method === "POST" && request.url?.endsWith("/responses")) {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          requestBodies.push(JSON.parse(body) as Record<string, unknown>);
          const output = [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "DESKTOP_E2E_OK" }],
            },
          ];
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(
            [
              `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "DESKTOP_" })}`,
              `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "E2E_OK" })}`,
              `data: ${JSON.stringify({
                type: "response.completed",
                response: {
                  status: "completed",
                  output,
                  usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
                },
              })}`,
              "data: [DONE]",
              "",
            ].join("\n\n"),
          );
        });
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolveListen) => server?.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;

    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        model: "deepseek-v4-pro",
        modelProviders: [
          { id: "deepseek", kind: "deepseek", name: "DeepSeek" },
          {
            id: "custom-test",
            kind: "custom",
            name: "Test relay",
            apiKey: "test-key",
            baseUrl,
            model: "gpt-test",
            wireApi: "responses",
          },
        ],
        activeModelProviderId: "custom-test",
      }),
      "utf8",
    );

    const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
    child = spawn(process.execPath, [tsxCli, "src/cli/index.ts", "desktop", "--dir", workspace], {
      cwd: resolve("."),
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        DEEPSEEK_API_KEY: "",
        DEEPSEEK_BASE_URL: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const events: Array<Record<string, unknown>> = [];
    const readline = createInterface({ input: child.stdout });
    readline.on("line", (line) => {
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Desktop stdout is expected to be JSONL; ignore startup noise defensively.
      }
    });

    child.stdin.write(`${JSON.stringify({ cmd: "runtime_hello" })}\n`);
    await waitForEvent(events, (event) => event.type === "$ready");
    const settings = await waitForEvent(events, (event) => event.type === "$settings");
    expect(settings.model).toBe("gpt-test");
    expect(settings.activeModelProviderId).toBe("custom-test");

    const turnStart = events.length;
    child.stdin.write(
      `${JSON.stringify({ cmd: "user_input", text: "Reply exactly DESKTOP_E2E_OK" })}\n`,
    );
    await waitForEvent(events, (event) => event.type === "$turn_complete", turnStart);

    const turnEvents = events.slice(turnStart);
    expect(
      turnEvents
        .filter((event) => event.type === "model.delta" && event.channel === "content")
        .map((event) => String(event.text ?? ""))
        .join(""),
    ).toBe("DESKTOP_E2E_OK");
    expect(turnEvents.some((event) => event.type === "$error" || event.type === "error")).toBe(
      false,
    );
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]?.model).toBe("gpt-test");
  }, 30_000);
});

async function waitForEvent(
  events: Array<Record<string, unknown>>,
  predicate: (event: Record<string, unknown>) => boolean,
  startIndex = 0,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const match = events.slice(startIndex).find(predicate);
    if (match) return match;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(
    `Timed out waiting for desktop event. Seen: ${JSON.stringify(events.slice(-10))}`,
  );
}
