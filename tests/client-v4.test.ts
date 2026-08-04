import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import type { ToolSpec } from "../src/types.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(frames: string[]): Response {
  return new Response(`${frames.map((frame) => `data: ${frame}\n\n`).join("")}data: [DONE]\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function tool(index: number): ToolSpec {
  return {
    type: "function",
    function: {
      name: `tool_${index}`,
      description: "test",
      parameters: { type: "object", properties: {} },
    },
  };
}

describe("DeepSeek V4 request and stream compatibility", () => {
  it("sends top-level thinking and requests terminal streaming usage", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return sseResponse([
        JSON.stringify({
          choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 2,
            completion_tokens: 1,
            total_tokens: 3,
            prompt_cache_hit_tokens: 1,
            prompt_cache_miss_tokens: 1,
          },
        }),
      ]);
    });
    const client = new DeepSeekClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
      thinking: "disabled",
      reasoningEffort: "high",
      maxTokens: 12_345,
      userId: "local-installation",
    })) {
      chunks.push(chunk);
    }

    expect(requestBody).toMatchObject({
      thinking: { type: "disabled" },
      reasoning_effort: "high",
      stream_options: { include_usage: true },
      max_tokens: 12_345,
      user_id: "local-installation",
    });
    expect(requestBody).not.toHaveProperty("extra_body");
    expect(chunks.at(-1)?.usage?.totalTokens).toBe(3);
  });

  it("emits every tool call delta from a single SSE frame", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-a",
                    function: { name: "read_file", arguments: '{"path":"a"}' },
                  },
                  {
                    index: 1,
                    id: "call-b",
                    function: { name: "read_file", arguments: '{"path":"b"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ]),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "deepseek-v4-pro",
      messages: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.toolCallDeltas).toHaveLength(2);
    expect(chunks[0]?.toolCallDeltas?.map((delta) => delta.index)).toEqual([0, 1]);
    expect(chunks[0]?.finishReason).toBe("tool_calls");
  });

  it("reports malformed SSE frames instead of silently swallowing them", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        "{not-json",
        JSON.stringify({ choices: [{ delta: { content: "still works" }, finish_reason: "stop" }] }),
      ]),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const chunks = [];
    for await (const chunk of client.stream({
      model: "deepseek-v4-flash",
      messages: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((chunk) => chunk.contentDelta === "still works")).toBe(true);
    expect(chunks.at(-1)?.malformedFrameCount).toBe(1);
  });

  it("rejects requests that expose more than 128 tools", async () => {
    const fetchMock = vi.fn();
    const client = new DeepSeekClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    await expect(
      client.chat({
        model: "deepseek-v4-pro",
        messages: [],
        tools: Array.from({ length: 129 }, (_, index) => tool(index)),
      }),
    ).rejects.toThrow(/at most 128 tools/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves non-streaming finish reasons", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: { role: "assistant", content: "partial" },
            finish_reason: "length",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      retry: { maxAttempts: 1 },
    });

    const result = await client.chat({
      model: "deepseek-v4-pro",
      messages: [],
    });

    expect(result.content).toBe("partial");
    expect(result.finishReason).toBe("length");
    expect(result.raw).toMatchObject({ choices: [{ finish_reason: "length" }] });
  });
});
