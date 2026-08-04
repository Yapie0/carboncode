import { type EventSourceMessage, createParser } from "eventsource-parser";
import { loadRateLimit } from "./config.js";
import { DEEPSEEK_MAX_TOOLS } from "./models.js";
import { type RetryOptions, fetchWithRetry } from "./retry.js";
import type { ChatMessage, ChatRequestOptions, RawUsage, ToolCall, ToolSpec } from "./types.js";

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
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
}

export interface ChatResponse {
  content: string;
  reasoningContent: string | null;
  toolCalls: ToolCall[];
  usage: Usage;
  finishReason?: string;
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

/** Largest `total_balance` wins — the wallet the user actually paid for and expects to see ticking down. */
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
  timeoutMs?: number;
  fetch?: typeof fetch;
  rateLimit?: { rpm?: number };
  /** Retry configuration. Pass `{ maxAttempts: 1 }` to disable retries. */
  retry?: RetryOptions;
}

export class DeepSeekClient {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retry: RetryOptions;
  private readonly _fetch: typeof fetch;
  private readonly minChatIntervalMs: number;
  private nextChatRequestAt = 0;

  constructor(opts: DeepSeekClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error(
        "DEEPSEEK_API_KEY is not set. Put it in .env or pass apiKey to DeepSeekClient.",
      );
    }
    this.apiKey = apiKey;
    let url = opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    // Manual trim — `/\/+$/` is O(n²) on slash-heavy non-matches per CodeQL js/polynomial-redos.
    while (url.endsWith("/")) url = url.slice(0, -1);
    this.baseUrl = url;
    // 11 min. DeepSeek's load-balancer may keep a connection open for
    // up to 10 minutes while the request waits in queue (non-streaming
    // sends empty lines, streaming sends `:` SSE keep-alive comments —
    // both are invisible to our parsers, so neither surfaces until the
    // real response starts). Timing out at the legacy 2-min default
    // killed queued requests prematurely, burned the queue slot on
    // retry, and could loop through the whole queue repeatedly.
    // Setting 11 min lets the server's own 10-min cap close the
    // connection first (clean EOF → natural retry), and our timer
    // is a safety net for genuinely hung sockets.
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

  private buildPayload(opts: ChatRequestOptions, stream: boolean) {
    if (opts.tools && opts.tools.length > DEEPSEEK_MAX_TOOLS) {
      throw new RangeError(
        `DeepSeek accepts at most ${DEEPSEEK_MAX_TOOLS} tools per request; received ${opts.tools.length}. Disable unused MCP servers or expose a smaller tool profile.`,
      );
    }
    const payload: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
      stream,
    };
    if (opts.tools?.length) payload.tools = opts.tools;
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) payload.max_tokens = opts.maxTokens;
    if (opts.responseFormat) payload.response_format = opts.responseFormat;
    // Raw HTTP uses a top-level `thinking` object. `extra_body` is an
    // OpenAI SDK convenience and must not be serialized into the request.
    if (opts.thinking) {
      payload.thinking = { type: opts.thinking };
    }
    if (opts.reasoningEffort) {
      payload.reasoning_effort = opts.reasoningEffort;
    }
    if (stream && opts.includeUsage !== false) {
      payload.stream_options = { include_usage: true };
    }
    if (opts.userId) payload.user_id = opts.userId;
    return payload;
  }

  /** Returns null on failure so callers can degrade — session must keep working without balance UI. */
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

  /** Returns null on failure — callers fall back to a hardcoded model hint. */
  async listModels(opts: { signal?: AbortSignal } = {}): Promise<ModelList | null> {
    try {
      const resp = await this._fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: opts.signal,
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as ModelList;
      if (!data || !Array.isArray(data.data)) return null;
      return data;
    } catch {
      return null;
    }
  }

  async chat(opts: ChatRequestOptions): Promise<ChatResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const signal = opts.signal ?? ctrl.signal;

    try {
      await this.waitForChatRateLimit(signal);
      const resp = await fetchWithRetry(
        this._fetch,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(this.buildPayload(opts, false)),
          signal,
        },
        { ...this.retry, signal },
      );
      if (!resp.ok) {
        throw new Error(`DeepSeek ${resp.status}: ${await resp.text()}`);
      }
      const data: any = await resp.json();
      const choice = data.choices?.[0]?.message ?? {};
      return {
        content: choice.content ?? "",
        reasoningContent: choice.reasoning_content ?? null,
        toolCalls: choice.tool_calls ?? [],
        usage: Usage.fromApi(data.usage),
        finishReason: data.choices?.[0]?.finish_reason ?? undefined,
        raw: data,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async *stream(opts: ChatRequestOptions): AsyncGenerator<StreamChunk> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const signal = opts.signal ?? ctrl.signal;

    let resp: Response;
    try {
      await this.waitForChatRateLimit(signal);
      // Only the initial fetch is retried. Once the server has started sending
      // the stream body we do NOT retry — a mid-stream retry would re-bill and
      // desync the session context.
      resp = await fetchWithRetry(
        this._fetch,
        `${this.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(this.buildPayload(opts, true)),
          signal,
        },
        { ...this.retry, signal },
      );
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
    if (!resp.ok || !resp.body) {
      clearTimeout(timer);
      throw new Error(`DeepSeek ${resp.status}: ${await resp.text().catch(() => "")}`);
    }

    const queue: StreamChunk[] = [];
    let queueIndex = 0;
    let done = false;
    let malformedFrameCount = 0;
    const parser = createParser({
      onEvent: (ev: EventSourceMessage) => {
        if (!ev.data || ev.data === "[DONE]") {
          done = true;
          return;
        }
        try {
          const json = JSON.parse(ev.data);
          const delta = json.choices?.[0]?.delta ?? {};
          const finishReason = json.choices?.[0]?.finish_reason ?? undefined;
          const chunk: StreamChunk = { raw: json, finishReason };
          if (typeof delta.content === "string" && delta.content.length > 0) {
            chunk.contentDelta = delta.content;
          }
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
            chunk.reasoningDelta = delta.reasoning_content;
          }
          if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
            const toolCallDeltas: ToolCallDelta[] = delta.tool_calls.map((tc: any) => ({
              index: tc.index ?? 0,
              id: tc.id,
              name: tc.function?.name,
              argumentsDelta: tc.function?.arguments,
            }));
            chunk.toolCallDeltas = toolCallDeltas;
            chunk.toolCallDelta = toolCallDeltas[0];
          }
          if (json.usage) {
            chunk.usage = Usage.fromApi(json.usage);
          }
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
    if (signal.aborted) {
      cancelReader();
    } else {
      signal.addEventListener("abort", cancelReader, { once: true });
    }
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
        throwIfAborted();
        if (done) break;
        const { value, done: streamDone } = await reader.read();
        throwIfAborted();
        if (streamDone) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      while (queueIndex < queue.length) {
        throwIfAborted();
        yield queue[queueIndex++]!;
      }
      if (malformedFrameCount > 0) {
        yield { raw: null, malformedFrameCount };
      }
    } finally {
      signal.removeEventListener("abort", cancelReader);
      clearTimeout(timer);
      try {
        reader.releaseLock();
      } catch {
        // Already cancelled/released by the abort path.
      }
    }
  }
}

export type { ChatMessage, ToolCall, ToolSpec };
