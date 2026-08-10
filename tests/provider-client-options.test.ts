import { describe, expect, it } from "vitest";
import type { ActiveModelProvider } from "../src/config.js";
import { providerClientOptions } from "../src/provider-client-options.js";

describe("provider client options", () => {
  it("keeps DeepSeek extensions and its provider tool cap", () => {
    const provider: ActiveModelProvider = {
      id: "deepseek",
      kind: "deepseek",
      name: "DeepSeek",
      apiKey: "sk-deepseek-test",
      baseUrl: "https://api.deepseek.com",
      reasoningEffortMax: "max",
      wireApi: "chat_completions",
    };
    expect(providerClientOptions(provider)).toMatchObject({
      providerName: "DeepSeek",
      wireApi: "chat_completions",
      reasoningEffortMax: "max",
      maxTools: 128,
      sendThinking: true,
    });
  });

  it("uses adaptive standards mode without DeepSeek-only payload fields", () => {
    const provider: ActiveModelProvider = {
      id: "custom-test",
      kind: "custom",
      name: "Compatible relay",
      apiKey: "opaque-provider-token",
      baseUrl: "https://relay.example/v1",
      model: "gpt-5.5",
      reasoningEffortMax: "auto",
      wireApi: "auto",
    };
    expect(providerClientOptions(provider)).toEqual({
      apiKey: "opaque-provider-token",
      baseUrl: "https://relay.example/v1",
      providerName: "Compatible relay",
      reasoningEffortMax: "auto",
      wireApi: "auto",
      maxTools: null,
      sendThinking: false,
    });
  });

  it("allows command-specific overrides without losing provider defaults", () => {
    const provider: ActiveModelProvider = {
      id: "custom-test",
      kind: "custom",
      name: "Relay",
      apiKey: "stored-token",
      baseUrl: "https://relay.example/v1",
      reasoningEffortMax: "auto",
      wireApi: "auto",
    };
    expect(
      providerClientOptions(provider, { apiKey: "session-token", timeoutMs: 1234 }),
    ).toMatchObject({
      apiKey: "session-token",
      baseUrl: "https://relay.example/v1",
      wireApi: "auto",
      timeoutMs: 1234,
    });
  });
});
