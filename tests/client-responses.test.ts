import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import type { ChatMessage, ToolSpec } from "../src/types.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responsesSse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(`${body}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const readTool: ToolSpec = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

describe("OpenAI Responses compatibility", () => {
  it("builds and parses a non-streaming Responses request", async () => {
    let url = "";
    let body: any;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return json({
        id: "resp_1",
        object: "response",
        status: "completed",
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "checked" }] },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "OK" }],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 3,
          total_tokens: 13,
          input_tokens_details: { cached_tokens: 4 },
        },
      });
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      reasoningEffortMax: "auto",
      maxTools: null,
      sendThinking: false,
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const response = await client.chat({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: "Be concise." },
        { role: "user", content: "Say OK" },
      ],
      tools: [readTool],
      reasoningEffort: "max",
      maxTokens: 64,
      userId: "installation-1",
    });

    expect(url).toBe("https://relay.example/responses");
    expect(body).toMatchObject({
      model: "gpt-5.5",
      stream: false,
      store: false,
      max_output_tokens: 64,
      reasoning: { effort: "xhigh", summary: "auto" },
      include: ["reasoning.encrypted_content"],
      safety_identifier: "installation-1",
    });
    expect(body.input).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Say OK" },
    ]);
    expect(body.tools[0]).toEqual({
      type: "function",
      name: "read_file",
      description: "Read a file",
      parameters: readTool.function.parameters,
    });
    expect(response.content).toBe("OK");
    expect(response.reasoningContent).toBe("checked");
    expect(response.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 3,
      promptCacheHitTokens: 4,
      promptCacheMissTokens: 6,
    });
    expect(response.finishReason).toBe("stop");
    expect(response.providerItems).toHaveLength(2);
  });

  it("parses Responses streaming text, reasoning, tools, usage, and native items", async () => {
    const output = [
      { type: "reasoning", id: "rs_1", summary: [] },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "read_file",
        arguments: '{"path":"a.txt"}',
      },
    ];
    const fetch = vi.fn(async () =>
      responsesSse([
        { type: "response.reasoning_summary_text.delta", delta: "thinking" },
        { type: "response.output_text.delta", delta: "hello" },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file" },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          delta: '{"path":"a.txt"}',
        },
        {
          type: "response.completed",
          response: {
            status: "completed",
            output,
            usage: {
              input_tokens: 8,
              output_tokens: 4,
              total_tokens: 12,
              input_tokens_details: { cached_tokens: 5 },
            },
          },
        },
      ]),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      wireApi: "responses",
      reasoningEffortMax: "auto",
      maxTools: null,
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "read" }],
      tools: [readTool],
      reasoningEffort: "max",
    })) {
      chunks.push(chunk);
    }
    expect(chunks.some((chunk) => chunk.reasoningDelta === "thinking")).toBe(true);
    expect(chunks.some((chunk) => chunk.contentDelta === "hello")).toBe(true);
    expect(chunks.flatMap((chunk) => chunk.toolCallDeltas ?? [])).toEqual([
      { index: 1, id: "call_1", name: "read_file" },
      { index: 1, argumentsDelta: '{"path":"a.txt"}' },
    ]);
    expect(chunks.at(-1)?.usage?.totalTokens).toBe(12);
    expect(chunks.at(-1)?.finishReason).toBe("tool_calls");
    expect(chunks.at(-1)?.providerItems).toEqual(output);
  });

  it("recovers text carried only by the terminal Responses event", async () => {
    const fetch = vi.fn(async () =>
      responsesSse([
        {
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "terminal only" }],
              },
            ],
            usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
          },
        },
      ]),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.contentDelta ?? "").join("")).toBe("terminal only");
    expect(chunks.at(-1)?.finishReason).toBe("stop");
  });

  it("rejects a completed Responses stream with no semantic output", async () => {
    const fetch = vi.fn(async () =>
      responsesSse([
        {
          type: "response.completed",
          response: {
            status: "completed",
            output: [],
            usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          },
        },
      ]),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const consume = async () => {
      for await (const _chunk of client.stream({
        model: "missing-model",
        messages: [{ role: "user", content: "hello" }],
      })) {
        // Consume the complete stream so terminal validation runs.
      }
    };

    await expect(consume()).rejects.toThrow(/completed response without text/i);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries transient empty Responses streams before exposing failure", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      return responsesSse([
        {
          type: "response.completed",
          response: {
            status: "completed",
            output:
              attempt < 3
                ? []
                : [
                    {
                      type: "message",
                      role: "assistant",
                      content: [{ type: "output_text", text: "recovered stream" }],
                    },
                  ],
            usage: { input_tokens: 1, output_tokens: attempt < 3 ? 0 : 2, total_tokens: 3 },
          },
        },
      ]);
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "intermittent-model",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.contentDelta ?? "").join("")).toBe("recovered stream");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries a transient terminal response failure before any output", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? responsesSse([
            {
              type: "response.failed",
              response: {
                status: "failed",
                output: [],
                error: { message: "Upstream request failed", code: "server_error" },
              },
            },
          ])
        : responsesSse([
            {
              type: "response.completed",
              response: {
                status: "completed",
                output: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: "recovered upstream" }],
                  },
                ],
                usage: {},
              },
            },
          ]);
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "intermittent-model",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.contentDelta ?? "").join("")).toBe("recovered upstream");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not replay a failed stream after it has emitted meaningful output", async () => {
    const fetch = vi.fn(async () =>
      responsesSse([
        { type: "response.output_text.delta", delta: "partial" },
        {
          type: "response.failed",
          response: {
            status: "failed",
            output: [],
            error: { message: "Upstream request failed", code: "server_error" },
          },
        },
      ]),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const consume = async () => {
      for await (const _chunk of client.stream({
        model: "intermittent-model",
        messages: [{ role: "user", content: "hello" }],
      })) {
        // Consume the stream until the terminal failure is surfaced.
      }
    };

    await expect(consume()).rejects.toThrow(/Upstream request failed.*server_error/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a completed non-stream response with no semantic output", async () => {
    const fetch = vi.fn(async () =>
      json({ status: "completed", output: [], usage: { input_tokens: 0, output_tokens: 0 } }),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    await expect(
      client.chat({
        model: "missing-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(/completed response without text/i);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries transient empty non-stream responses before exposing failure", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      return json({
        status: "completed",
        output:
          attempt < 3
            ? []
            : [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "recovered response" }],
                },
              ],
        usage: { input_tokens: 1, output_tokens: attempt < 3 ? 0 : 2 },
      });
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const response = await client.chat({
      model: "intermittent-model",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.content).toBe("recovered response");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries a transient non-stream Responses failure and preserves final details", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? json({
            status: "failed",
            output: [],
            error: { message: "Upstream request failed", type: "server_error" },
          })
        : json({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "recovered response" }],
              },
            ],
            usage: {},
          });
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      providerName: "Relay",
      wireApi: "responses",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    const response = await client.chat({
      model: "intermittent-model",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.content).toBe("recovered response");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("round-trips native Responses items with function output", async () => {
    const bodies: any[] = [];
    const firstItems = [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "read_file",
        arguments: '{"path":"a.txt"}',
      },
    ];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return json({ status: "completed", output: firstItems, usage: {} });
      }
      return json({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "done" }],
          },
        ],
        usage: {},
      });
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      wireApi: "responses",
      maxTools: null,
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });
    const first = await client.chat({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "read" }],
      tools: [readTool],
    });
    const continuation: ChatMessage[] = [
      { role: "user", content: "read" },
      {
        role: "assistant",
        content: "",
        tool_calls: first.toolCalls,
        provider_items: first.providerItems,
      },
      { role: "tool", tool_call_id: "call_1", content: "file contents" },
    ];
    await client.chat({ model: "gpt-5.5", messages: continuation, tools: [readTool] });

    expect(bodies[1].input).toEqual([
      { role: "user", content: "read" },
      ...firstItems,
      { type: "function_call_output", call_id: "call_1", output: "file contents" },
    ]);
  });

  it("learns a supported reasoning effort only from explicit validation errors", async () => {
    const efforts: Array<string | undefined> = [];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      efforts.push(body.reasoning_effort);
      if (body.reasoning_effort !== "high") {
        return json(
          {
            error: {
              message: "reasoning_effort: unknown variant; expected one of low, medium, high",
            },
          },
          422,
        );
      }
      return json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example/v1",
      wireApi: "chat_completions",
      reasoningEffortMax: "max",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });

    await client.chat({ model: "relay-model", messages: [], reasoningEffort: "max" });
    await client.chat({ model: "relay-model", messages: [], reasoningEffort: "max" });
    expect(efforts).toEqual(["max", "xhigh", "high", "high"]);
  });

  it("does not switch protocols or duplicate a request after authentication failure", async () => {
    const fetch = vi.fn(async () => json({ error: { message: "invalid key" } }, 401));
    const client = new DeepSeekClient({
      apiKey: "invalid",
      baseUrl: "https://relay.example",
      wireApi: "auto",
      reasoningEffortMax: "auto",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });
    await expect(
      client.chat({ model: "gpt-5.5", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/401/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back between conventional endpoint roots and protocols only on route mismatch", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/chat/completions")) {
        return json({ choices: [{ message: { content: "chat works" }, finish_reason: "stop" }] });
      }
      return json({ error: "route not found" }, 404);
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      baseUrl: "https://relay.example",
      wireApi: "auto",
      reasoningEffortMax: "auto",
      fetch: fetch as typeof globalThis.fetch,
      retry: { maxAttempts: 1 },
    });
    const result = await client.chat({ model: "gpt-5.5", messages: [] });
    expect(result.content).toBe("chat works");
    expect(urls).toEqual([
      "https://relay.example/responses",
      "https://relay.example/v1/responses",
      "https://relay.example/chat/completions",
    ]);
  });
});
