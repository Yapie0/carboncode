import { describe, expect, it, vi } from "vitest";
import {
  OpenAIResponsesClient,
  toOpenAIResponsesInput,
} from "../src/providers/openai-responses.js";
import type { ChatMessage } from "../src/types.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAIResponsesClient", () => {
  it("maps Carbon Code messages and tools to the Responses API", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "resp_1",
        status: "completed",
        output: [
          {
            type: "reasoning",
            id: "rs_1",
            encrypted_content: "opaque-state",
            summary: [{ type: "summary_text", text: "Checked the repository." }],
          },
          {
            type: "message",
            content: [{ type: "output_text", text: "I need one file." }],
          },
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "read_file",
            arguments: '{"path":"README.md"}',
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 40 },
        },
      }),
    );
    const client = new OpenAIResponsesClient({
      apiKey: "sk-test",
      fetch: fetchMock as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const response = await client.chat({
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: "You are a coding agent." },
        { role: "user", content: "Inspect the README." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read one file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ],
      reasoningEffort: "high",
      maxTokens: 1024,
      userId: "stable-user",
    });

    expect(response.content).toBe("I need one file.");
    expect(response.reasoningContent).toBe("Checked the repository.");
    expect(response.toolCalls[0]?.function.name).toBe("read_file");
    expect(response.usage.promptCacheHitTokens).toBe(40);
    expect(response.providerData).toEqual({
      openaiResponses: {
        reasoningItems: [expect.objectContaining({ id: "rs_1" })],
        functionItemIds: { call_1: "fc_1" },
      },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: 1024,
      safety_identifier: "stable-user",
      reasoning: { effort: "high" },
    });
    expect(payload.input[0]).toEqual({ role: "developer", content: "You are a coding agent." });
    expect(payload.tools[0]).toMatchObject({ type: "function", name: "read_file" });
  });

  it("round-trips opaque reasoning state before function outputs", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"README.md"}' },
          },
        ],
        provider_data: {
          openaiResponses: {
            reasoningItems: [{ type: "reasoning", id: "rs_1", encrypted_content: "opaque-state" }],
            functionItemIds: { call_1: "fc_1" },
          },
        },
      },
      { role: "tool", tool_call_id: "call_1", content: "# Carbon Code" },
    ];

    expect(toOpenAIResponsesInput(messages)).toEqual([
      { type: "reasoning", id: "rs_1", encrypted_content: "opaque-state" },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
      { type: "function_call_output", call_id: "call_1", output: "# Carbon Code" },
    ]);
  });

  it("maps Carbon Code max reasoning to the Responses xhigh wire value", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = new OpenAIResponsesClient({
      apiKey: "sk-test",
      fetch: vi.fn(async (_url, init) => {
        payload = JSON.parse(String(init?.body));
        return jsonResponse({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
        });
      }) as typeof fetch,
    });

    await client.chat({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "hello" }],
      reasoningEffort: "max",
    });
    expect(payload).toMatchObject({ reasoning: { effort: "xhigh" } });
  });

  it("adapts a completed response to the existing stream contract", async () => {
    const client = new OpenAIResponsesClient({
      apiKey: "sk-test",
      fetch: vi.fn(async () =>
        jsonResponse({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        }),
      ) as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "hello" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.contentDelta).filter(Boolean)).toEqual(["done"]);
    expect(chunks.at(-1)?.usage?.totalTokens).toBe(5);
    expect(chunks.at(-1)?.finishReason).toBe("stop");
  });

  it("does not persist or infer a missing API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      expect(() => new OpenAIResponsesClient()).toThrow(/OPENAI_API_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
