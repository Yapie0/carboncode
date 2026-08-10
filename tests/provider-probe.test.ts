import { describe, expect, it, vi } from "vitest";
import {
  inferWireApiForModel,
  isLikelyAgentModel,
  normalizeProviderApiKey,
  normalizeProviderBaseUrl,
  probeOpenAICompatibleProvider,
  recommendProviderModel,
} from "../src/provider-probe.js";

describe("provider probe", () => {
  it("normalizes a compatible provider base URL", () => {
    expect(normalizeProviderBaseUrl(" https://gateway.example/v1/// ")).toBe(
      "https://gateway.example/v1",
    );
    expect(normalizeProviderBaseUrl("file:///tmp/provider")).toBeNull();
    expect(normalizeProviderBaseUrl("https://gateway.example/v1/models?ignored=1")).toBe(
      "https://gateway.example/v1",
    );
    expect(normalizeProviderBaseUrl("https://gateway.example/v1/responses")).toBe(
      "https://gateway.example/v1",
    );
  });

  it("reads and sorts an OpenAI-compatible model catalog", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: "gpt-5.1" }, { id: "gpt-4.1" }, { id: "gpt-5.1" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const result = await probeOpenAICompatibleProvider({
      baseUrl: "https://gateway.example/v1/",
      apiKey: "sk-provider-test-123456",
      fetch,
    });

    expect(result).toEqual({
      ok: true,
      baseUrl: "https://gateway.example/v1",
      modelsEndpoint: "https://gateway.example/v1/models",
      models: ["gpt-4.1", "gpt-5.1"],
      recommendedModel: "gpt-5.1",
      providerName: "gateway.example",
      wireApi: "responses",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://gateway.example/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-provider-test-123456" }),
      }),
    );
  });

  it("returns only agent-capable models from a mixed provider catalog", async () => {
    const result = await probeOpenAICompatibleProvider({
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-provider-test-123456",
      fetch: async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-5.5" },
              { id: "gpt-image-1" },
              { id: "text-embedding-3-large" },
              { id: "codex-auto-review" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    expect(result).toMatchObject({
      ok: true,
      models: ["gpt-5.5"],
      recommendedModel: "gpt-5.5",
    });
  });

  it("tries both conventional catalog roots and returns the working API base", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://relay.example/models")
        return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({ data: [{ id: "qwen-plus" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await probeOpenAICompatibleProvider({
      baseUrl: "https://relay.example",
      apiKey: "sk-test",
      fetch,
    });
    expect(result).toMatchObject({
      ok: true,
      baseUrl: "https://relay.example/v1",
      recommendedModel: "qwen-plus",
      wireApi: "chat_completions",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("recommends stable agent models and infers the matching protocol", () => {
    expect(
      recommendProviderModel(["text-embedding-3-large", "gpt-image-1", "gpt-5.6-luna", "gpt-5.5"]),
    ).toBe("gpt-5.5");
    expect(inferWireApiForModel("gpt-5.5")).toBe("responses");
    expect(inferWireApiForModel("deepseek-chat")).toBe("chat_completions");
  });

  it("excludes specialized review, media, and embedding routes from agent models", () => {
    expect(isLikelyAgentModel("gpt-5.6-luna")).toBe(true);
    expect(isLikelyAgentModel("codex-auto-review")).toBe(false);
    expect(isLikelyAgentModel("gpt-4o-audio-preview")).toBe(false);
    expect(isLikelyAgentModel("gpt-image-2")).toBe(false);
    expect(isLikelyAgentModel("text-embedding-3-large")).toBe(false);
  });

  it("returns a bounded authentication error without response bodies", async () => {
    const result = await probeOpenAICompatibleProvider({
      baseUrl: "https://gateway.example/v1",
      apiKey: "sk-invalid-provider-test",
      fetch: async () => new Response("sensitive upstream body", { status: 401 }),
    });

    expect(result).toEqual({
      ok: false,
      baseUrl: "https://gateway.example/v1",
      code: "unauthorized",
      message: "The provider rejected this API key.",
      httpStatus: 401,
    });
    expect(JSON.stringify(result)).not.toContain("sensitive upstream body");
  });

  it("requires a key before making a network request", async () => {
    const fetch = vi.fn();
    const result = await probeOpenAICompatibleProvider({
      baseUrl: "https://gateway.example/v1",
      apiKey: "",
      fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "api_key_required" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes a pasted Bearer prefix and rejects non-ASCII header values", async () => {
    expect(normalizeProviderApiKey("  Bearer sk-provider-test  ")).toBe("sk-provider-test");
    const fetch = vi.fn();
    const result = await probeOpenAICompatibleProvider({
      baseUrl: "https://gateway.example/v1",
      apiKey: "帮我配置这个模型",
      fetch,
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_api_key" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
