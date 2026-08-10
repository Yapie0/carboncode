export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  description?: string;
  enum?: unknown[];
  [k: string]: unknown;
}

export interface ToolFunctionSpec {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolSpec {
  type: "function";
  function: ToolFunctionSpec;
}

export interface ToolCall {
  id?: string;
  type?: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** Must round-trip in tool-loop continuations — thinking mode 400s without it. */
  reasoning_content?: string | null;
  /** Provider-native Responses items required for stateless tool continuations. */
  provider_items?: unknown[];
}

export interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface ChatRequestOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  /** DeepSeek response_format — use { type: "json_object" } to force valid JSON. */
  responseFormat?: { type: "json_object" | "text" };
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  /** Stable, non-PII identifier used by compatible providers for cache isolation. */
  userId?: string;
  /** Request a terminal usage-only SSE chunk. Defaults to true for streaming calls. */
  includeUsage?: boolean;
}
