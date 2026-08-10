import { type EventSourceMessage, createParser } from "eventsource-parser";
import { type ProviderReasoningEffortMax, type ProviderWireApi, loadRateLimit } from "./config.js";
import { reportDiagnosticError } from "./diagnostics.js";
import { DEEPSEEK_MAX_TOOLS } from "./models.js";
import {
  inferWireApiForModel,
  normalizeProviderApiKey,
  normalizeProviderBaseUrl,
  providerApiKeyValidationError,
} from "./provider-probe.js";
import { type RetryOptions, fetchWithRetry } from "./retry.js";
import type { ChatMessage, ChatRequestOptions, RawUsage, ToolCall, ToolSpec } from "./types.js";

type ConcreteWireApi = Exclude<ProviderWireApi, "auto">;
type AppliedReasoningEffort = "high" | "xhigh" | "max" | undefined;

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function reportClientRequestFailure(
  errorCode: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  if (error instanceof Error && error.name === "AbortError") return;
  reportDiagnosticError({
    category: "network",
    component: "model-provider-client",
    errorCode,
    error,
    context: { http_method: "POST", ...context },
  });
}

function boundedBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 8_000 ? `${trimmed.slice(0, 8_000)}...` : trimmed;
}

function isReasoningValidationError(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = body.toLowerCase();
  if (!/(reasoning[_ .-]?effort|reasoning\.effort)/.test(lower)) return false;
  return /(invalid|unsupported|unknown variant|expected|not (?:a )?valid|extra_forbidden)/.test(
    lower,
  );
}

function isEndpointMismatch(status: number, body: string): boolean {
  if (status === 404 || status === 405 || status === 501) return true;
  if (status !== 400) return false;
  const lower = body.toLowerCase();
  return /(unknown|unsupported|invalid) (?:api )?(?:route|endpoint|path)/.test(lower);
}

export class Usage {
  constructor(
    public promptTokens = 0,
    public completionTokens = 0,
    public totalTokens = 0,
    public promptCacheHitTokens = 0,
    public promptCacheMissTokens = 0,
  ) {}

  get cacheHitRatio(): number {
    const denom = this.promptCacheHitTokens + this.promptCacheMissTokens;
    return denom > 0 ? this.promptCacheHitTokens / denom : 0;
  }

  static fromApi(raw: RawUsage | undefined | null): Usage {
    const u = raw ?? {};
    const promptTokens = u.prompt_tokens ?? 0;
    const cacheHitTokens = u.prompt_cache_hit_tokens ?? 0;
    const cacheMissTokens =
      u.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHitTokens);
    return new Usage(
      promptTokens,
      u.completion_tokens ?? 0,
      u.total_tokens ?? 0,
      cacheHitTokens,
      cacheMissTokens,
    );
  }

  static fromResponses(raw: unknown): Usage {
    if (!raw || typeof raw !== "object") return new Usage();
    const usage = raw as {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
    const input = usage.input_tokens ?? 0;
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    return new Usage(
      input,
      usage.output_tokens ?? 0,
      usage.total_tokens ?? input + (usage.output_tokens ?? 0),
      cached,
      Math.max(0, input - cached),
    );
  }
}

export interface ChatResponse {
  content: string;
  reasoningContent: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason?: string;
  /** Provider-native response items needed for stateless Responses tool continuations. */
  providerItems?: unknown[];
  raw: unknown;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

export interface StreamChunk {
  contentDelta?: string;
  reasoningDelta?: string;
  /** All tool-call deltas present in this SSE frame. */
  toolCallDeltas?: ToolCallDelta[];
  /** @deprecated Use toolCallDeltas. Kept for single-call API compatibility. */
  toolCallDelta?: ToolCallDelta;
  usage?: Usage;
  finishReason?: string;
  malformedFrameCount?: number;
  /** Provider-native response items emitted on the terminal Responses event. */
  providerItems?: unknown[];
  raw: any;
}

export interface BalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance?: string;
  topped_up_balance?: string;
}

export interface UserBalance {
  is_available: boolean;
  balance_infos: BalanceInfo[];
}

/** Largest `total_balance` wins: the wallet the user expects to see ticking down. */
export function pickPrimaryBalance(infos: ReadonlyArray<BalanceInfo>): BalanceInfo | null {
  if (infos.length === 0) return null;
  let best = infos[0]!;
  for (let i = 1; i < infos.length; i++) {
    if (Number(infos[i]!.total_balance) > Number(best.total_balance)) best = infos[i]!;
  }
  return best;
}

export interface ModelInfo {
  id: string;
  object: "model";
  owned_by: string;
}

export interface ModelList {
  object: "list";
  data: ModelInfo[];
}

export interface DeepSeekClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Human-readable provider label used in errors and diagnostics. */
  providerName?: string;
  /** Provider-specific cap. Auto learns from explicit validation responses. */
  reasoningEffortMax?: ProviderReasoningEffortMax;
  /** OpenAI-compatible request protocol. */
  wireApi?: ProviderWireApi;
  /** DeepSeek accepts 128 tools. OpenAI-compatible providers may set no cap. */
  maxTools?: number | null;
  /** Whether this endpoint accepts DeepSeek's top-level `thinking` extension. */
  sendThinking?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
  rateLimit?: { rpm?: number };
  /** Retry configuration. Pass `{ maxAttempts: 1 }` to disable retries. */
  retry?: RetryOptions;
}

interface OpenedRequest {
  response: Response;
  wireApi: ConcreteWireApi;
  endpoint: string;
}

function responseOutputItems(raw: any): unknown[] {
  return Array.isArray(raw?.output) ? raw.output : [];
}

function responseText(items: readonly any[]): string {
  let text = "";
  for (const item of items) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (
        (part?.type === "output_text" || part?.type === "text") &&
        typeof part.text === "string"
      ) {
        text += part.text;
      }
    }
  }
  return text;
}

function responseReasoning(items: readonly any[]): string | null {
  const chunks: string[] = [];
  for (const item of items) {
    if (item?.type !== "reasoning") continue;
    const summaries = Array.isArray(item.summary) ? item.summary : [];
    for (const summary of summaries) {
      if (typeof summary?.text === "string") chunks.push(summary.text);
    }
  }
  return chunks.length ? chunks.join("") : null;
}

function responseToolCalls(items: readonly any[]): ToolCall[] {
  return items
    .filter((item) => item?.type === "function_call" && typeof item.name === "string")
    .map((item) => ({
      id:
        typeof item.call_id === "string"
          ? item.call_id
          : typeof item.id === "string"
            ? item.id
            : undefined,
      type: "function" as const,
      function: {
        name: item.name,
        arguments: typeof item.arguments === "string" ? item.arguments : "{}",
      },
    }));
}

function responseFinishReason(raw: any, items: readonly any[]): string | undefined {
  if (raw?.status === "incomplete") return raw?.incomplete_details?.reason ?? "length";
  if (raw?.status === "failed") return "error";
  if (items.some((item) => item?.type === "function_call")) return "tool_calls";
  if (raw?.status === "completed") return "stop";
  return undefined;
}

class EmptySemanticResponseError extends Error {}
class RetryableProviderResponseError extends Error {}

const EMPTY_SEMANTIC_MAX_ATTEMPTS = 3;

function emptySemanticResponseError(providerName: string): EmptySemanticResponseError {
  return new EmptySemanticResponseError(
    `${providerName} returned a completed response without text, reasoning, or tool calls. Verify that the selected model is available on this provider.`,
  );
}

function providerResponseError(providerName: string, response: any): Error {
  const upstream = response?.error ?? {};
  const message =
    typeof upstream.message === "string" && upstream.message.trim()
      ? upstream.message.trim()
      : "unknown error";
  const metadata = [upstream.code, upstream.type]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  const detail = `${message}${metadata.length ? ` (${metadata.join(", ")})` : ""}`;
  const errorMessage = `${providerName} Responses API failed: ${detail}`;
  const transient =
    /upstream|temporar|timeout|overload|server|internal|unavailable|connection|rate.?limit/i.test(
      `${message} ${metadata.join(" ")}`,
    );
  return transient ? new RetryableProviderResponseError(errorMessage) : new Error(errorMessage);
}

async function waitForEmptySemanticRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
}

export class DeepSeekClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly providerName: string;
  readonly reasoningEffortMax: ProviderReasoningEffortMax;
  readonly wireApi: ProviderWireApi;
  readonly maxTools: number | null;
  readonly sendThinking: boolean;
  readonly timeoutMs: number;
  readonly retry: RetryOptions;
  private readonly _fetch: typeof fetch;
  private readonly minChatIntervalMs: number;
  private nextChatRequestAt = 0;
  private learnedWireApi: ConcreteWireApi | null = null;
  private readonly learnedReasoning = new Map<string, AppliedReasoningEffort>();
  private readonly learnedEndpoints = new Map<ConcreteWireApi, string>();

  constructor(opts: DeepSeekClientOptions = {}) {
    const providerName = opts.providerName?.trim() || "Model provider";
    const apiKey = normalizeProviderApiKey(opts.apiKey ?? process.env.DEEPSEEK_API_KEY);
    if (!apiKey) {
      throw new Error(
        `${providerName} API key is not set. Configure the active provider or pass apiKey to the client.`,
      );
    }
    const apiKeyError = providerApiKeyValidationError(apiKey);
    if (apiKeyError) throw new Error(`${providerName} API key is invalid. ${apiKeyError}`);
    this.apiKey = apiKey;
    const rawBaseUrl = opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    const baseUrl = normalizeProviderBaseUrl(rawBaseUrl);
    if (!baseUrl) {
      throw new Error(
        `${providerName} API base URL is invalid. Enter only an HTTP(S) provider URL, not an MCP command or model assignment.`,
      );
    }
    this.baseUrl = baseUrl;
    this.providerName = opts.providerName?.trim() || "DeepSeek";
    this.reasoningEffortMax = opts.reasoningEffortMax ?? "max";
    this.wireApi = opts.wireApi ?? "chat_completions";
    this.maxTools = opts.maxTools === undefined ? DEEPSEEK_MAX_TOOLS : opts.maxTools;
    this.sendThinking = opts.sendThinking ?? true;
    this.timeoutMs = opts.timeoutMs ?? 660_000;
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.retry = opts.retry ?? {};
    const rpm = opts.rateLimit?.rpm ?? loadRateLimit()?.rpm;
    this.minChatIntervalMs = rpm ? Math.ceil(60_000 / rpm) : 0;
  }

  private async waitForChatRateLimit(signal?: AbortSignal): Promise<void> {
    if (this.minChatIntervalMs <= 0) return;
    const now = Date.now();
    const waitMs = Math.max(0, this.nextChatRequestAt - now);
    this.nextChatRequestAt = Math.max(now, this.nextChatRequestAt) + this.minChatIntervalMs;
    if (waitMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, waitMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private validateTools(opts: ChatRequestOptions): void {
    if (opts.tools && this.maxTools !== null && opts.tools.length > this.maxTools) {
      throw new RangeError(
        `${this.providerName} accepts at most ${this.maxTools} tools per request; received ${opts.tools.length}. Disable unused MCP servers or expose a smaller tool profile.`,
      );
    }
  }

  private protocolOrder(model: string): ConcreteWireApi[] {
    if (this.wireApi !== "auto") return [this.wireApi];
    const preferred = this.learnedWireApi ?? inferWireApiForModel(model);
    const fallback = preferred === "responses" ? "chat_completions" : "responses";
    return [preferred, fallback];
  }

  private endpointCandidates(wireApi: ConcreteWireApi): string[] {
    const learned = this.learnedEndpoints.get(wireApi);
    const suffix = wireApi === "responses" ? "responses" : "chat/completions";
    const candidates = learned ? [learned] : [];
    const add = (value: string) => {
      if (!candidates.includes(value)) candidates.push(value);
    };
    add(`${this.baseUrl}/${suffix}`);
    try {
      const url = new URL(this.baseUrl);
      const path = url.pathname.replace(/\/+$/, "");
      if (path.toLowerCase().endsWith("/v1")) {
        url.pathname = path.slice(0, -3) || "/";
        add(`${url.toString().replace(/\/+$/, "")}/${suffix}`);
      } else {
        add(`${this.baseUrl}/v1/${suffix}`);
      }
    } catch {
      // The eventual fetch provides the actionable invalid URL error.
    }
    return candidates;
  }

  private reasoningCandidates(opts: ChatRequestOptions): AppliedReasoningEffort[] {
    if (!opts.reasoningEffort || this.reasoningEffortMax === "none") return [undefined];
    if (opts.reasoningEffort === "high") return ["high", undefined];
    const learned = this.learnedReasoning.get(opts.model);
    if (this.learnedReasoning.has(opts.model)) return [learned];
    switch (this.reasoningEffortMax) {
      case "high":
        return ["high", undefined];
      case "xhigh":
        return ["xhigh", "high", undefined];
      case "max":
        return ["max", "xhigh", "high", undefined];
      case "auto":
        if (inferWireApiForModel(opts.model) === "responses") {
          return ["xhigh", "high", undefined];
        }
        if (opts.model.toLowerCase().includes("deepseek")) return ["max", "high", undefined];
        return ["high", undefined];
    }
  }

  private buildChatPayload(
    opts: ChatRequestOptions,
    stream: boolean,
    effort: AppliedReasoningEffort,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map(({ provider_items: _providerItems, ...message }) => message),
      stream,
    };
    if (opts.tools?.length) payload.tools = opts.tools;
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) payload.max_tokens = opts.maxTokens;
    if (opts.responseFormat) payload.response_format = opts.responseFormat;
    if (opts.thinking && this.sendThinking) payload.thinking = { type: opts.thinking };
    if (effort) payload.reasoning_effort = effort;
    if (stream && opts.includeUsage !== false) payload.stream_options = { include_usage: true };
    if (opts.userId) payload.user_id = opts.userId;
    return payload;
  }

  private buildResponsesInput(messages: readonly ChatMessage[]): unknown[] {
    const input: unknown[] = [];
    for (const message of messages) {
      if (message.role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id ?? "",
          output: message.content ?? "",
        });
        continue;
      }
      if (message.role === "assistant" && message.provider_items?.length) {
        input.push(...message.provider_items);
        continue;
      }
      if (message.content !== undefined && message.content !== null && message.content !== "") {
        input.push({ role: message.role, content: message.content });
      }
      if (message.role === "assistant" && message.tool_calls?.length) {
        for (const call of message.tool_calls) {
          input.push({
            type: "function_call",
            call_id: call.id ?? "",
            name: call.function.name,
            arguments: call.function.arguments,
          });
        }
      }
    }
    return input;
  }

  private buildResponsesPayload(
    opts: ChatRequestOptions,
    stream: boolean,
    effort: AppliedReasoningEffort,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: opts.model,
      input: this.buildResponsesInput(opts.messages),
      stream,
      store: false,
    };
    if (opts.tools?.length) {
      payload.tools = opts.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }));
    }
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) payload.max_output_tokens = opts.maxTokens;
    if (opts.responseFormat) payload.text = { format: opts.responseFormat };
    if (effort) {
      payload.reasoning = { effort, summary: "auto" };
      payload.include = ["reasoning.encrypted_content"];
    }
    if (opts.userId) payload.safety_identifier = opts.userId;
    return payload;
  }

  private buildPayload(
    wireApi: ConcreteWireApi,
    opts: ChatRequestOptions,
    stream: boolean,
    effort: AppliedReasoningEffort,
  ): Record<string, unknown> {
    return wireApi === "responses"
      ? this.buildResponsesPayload(opts, stream, effort)
      : this.buildChatPayload(opts, stream, effort);
  }

  private async openRequest(
    opts: ChatRequestOptions,
    stream: boolean,
    signal: AbortSignal,
  ): Promise<OpenedRequest> {
    this.validateTools(opts);
    const protocols = this.protocolOrder(opts.model);
    let lastError = new Error(`${this.providerName}: no compatible API endpoint found.`);

    for (const wireApi of protocols) {
      const efforts = this.reasoningCandidates(opts);
      for (const endpoint of this.endpointCandidates(wireApi)) {
        let endpointMissing = false;
        for (let index = 0; index < efforts.length; index++) {
          const effort = efforts[index];
          const response = await fetchWithRetry(
            this._fetch,
            endpoint,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                ...(stream ? { Accept: "text/event-stream" } : {}),
              },
              body: JSON.stringify(this.buildPayload(wireApi, opts, stream, effort)),
              signal,
            },
            { ...this.retry, signal },
          );
          if (response.ok) {
            this.learnedWireApi = wireApi;
            this.learnedEndpoints.set(wireApi, endpoint);
            this.learnedReasoning.set(opts.model, effort);
            return { response, wireApi, endpoint };
          }

          const body = boundedBody(await response.text().catch(() => ""));
          lastError = new Error(
            `${this.providerName} ${response.status}${body ? `: ${body}` : ""}`,
          );
          if (isReasoningValidationError(response.status, body) && index < efforts.length - 1) {
            continue;
          }
          if (isEndpointMismatch(response.status, body)) {
            endpointMissing = true;
            break;
          }
          throw lastError;
        }
        if (!endpointMissing) throw lastError;
      }
    }
    throw lastError;
  }

  /** Returns null on failure so callers can degrade without breaking the session. */
  async getBalance(opts: { signal?: AbortSignal } = {}): Promise<UserBalance | null> {
    try {
      const resp = await this._fetch(`${this.baseUrl}/user/balance`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: opts.signal,
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as UserBalance;
      if (!data || !Array.isArray(data.balance_infos)) return null;
      return data;
    } catch {
      return null;
    }
  }

  /** Returns null on failure; provider setup uses the richer probe helper. */
  async listModels(opts: { signal?: AbortSignal } = {}): Promise<ModelList | null> {
    for (const endpoint of [`${this.baseUrl}/models`, `${this.baseUrl}/v1/models`]) {
      try {
        const resp = await this._fetch(endpoint, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.apiKey}` },
          signal: opts.signal,
        });
        if (!resp.ok) continue;
        const data = (await resp.json()) as ModelList;
        if (data && Array.isArray(data.data)) return data;
      } catch {
        // Try the alternate conventional catalog path.
      }
    }
    return null;
  }

  async chat(opts: ChatRequestOptions): Promise<ChatResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const signal = opts.signal ?? ctrl.signal;
    let endpoint = "";
    let reported = false;
    try {
      for (
        let semanticAttempt = 0;
        semanticAttempt < EMPTY_SEMANTIC_MAX_ATTEMPTS;
        semanticAttempt++
      ) {
        try {
          await this.waitForChatRateLimit(signal);
          const opened = await this.openRequest(opts, false, signal);
          endpoint = opened.endpoint;
          const data: any = await opened.response.json();
          if (opened.wireApi === "responses") {
            if (data?.status === "failed") throw providerResponseError(this.providerName, data);
            const items = responseOutputItems(data);
            const result = {
              content: responseText(items),
              reasoningContent: responseReasoning(items),
              toolCalls: responseToolCalls(items),
              usage: Usage.fromResponses(data.usage),
              finishReason: responseFinishReason(data, items),
              providerItems: items,
              raw: data,
            };
            if (!result.content && !result.reasoningContent && result.toolCalls.length === 0) {
              throw emptySemanticResponseError(this.providerName);
            }
            return result;
          }
          const choice = data.choices?.[0]?.message ?? {};
          const result = {
            content: choice.content ?? "",
            reasoningContent: choice.reasoning_content ?? null,
            toolCalls: choice.tool_calls ?? [],
            usage: Usage.fromApi(data.usage),
            finishReason: data.choices?.[0]?.finish_reason ?? undefined,
            raw: data,
          };
          if (!result.content && !result.reasoningContent && result.toolCalls.length === 0) {
            throw emptySemanticResponseError(this.providerName);
          }
          return result;
        } catch (error) {
          if (
            semanticAttempt < EMPTY_SEMANTIC_MAX_ATTEMPTS - 1 &&
            (error instanceof EmptySemanticResponseError ||
              error instanceof RetryableProviderResponseError) &&
            !signal.aborted
          ) {
            await waitForEmptySemanticRetry(semanticAttempt + 1);
            continue;
          }
          throw error;
        }
      }
      throw emptySemanticResponseError(this.providerName);
    } catch (error) {
      if (!reported) {
        reportClientRequestFailure("HTTP_REQUEST_FAILED", error, {
          endpoint: endpoint || "auto",
          provider: this.providerName,
        });
        reported = true;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async *stream(opts: ChatRequestOptions): AsyncGenerator<StreamChunk> {
    for (
      let semanticAttempt = 0;
      semanticAttempt < EMPTY_SEMANTIC_MAX_ATTEMPTS;
      semanticAttempt++
    ) {
      const buffered: StreamChunk[] = [];
      let sawMeaningfulOutput = false;
      try {
        for await (const chunk of this.streamOnce(opts)) {
          const meaningful = Boolean(
            chunk.contentDelta ||
              chunk.reasoningDelta ||
              chunk.toolCallDelta ||
              chunk.toolCallDeltas?.length,
          );
          if (!sawMeaningfulOutput && meaningful) {
            sawMeaningfulOutput = true;
            for (const pending of buffered) yield pending;
            buffered.length = 0;
          }
          if (sawMeaningfulOutput) yield chunk;
          else buffered.push(chunk);
        }
        for (const pending of buffered) yield pending;
        return;
      } catch (error) {
        if (
          semanticAttempt < EMPTY_SEMANTIC_MAX_ATTEMPTS - 1 &&
          !sawMeaningfulOutput &&
          (error instanceof EmptySemanticResponseError ||
            error instanceof RetryableProviderResponseError) &&
          !opts.signal?.aborted
        ) {
          await waitForEmptySemanticRetry(semanticAttempt + 1);
          continue;
        }
        throw error;
      }
    }
  }

  private async *streamOnce(opts: ChatRequestOptions): AsyncGenerator<StreamChunk> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const signal = opts.signal ?? ctrl.signal;

    let opened: OpenedRequest;
    try {
      await this.waitForChatRateLimit(signal);
      opened = await this.openRequest(opts, true, signal);
    } catch (error) {
      clearTimeout(timer);
      reportClientRequestFailure("STREAM_CONNECT_FAILED", error, {
        endpoint: "auto",
        provider: this.providerName,
      });
      throw error;
    }
    const resp = opened.response;
    if (!resp.body) {
      clearTimeout(timer);
      const error = new Error(`${this.providerName} returned an empty streaming response.`);
      reportClientRequestFailure("STREAM_RESPONSE_ERROR", error, {
        endpoint: opened.endpoint,
        provider: this.providerName,
      });
      throw error;
    }

    const queue: StreamChunk[] = [];
    let queueIndex = 0;
    let done = false;
    let malformedFrameCount = 0;
    let terminalError: Error | null = null;
    let sawResponsesToolCall = false;
    let sawMeaningfulOutput = false;
    let streamedResponseText = "";
    let streamedResponseReasoning = "";
    const responseCallArgs = new Map<number, number>();

    const queueToolDeltas = (raw: any, deltas: ToolCallDelta[]) => {
      if (!deltas.length) return;
      queue.push({
        raw,
        toolCallDeltas: deltas,
        toolCallDelta: deltas[0],
      });
    };

    const onResponsesEvent = (json: any) => {
      const type = json?.type;
      if (type === "response.output_text.delta" && typeof json.delta === "string") {
        if (json.delta.length > 0) {
          sawMeaningfulOutput = true;
          streamedResponseText += json.delta;
        }
        queue.push({ raw: json, contentDelta: json.delta });
        return;
      }
      if (
        (type === "response.reasoning_summary_text.delta" ||
          type === "response.reasoning_text.delta") &&
        typeof json.delta === "string"
      ) {
        if (json.delta.length > 0) {
          sawMeaningfulOutput = true;
          streamedResponseReasoning += json.delta;
        }
        queue.push({ raw: json, reasoningDelta: json.delta });
        return;
      }
      if (type === "response.output_item.added" && json.item?.type === "function_call") {
        sawMeaningfulOutput = true;
        sawResponsesToolCall = true;
        const index = Number.isInteger(json.output_index) ? json.output_index : 0;
        responseCallArgs.set(index, 0);
        queueToolDeltas(json, [
          {
            index,
            id: json.item.call_id ?? json.item.id,
            name: json.item.name,
          },
        ]);
        return;
      }
      if (type === "response.function_call_arguments.delta" && typeof json.delta === "string") {
        sawMeaningfulOutput = true;
        const index = Number.isInteger(json.output_index) ? json.output_index : 0;
        responseCallArgs.set(index, (responseCallArgs.get(index) ?? 0) + json.delta.length);
        queueToolDeltas(json, [{ index, argumentsDelta: json.delta }]);
        return;
      }
      if (type === "response.output_item.done" && json.item?.type === "function_call") {
        sawResponsesToolCall = true;
        const index = Number.isInteger(json.output_index) ? json.output_index : 0;
        const emitted = responseCallArgs.get(index) ?? 0;
        if (emitted === 0 && typeof json.item.arguments === "string") {
          queueToolDeltas(json, [
            {
              index,
              id: json.item.call_id ?? json.item.id,
              name: json.item.name,
              argumentsDelta: json.item.arguments,
            },
          ]);
        }
        return;
      }
      if (
        type === "response.completed" ||
        type === "response.incomplete" ||
        type === "response.failed"
      ) {
        const response = json.response ?? {};
        const items = responseOutputItems(response);
        const terminalText = responseText(items);
        const terminalReasoning = responseReasoning(items) ?? "";
        const missingText = terminalText.startsWith(streamedResponseText)
          ? terminalText.slice(streamedResponseText.length)
          : streamedResponseText.length === 0
            ? terminalText
            : "";
        const missingReasoning = terminalReasoning.startsWith(streamedResponseReasoning)
          ? terminalReasoning.slice(streamedResponseReasoning.length)
          : streamedResponseReasoning.length === 0
            ? terminalReasoning
            : "";
        if (missingReasoning) {
          sawMeaningfulOutput = true;
          streamedResponseReasoning += missingReasoning;
          queue.push({ raw: json, reasoningDelta: missingReasoning });
        }
        if (missingText) {
          sawMeaningfulOutput = true;
          streamedResponseText += missingText;
          queue.push({ raw: json, contentDelta: missingText });
        }
        if (!sawResponsesToolCall) {
          const terminalCalls = responseToolCalls(items);
          terminalCalls.forEach((call, index) => {
            sawMeaningfulOutput = true;
            sawResponsesToolCall = true;
            queueToolDeltas(json, [
              {
                index,
                id: call.id,
                name: call.function.name,
                argumentsDelta: call.function.arguments,
              },
            ]);
          });
        }
        const finishReason = responseFinishReason(response, items);
        queue.push({
          raw: json,
          usage: Usage.fromResponses(response.usage),
          finishReason: finishReason ?? (sawResponsesToolCall ? "tool_calls" : "stop"),
          providerItems: items,
        });
        if (type === "response.failed") {
          terminalError = providerResponseError(this.providerName, response);
        }
        done = true;
      }
    };

    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (!event.data || event.data === "[DONE]") {
          done = true;
          return;
        }
        try {
          const json = JSON.parse(event.data);
          if (opened.wireApi === "responses") {
            onResponsesEvent(json);
            return;
          }
          const delta = json.choices?.[0]?.delta ?? {};
          const finishReason = json.choices?.[0]?.finish_reason ?? undefined;
          const chunk: StreamChunk = { raw: json, finishReason };
          if (typeof delta.content === "string" && delta.content.length > 0) {
            sawMeaningfulOutput = true;
            chunk.contentDelta = delta.content;
          }
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
            sawMeaningfulOutput = true;
            chunk.reasoningDelta = delta.reasoning_content;
          }
          if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
            sawMeaningfulOutput = true;
            const toolCallDeltas: ToolCallDelta[] = delta.tool_calls.map((call: any) => ({
              index: call.index ?? 0,
              id: call.id,
              name: call.function?.name,
              argumentsDelta: call.function?.arguments,
            }));
            chunk.toolCallDeltas = toolCallDeltas;
            chunk.toolCallDelta = toolCallDeltas[0];
          }
          if (json.usage) chunk.usage = Usage.fromApi(json.usage);
          queue.push(chunk);
        } catch {
          malformedFrameCount += 1;
        }
      },
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const cancelReader = () => {
      void reader.cancel(abortError(signal)).catch(() => undefined);
    };
    if (signal.aborted) cancelReader();
    else signal.addEventListener("abort", cancelReader, { once: true });
    const throwIfAborted = () => {
      if (signal.aborted) throw abortError(signal);
    };
    try {
      while (true) {
        throwIfAborted();
        if (queueIndex < queue.length) {
          yield queue[queueIndex++]!;
          if (queueIndex >= 1024 && queueIndex * 2 >= queue.length) {
            queue.splice(0, queueIndex);
            queueIndex = 0;
          }
          continue;
        }
        if (terminalError) throw terminalError;
        if (done) break;
        const { value, done: streamDone } = await reader.read();
        throwIfAborted();
        if (streamDone) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      while (queueIndex < queue.length) yield queue[queueIndex++]!;
      if (terminalError) throw terminalError;
      if (!sawMeaningfulOutput) {
        throw emptySemanticResponseError(this.providerName);
      }
      if (malformedFrameCount > 0) yield { raw: null, malformedFrameCount };
    } catch (error) {
      reportClientRequestFailure("STREAM_READ_FAILED", error, {
        endpoint: opened.endpoint,
        provider: this.providerName,
      });
      throw error;
    } finally {
      signal.removeEventListener("abort", cancelReader);
      clearTimeout(timer);
      try {
        reader.releaseLock();
      } catch {
        // Already cancelled or released by the abort path.
      }
    }
  }
}

export type { ChatMessage, ToolCall, ToolSpec };
