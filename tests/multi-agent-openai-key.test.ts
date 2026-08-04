import { describe, expect, it, vi } from "vitest";
import { setOpenAIKeyForSession } from "../src/multi-agent/openai-key.js";

describe("multi-agent OpenAI session key", () => {
  it("validates before exposing the key to the process", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const result = await setOpenAIKeyForSession("sk-1234567890abcdefgh", {
        fetch: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                object: "list",
                data: [{ id: "gpt-test", object: "model", owned_by: "openai" }],
              }),
              { status: 200 },
            ),
        ) as typeof fetch,
      });

      expect(result).toEqual({ ok: true, modelCount: 1, modelIds: ["gpt-test"] });
      expect(process.env.OPENAI_API_KEY).toBe("sk-1234567890abcdefgh");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not expose a rejected key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const result = await setOpenAIKeyForSession("sk-1234567890abcdefgh", {
        fetch: vi.fn(async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
      });

      expect(result).toMatchObject({ ok: false });
      expect(process.env.OPENAI_API_KEY).toBe("");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
