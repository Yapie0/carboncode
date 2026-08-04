import { describe, expect, it } from "vitest";
import {
  candidateAvailability,
  createProviderClient,
  resolveMultiAgentCandidates,
} from "../src/providers/registry.js";

describe("multi-agent provider registry", () => {
  it("offers multiple providers by default without embedding credentials", () => {
    const candidates = resolveMultiAgentCandidates({});
    expect(new Set(candidates.map((candidate) => candidate.provider))).toEqual(
      new Set(["deepseek", "openai"]),
    );
    expect(JSON.stringify(candidates)).not.toContain("apiKey");
  });

  it("reports availability using environment variable references", () => {
    const candidate = { id: "openai-test", provider: "openai" as const, model: "gpt-test" };
    expect(candidateAvailability(candidate, {}, {}).available).toBe(false);
    expect(candidateAvailability(candidate, {}, { OPENAI_API_KEY: "sk-test" }).available).toBe(
      true,
    );
  });

  it("uses a configured environment variable without storing its value", () => {
    const candidate = {
      id: "private-openai",
      provider: "openai" as const,
      model: "gpt-test",
      apiKeyEnv: "MY_OPENAI_KEY",
    };
    const client = createProviderClient(candidate, {}, { MY_OPENAI_KEY: "secret-value" });
    expect(client.providerId).toBe("openai");
    expect(client.apiKey).toBe("secret-value");
  });

  it("rejects duplicate candidate ids", () => {
    expect(() =>
      resolveMultiAgentCandidates({
        experimental: {
          multiAgent: {
            candidates: [
              { id: "same", provider: "openai", model: "one" },
              { id: "same", provider: "deepseek", model: "two" },
            ],
          },
        },
      }),
    ).toThrow(/duplicate multi-agent candidate id/);
  });
});
