import { describe, expect, it } from "vitest";
import {
  type ModelProvider,
  chooseModelProvider,
  createModelCallRecord,
  createModelGatewayRequest,
  estimateModelCost,
  modelRetryDelayMs,
  routeModelRequest,
  shouldRetryModelCall,
} from "../src/mwh/modules/ai-infra/model-gateway/core.js";
import { MemoryModelGateway } from "../src/mwh/modules/ai-infra/model-gateway/memory-gateway.js";

const providers: ModelProvider[] = [
  {
    id: "cheap",
    models: ["chat"],
    priority: 5,
    status: "healthy",
    inputCostPer1kTokens: 0.001,
    outputCostPer1kTokens: 0.002,
    maxInputTokens: 8_000,
  },
  {
    id: "fast",
    models: ["chat", "reasoning"],
    priority: 10,
    status: "healthy",
    inputCostPer1kTokens: 0.002,
    outputCostPer1kTokens: 0.004,
  },
  {
    id: "disabled",
    models: ["chat"],
    priority: 100,
    status: "disabled",
    inputCostPer1kTokens: 0,
    outputCostPer1kTokens: 0,
  },
];

describe("MWH model-gateway middleware", () => {
  it("creates requests and estimates model cost", () => {
    const request = createModelGatewayRequest({
      id: "req-1",
      model: "chat",
      promptTokens: 1_000,
      maxOutputTokens: 500,
      metadata: { tenant: "t1" },
    });

    expect(request).toEqual({
      id: "req-1",
      model: "chat",
      promptTokens: 1_000,
      maxOutputTokens: 500,
      metadata: { tenant: "t1" },
    });
    expect(estimateModelCost(providers[0]!, request)).toBe(0.002);
  });

  it("chooses healthy providers by status, priority, cost, and constraints", () => {
    const request = createModelGatewayRequest({
      id: "req-1",
      model: "chat",
      promptTokens: 1_000,
      maxOutputTokens: 500,
    });

    expect(chooseModelProvider(providers, request)?.id).toBe("fast");
    expect(
      chooseModelProvider(
        [{ ...providers[1]!, status: "degraded" }, providers[0]!, providers[2]!],
        request,
      )?.id,
    ).toBe("cheap");
    expect(chooseModelProvider(providers, { ...request, requiredProviderId: "cheap" })?.id).toBe(
      "cheap",
    );
    expect(chooseModelProvider(providers, { ...request, promptTokens: 9_000 })?.id).toBe("fast");
    expect(chooseModelProvider(providers, { ...request, model: "missing" })).toBeUndefined();
  });

  it("routes requests with estimated cost and creates call records", () => {
    const request = createModelGatewayRequest({
      id: "req-1",
      model: "chat",
      promptTokens: 1_000,
      maxOutputTokens: 500,
    });
    const route = routeModelRequest(providers, request);

    expect(route).toEqual(
      expect.objectContaining({
        provider: expect.objectContaining({ id: "fast" }),
        estimatedCost: 0.004,
      }),
    );
    expect(
      createModelCallRecord({
        request,
        provider: route!.provider,
        completionTokens: 250,
        startedAtMs: 1_000,
        finishedAtMs: 1_200,
        status: "succeeded",
      }),
    ).toEqual({
      id: "req-1",
      providerId: "fast",
      model: "chat",
      promptTokens: 1_000,
      completionTokens: 250,
      status: "succeeded",
      cost: 0.003,
      startedAtMs: 1_000,
      finishedAtMs: 1_200,
      error: undefined,
    });
  });

  it("decides transient retries and exponential retry delays", () => {
    expect(shouldRetryModelCall({ statusCode: 429, attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryModelCall({ statusCode: 503, attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryModelCall({ errorCode: "ETIMEDOUT", attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryModelCall({ statusCode: 400, attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(shouldRetryModelCall({ statusCode: 503, attempt: 3, maxAttempts: 3 })).toBe(false);
    expect(modelRetryDelayMs({ attempt: 3, baseDelayMs: 100, maxDelayMs: 500 })).toBe(400);
    expect(modelRetryDelayMs({ attempt: 5, baseDelayMs: 100, maxDelayMs: 500 })).toBe(500);
  });

  it("runs a stateful provider route, status, audit, and usage flow", () => {
    let now = 1_000;
    const gateway = new MemoryModelGateway({ now: () => now });
    for (const provider of providers) gateway.upsertProvider(provider);

    const route = gateway.route({
      id: "req-1",
      model: "chat",
      promptTokens: 1_000,
      maxOutputTokens: 500,
    });
    expect(route?.provider.id).toBe("fast");

    now = 1_200;
    gateway.recordSuccess({
      request: route!.request,
      providerId: route!.provider.id,
      completionTokens: 250,
      startedAtMs: 1_000,
    });
    gateway.setProviderStatus("fast", "disabled");
    expect(
      gateway.route({
        id: "req-2",
        model: "chat",
        promptTokens: 1_000,
        maxOutputTokens: 500,
      })?.provider.id,
    ).toBe("cheap");

    now = 1_300;
    const failedRoute = gateway.route({
      id: "req-3",
      model: "chat",
      promptTokens: 1_000,
      maxOutputTokens: 500,
    });
    gateway.recordFailure({
      request: failedRoute!.request,
      providerId: failedRoute!.provider.id,
      error: "429",
      startedAtMs: 1_250,
    });

    expect(gateway.usage()).toEqual({
      totalCalls: 2,
      failedCalls: 1,
      totalCost: 0.004,
      totalPromptTokens: 2_000,
      totalCompletionTokens: 250,
    });
    expect(gateway.listCalls("cheap")).toHaveLength(1);
    expect(gateway.listProviders().map((provider) => provider.id)).toEqual([
      "cheap",
      "disabled",
      "fast",
    ]);
  });
});
