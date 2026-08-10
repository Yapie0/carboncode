import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DeepSeekClient } from "../src/client.js";
import {
  type ActiveModelProvider,
  type ModelProviderConfig,
  defaultConfigPath,
  loadModelProviders,
} from "../src/config.js";
import { providerClientOptions } from "../src/provider-client-options.js";
import { isLikelyAgentModel, probeOpenAICompatibleProvider } from "../src/provider-probe.js";
import type { ChatMessage, ToolSpec } from "../src/types.js";

type CheckName = "non_stream" | "stream" | "tool_call" | "tool_continuation";

interface RequestAttempt {
  method: string;
  path: string;
  status?: number;
  elapsedMs: number;
  reasoningEffort?: string;
  requestPreview?: string;
  responsePreview?: string;
}

interface CheckResult {
  check: CheckName;
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

interface ModelResult {
  model: string;
  ok: boolean;
  checks: CheckResult[];
  requests: RequestAttempt[];
}

const configPath = process.env.CARBONCODE_MATRIX_CONFIG_PATH?.trim() || defaultConfigPath();
const reportPath = process.env.CARBONCODE_MATRIX_REPORT?.trim();
const providerFilter = commaSet(process.env.CARBONCODE_MATRIX_PROVIDERS);
const modelFilter = commaSet(process.env.CARBONCODE_MATRIX_MODELS);
const timeoutMs = positiveInt(process.env.CARBONCODE_MATRIX_TIMEOUT_MS, 180_000);
const captureResponses = process.env.CARBONCODE_MATRIX_CAPTURE_RESPONSES === "1";

function commaSet(value: string | undefined): Set<string> | null {
  const entries = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return entries.length ? new Set(entries) : null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .slice(0, 1_500);
}

function compactResponsesPayload(payload: unknown): string {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const response =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : record;
  return safeError(
    JSON.stringify({
      id: response.id,
      status: response.status,
      error: response.error,
      incompleteDetails: response.incomplete_details,
      output: response.output,
      usage: response.usage,
    }),
  );
}

function compactResponseBody(raw: string): string {
  try {
    return compactResponsesPayload(JSON.parse(raw));
  } catch {
    const payloads = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
      .map((line) => {
        try {
          return JSON.parse(line.slice(6)) as unknown;
        } catch {
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return payloads.length ? compactResponsesPayload(payloads.at(-1)) : safeError(raw);
  }
}

function resolveProvider(provider: ModelProviderConfig): ActiveModelProvider {
  const isDeepSeek = provider.kind === "deepseek";
  return {
    ...provider,
    apiKey: isDeepSeek ? process.env.DEEPSEEK_API_KEY?.trim() || provider.apiKey : provider.apiKey,
    baseUrl: isDeepSeek
      ? process.env.DEEPSEEK_BASE_URL?.trim() || provider.baseUrl || "https://api.deepseek.com"
      : provider.baseUrl || "",
    reasoningEffortMax: provider.reasoningEffortMax ?? (isDeepSeek ? "max" : "auto"),
    wireApi: provider.wireApi ?? (isDeepSeek ? "chat_completions" : "auto"),
  };
}

function observedFetch(attempts: RequestAttempt[]): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = request?.url ?? String(input);
    const method = init?.method ?? request?.method ?? "GET";
    let reasoningEffort: string | undefined;
    let attemptRequestPreview: string | undefined;
    if (typeof init?.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as {
          model?: unknown;
          input?: unknown;
          messages?: unknown;
          tools?: unknown;
          reasoning_effort?: unknown;
          reasoning?: { effort?: unknown };
        };
        const value = parsed.reasoning_effort ?? parsed.reasoning?.effort;
        if (typeof value === "string") reasoningEffort = value;
        if (captureResponses) {
          attemptRequestPreview = safeError(
            JSON.stringify({
              model: parsed.model,
              input: parsed.input,
              messages: parsed.messages,
              tools: parsed.tools,
            }),
          );
        }
      } catch {
        // Record transport metadata only; the client owns payload validation.
      }
    }
    const started = Date.now();
    const attempt: RequestAttempt = {
      method,
      path: (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })(),
      elapsedMs: 0,
      reasoningEffort,
      requestPreview: attemptRequestPreview,
    };
    attempts.push(attempt);
    try {
      const response = await globalThis.fetch(input, init);
      attempt.status = response.status;
      if (captureResponses) {
        attempt.responsePreview = compactResponseBody(await response.clone().text());
      }
      return response;
    } finally {
      attempt.elapsedMs = Date.now() - started;
    }
  };
}

async function runCheck(check: CheckName, action: () => Promise<void>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await action();
    return { check, ok: true, elapsedMs: Date.now() - started };
  } catch (error) {
    return { check, ok: false, elapsedMs: Date.now() - started, error: safeError(error) };
  }
}

const echoTool: ToolSpec = {
  type: "function",
  function: {
    name: "compatibility_echo",
    description: "Return the supplied verification value unchanged.",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};

async function verifyModel(provider: ActiveModelProvider, model: string): Promise<ModelResult> {
  const attempts: RequestAttempt[] = [];
  const client = new DeepSeekClient(
    providerClientOptions(provider, {
      fetch: observedFetch(attempts),
      timeoutMs,
      retry: { maxAttempts: 1 },
      rateLimit: {},
    }),
  );
  const marker = model.replace(/[^A-Za-z0-9]/g, "_").slice(0, 48);
  const directMarker = `NS_OK_${marker}`;
  const streamMarker = `ST_OK_${marker}`;
  let firstToolResponse: Awaited<ReturnType<DeepSeekClient["chat"]>> | null = null;
  let toolCallId = "";

  const checks: CheckResult[] = [];
  checks.push(
    await runCheck("non_stream", async () => {
      const result = await client.chat({
        model,
        messages: [
          {
            role: "system",
            content: "Follow the exact-output instruction and do not add commentary.",
          },
          { role: "user", content: `Reply with exactly ${directMarker}` },
        ],
        reasoningEffort: "max",
        maxTokens: 256,
      });
      if (!result.content.includes(directMarker)) {
        throw new Error("Non-streaming response did not contain the verification marker.");
      }
    }),
  );
  if (!checks.at(-1)?.ok) {
    for (const check of ["stream", "tool_call", "tool_continuation"] as const) {
      checks.push({
        check,
        ok: false,
        elapsedMs: 0,
        error: "Skipped because the non-streaming baseline request failed.",
      });
    }
    return { model, ok: false, checks, requests: attempts };
  }
  checks.push(
    await runCheck("stream", async () => {
      let content = "";
      for await (const chunk of client.stream({
        model,
        messages: [{ role: "user", content: `Reply with exactly ${streamMarker}` }],
        reasoningEffort: "max",
        maxTokens: 256,
      })) {
        content += chunk.contentDelta ?? "";
      }
      if (!content.includes(streamMarker)) {
        throw new Error("Streaming response did not contain the verification marker.");
      }
    }),
  );
  checks.push(
    await runCheck("tool_call", async () => {
      firstToolResponse = await client.chat({
        model,
        messages: [
          {
            role: "user",
            content:
              "Call compatibility_echo exactly once with value TOOL_OK. Do not answer directly before the tool call.",
          },
        ],
        tools: [echoTool],
        reasoningEffort: "max",
        maxTokens: 512,
      });
      const call = firstToolResponse.toolCalls.find(
        (item) => item.function.name === "compatibility_echo",
      );
      if (!call?.id) throw new Error("The model did not return the required function call ID.");
      const args = JSON.parse(call.function.arguments) as { value?: unknown };
      if (args.value !== "TOOL_OK")
        throw new Error("The model returned incorrect function arguments.");
      toolCallId = call.id;
    }),
  );
  checks.push(
    await runCheck("tool_continuation", async () => {
      if (!firstToolResponse || !toolCallId) {
        throw new Error("Skipped because the preceding tool call did not succeed.");
      }
      const continuation: ChatMessage[] = [
        {
          role: "user",
          content:
            "Call compatibility_echo exactly once with value TOOL_OK. Do not answer directly before the tool call.",
        },
        {
          role: "assistant",
          content: firstToolResponse.content,
          tool_calls: firstToolResponse.toolCalls,
          provider_items: firstToolResponse.providerItems,
        },
        { role: "tool", tool_call_id: toolCallId, content: "TOOL_OK" },
      ];
      const completed = await client.chat({
        model,
        messages: continuation,
        tools: [echoTool],
        reasoningEffort: "max",
        maxTokens: 512,
      });
      if (!completed.content.trim()) {
        throw new Error("The model returned no final text after receiving the tool result.");
      }
    }),
  );

  return {
    model,
    ok: checks.every((item) => item.ok),
    checks,
    requests: attempts,
  };
}

const providers = loadModelProviders(configPath)
  .map(resolveProvider)
  .filter(
    (provider) =>
      !providerFilter || providerFilter.has(provider.id) || providerFilter.has(provider.name),
  );

const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  configPath: resolve(configPath),
  providers: [] as Array<Record<string, unknown>>,
  summary: { providers: 0, catalogModels: 0, testedModels: 0, passedModels: 0, failedModels: 0 },
};

for (const provider of providers) {
  if (!provider.apiKey || !provider.baseUrl) {
    report.providers.push({
      id: provider.id,
      name: provider.name,
      ok: false,
      error: "Provider is missing an API key or base URL.",
    });
    continue;
  }
  const probe = await probeOpenAICompatibleProvider({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    timeoutMs,
  });
  if (!probe.ok) {
    report.providers.push({
      id: provider.id,
      name: provider.name,
      ok: false,
      probe: { ...probe, message: safeError(probe.message) },
    });
    continue;
  }
  const excludedModels = probe.models.filter((model) => !isLikelyAgentModel(model));
  const candidateModels = probe.models.filter(
    (model) => isLikelyAgentModel(model) && (!modelFilter || modelFilter.has(model)),
  );
  const results: ModelResult[] = [];
  for (const model of candidateModels) {
    process.stderr.write(`[matrix] ${provider.name} / ${model}\n`);
    results.push(await verifyModel({ ...provider, baseUrl: probe.baseUrl }, model));
  }
  report.providers.push({
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: probe.baseUrl,
    configuredWireApi: provider.wireApi,
    configuredReasoningEffortMax: provider.reasoningEffortMax,
    catalogModels: probe.models,
    excludedNonAgentModels: excludedModels,
    recommendedModel: probe.recommendedModel,
    ok: results.every((item) => item.ok),
    models: results,
  });
  report.summary.catalogModels += probe.models.length;
  report.summary.testedModels += results.length;
  report.summary.passedModels += results.filter((item) => item.ok).length;
  report.summary.failedModels += results.filter((item) => !item.ok).length;
}

report.summary.providers = report.providers.length;
Object.assign(report, { completedAt: new Date().toISOString() });
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (reportPath) writeFileSync(resolve(reportPath), serialized, "utf8");
process.stdout.write(serialized);
if (
  report.providers.some((provider) => provider.ok !== true) ||
  report.summary.testedModels === 0 ||
  report.summary.failedModels > 0
) {
  process.exitCode = 1;
}
