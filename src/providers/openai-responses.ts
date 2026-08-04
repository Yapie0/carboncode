import {
  type ChatProviderClient,
  type ChatResponse,
  type ModelList,
  type StreamChunk,
  Usage,
  type UserBalance,
} from "../client.js";
import { type RetryOptions, fetchWithRetry } from "../retry.js";
import type { ChatMessage, ChatRequestOptions, ToolCall, ToolSpec } from "../types.js";

export interface OpenAIResponsesClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  retry?: RetryOptions;
}

interface OpenAIResponseOutput {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  encrypted_content?: string;
  summary?: Array<{ type?: string; text?: string }>;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}

interface OpenAIResponseBody {
  id?: string;
  status?: string;
  output?: OpenAIResponseOutput[];
  output_text?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string } | null;
  [key: string]: unknown;
}

type OpenAIInputItem = Record<string, unknown>;

function trimTrailingSlashes(value: string): string {
  let result = value;
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}

function asText(content: string | null | undefined): string {
  return content ?? "";
}

function preservedReasoningItems(message: ChatMessage): OpenAIInputItem[] {
  const state = message.provider_data?.openaiResponses;
  if (!state || typeof state !== "object") return [];
  const items = (state as { reasoningItems?: unknown }).reasoningItems;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is OpenAIInputItem =>
      Boolean(item) &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "reasoning",
  );
}

function preservedFunctionItemIds(message: ChatMessage): Record<string, string> {
  const state = message.provider_data?.openaiResponses;
  if (!state || typeof state !== "object") return {};
  const ids = (state as { functionItemIds?: unknown }).functionItemIds;
  if (!ids || typeof ids !== "object" || Array.isArray(ids)) return {};
  return Object.fromEntries(
    Object.entries(ids).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}

export function toOpenAIResponsesInput(messages: readonly ChatMessage[]): OpenAIInputItem[] {
  const input: OpenAIInputItem[] = [];
  for (const message of messages) {
    input.push(...preservedReasoningItems(message));
    const functionItemIds = preservedFunctionItemIds(message);

    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id ?? "",
        output: asText(message.content),
      });
      continue;
    }

    const role = message.role === "system" ? "developer" : message.role;
    const content = asText(message.content);
    if (content.length > 0 || !message.tool_calls?.length) {
      input.push({ role, content });
    }

    for (const call of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        ...(call.id && functionItemIds[call.id] ? { id: functionItemIds[call.id] } : {}),
        call_id: call.id ?? "",
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  return input;
}

function toOpenAITool(tool: ToolSpec): Record<string, unknown> {
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  };
}

function usageFromResponse(raw: OpenAIResponseBody["usage"]): Usage {
  const promptTokens = raw?.input_tokens ?? 0;
  const cacheHitTokens = raw?.input_tokens_details?.cached_tokens ?? 0;
  return new Usage(
    promptTokens,
    raw?.output_tokens ?? 0,
    raw?.total_tokens ?? promptTokens + (raw?.output_tokens ?? 0),
    cacheHitTokens,
    Math.max(0, promptTokens - cacheHitTokens),
  );
}

function finishReason(data: OpenAIResponseBody): string | undefined {
  if (data.status === "completed") return "stop";
  if (data.status === "incomplete") {
    return data.incomplete_details?.reason === "max_output_tokens" ? "length" : "incomplete";
  }
  return data.status;
}

function parseOutput(data: OpenAIResponseBody): {
  content: string;
  reasoningContent: string | null;
  toolCalls: ToolCall[];
  providerData?: Record<string, unknown>;
} {
  const output = data.output ?? [];
  const messageText: string[] = [];
  const reasoningSummary: string[] = [];
  const toolCalls: ToolCall[] = [];
  const reasoningItems: OpenAIResponseOutput[] = [];
  const functionItemIds: Record<string, string> = {};

  for (const item of output) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (part.type === "output_text" && typeof part.text === "string") {
          messageText.push(part.text);
        }
      }
    } else if (item.type === "function_call") {
      if (item.call_id && item.id) functionItemIds[item.call_id] = item.id;
      toolCalls.push({
        id: item.call_id ?? item.id,
        type: "function",
        function: {
          name: item.name ?? "",
          arguments: item.arguments ?? "{}",
        },
      });
    } else if (item.type === "reasoning") {
      reasoningItems.push(item);
      for (const part of item.summary ?? []) {
        if (typeof part.text === "string") reasoningSummary.push(part.text);
      }
    }
  }

  const providerData =
    reasoningItems.length > 0 || Object.keys(functionItemIds).length > 0
      ? { openaiResponses: { reasoningItems, functionItemIds } }
      : undefined;
  return {
    content: messageText.join("") || data.output_text || "",
    reasoningContent: reasoningSummary.join("\n") || null,
    toolCalls,
    providerData,
  };
}

export class OpenAIResponsesClient implements ChatProviderClient {
  readonly providerId = "openai";
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retry: RetryOptions;
  private readonly _fetch: typeof fetch;

  constructor(opts: OpenAIResponsesClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Export it before using the OpenAI provider.");
    }
    this.apiKey = apiKey;
    this.baseUrl = trimTrailingSlashes(
      opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    );
    this.timeoutMs = opts.timeoutMs ?? 660_000;
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.retry = opts.retry ?? {};
  }

  private buildPayload(opts: ChatRequestOptions): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: opts.model,
      input: toOpenAIResponsesInput(opts.messages),
      store: false,
      include: ["reasoning.encrypted_content"],
    };
    if (opts.tools?.length) payload.tools = opts.tools.map(toOpenAITool);
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) payload.max_output_tokens = opts.maxTokens;
    if (opts.userId) payload.safety_identifier = opts.userId;
    if (opts.responseFormat?.type === "json_object") {
      payload.text = { format: { type: "json_object" } };
    }
    const effort =
      opts.thinking === "disabled"
        ? "none"
        : opts.reasoningEffort === "max"
          ? "xhigh"
          : opts.reasoningEffort;
    if (effort) payload.reasoning = { effort };
    return payload;
  }

  async chat(opts: ChatRequestOptions): Promise<ChatResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const response = await fetchWithRetry(
      this._fetch,
      `${this.baseUrl}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildPayload(opts)),
        signal,
      },
      { ...this.retry, signal },
    );
    if (!response.ok) {
      throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as OpenAIResponseBody;
    if (data.error?.message) throw new Error(`OpenAI response failed: ${data.error.message}`);
    const parsed = parseOutput(data);
    return {
      ...parsed,
      usage: usageFromResponse(data.usage),
      finishReason: finishReason(data),
      raw: data,
    };
  }

  async *stream(opts: ChatRequestOptions): AsyncGenerator<StreamChunk> {
    const response = await this.chat(opts);
    if (response.reasoningContent) {
      yield { reasoningDelta: response.reasoningContent, raw: response.raw };
    }
    if (response.content) yield { contentDelta: response.content, raw: response.raw };
    if (response.toolCalls.length > 0) {
      yield {
        toolCallDeltas: response.toolCalls.map((call, index) => ({
          index,
          id: call.id,
          name: call.function.name,
          argumentsDelta: call.function.arguments,
        })),
        raw: response.raw,
      };
    }
    yield {
      usage: response.usage,
      finishReason: response.finishReason,
      providerData: response.providerData,
      raw: response.raw,
    };
  }

  async listModels(opts: { signal?: AbortSignal } = {}): Promise<ModelList | null> {
    try {
      const response = await this._fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: opts.signal,
      });
      if (!response.ok) return null;
      const data = (await response.json()) as ModelList;
      return Array.isArray(data.data) ? data : null;
    } catch {
      return null;
    }
  }

  async getBalance(_opts: { signal?: AbortSignal } = {}): Promise<UserBalance | null> {
    return null;
  }
}
