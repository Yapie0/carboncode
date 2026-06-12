import {
  type ModelCallRecord,
  type ModelGatewayRequest,
  type ModelGatewayRoute,
  type ModelProvider,
  type ModelProviderStatus,
  createModelCallRecord,
  createModelGatewayRequest,
  routeModelRequest,
} from "./core.js";

export interface ModelGatewayUsageSummary {
  totalCalls: number;
  failedCalls: number;
  totalCost: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export interface MemoryModelGatewayOptions {
  now?: () => number;
}

export class MemoryModelGateway {
  private readonly now: () => number;
  private readonly providers = new Map<string, ModelProvider>();
  private readonly calls: ModelCallRecord[] = [];

  constructor(opts: MemoryModelGatewayOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  upsertProvider(provider: ModelProvider): ModelProvider {
    const next = cloneProvider(provider);
    this.providers.set(next.id, next);
    return cloneProvider(next);
  }

  setProviderStatus(id: string, status: ModelProviderStatus): ModelProvider {
    const provider = this.requireProvider(id);
    const next = { ...provider, status };
    this.providers.set(id, next);
    return cloneProvider(next);
  }

  route(
    input: Omit<ModelGatewayRequest, "metadata"> & { metadata?: Record<string, string> },
  ): ModelGatewayRoute | undefined {
    const request = createModelGatewayRequest(input);
    return routeModelRequest([...this.providers.values()], request);
  }

  recordSuccess(input: {
    request: ModelGatewayRequest;
    providerId: string;
    completionTokens: number;
    startedAtMs?: number;
  }): ModelCallRecord {
    const provider = this.requireProvider(input.providerId);
    const record = createModelCallRecord({
      request: input.request,
      provider,
      completionTokens: input.completionTokens,
      startedAtMs: input.startedAtMs ?? this.now(),
      finishedAtMs: this.now(),
      status: "succeeded",
    });
    this.calls.push(record);
    return { ...record };
  }

  recordFailure(input: {
    request: ModelGatewayRequest;
    providerId: string;
    error: string;
    startedAtMs?: number;
  }): ModelCallRecord {
    const provider = this.requireProvider(input.providerId);
    const record = createModelCallRecord({
      request: input.request,
      provider,
      completionTokens: 0,
      startedAtMs: input.startedAtMs ?? this.now(),
      finishedAtMs: this.now(),
      status: "failed",
      error: input.error,
    });
    this.calls.push(record);
    return { ...record };
  }

  listProviders(): ModelProvider[] {
    return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id)).map(cloneProvider);
  }

  listCalls(providerId?: string): ModelCallRecord[] {
    return this.calls
      .filter((call) => providerId === undefined || call.providerId === providerId)
      .map((call) => ({ ...call }));
  }

  usage(providerId?: string): ModelGatewayUsageSummary {
    const calls = this.listCalls(providerId);
    return {
      totalCalls: calls.length,
      failedCalls: calls.filter((call) => call.status === "failed").length,
      totalCost: roundCost(calls.reduce((sum, call) => sum + call.cost, 0)),
      totalPromptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
      totalCompletionTokens: calls.reduce((sum, call) => sum + call.completionTokens, 0),
    };
  }

  private requireProvider(id: string): ModelProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`model provider not found: ${id}`);
    return provider;
  }
}

function cloneProvider(provider: ModelProvider): ModelProvider {
  return { ...provider, models: [...provider.models] };
}

function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000;
}
