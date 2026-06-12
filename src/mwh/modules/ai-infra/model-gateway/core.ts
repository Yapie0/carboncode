export type ModelProviderStatus = "healthy" | "degraded" | "disabled";

export interface ModelProvider {
  id: string;
  models: readonly string[];
  priority: number;
  status: ModelProviderStatus;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  maxInputTokens?: number;
}

export interface ModelGatewayRequest {
  id: string;
  model: string;
  promptTokens: number;
  maxOutputTokens: number;
  requiredProviderId?: string;
  metadata?: Record<string, string>;
}

export interface ModelGatewayRoute {
  provider: ModelProvider;
  request: ModelGatewayRequest;
  estimatedCost: number;
}

export interface ModelCallRecord {
  id: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  status: "succeeded" | "failed";
  cost: number;
  startedAtMs: number;
  finishedAtMs: number;
  error?: string;
}

export function createModelGatewayRequest(input: {
  id: string;
  model: string;
  promptTokens: number;
  maxOutputTokens: number;
  requiredProviderId?: string;
  metadata?: Record<string, string>;
}): ModelGatewayRequest {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.model, "model");
  assertPositiveInteger(input.promptTokens, "promptTokens");
  assertPositiveInteger(input.maxOutputTokens, "maxOutputTokens");
  return {
    id: input.id,
    model: input.model,
    promptTokens: input.promptTokens,
    maxOutputTokens: input.maxOutputTokens,
    requiredProviderId: input.requiredProviderId,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function chooseModelProvider(
  providers: readonly ModelProvider[],
  request: ModelGatewayRequest,
): ModelProvider | undefined {
  validateRequest(request);
  return providers
    .filter((provider) => provider.status !== "disabled")
    .filter((provider) => provider.models.includes(request.model))
    .filter(
      (provider) =>
        request.requiredProviderId === undefined || provider.id === request.requiredProviderId,
    )
    .filter(
      (provider) =>
        provider.maxInputTokens === undefined || request.promptTokens <= provider.maxInputTokens,
    )
    .sort(
      (left, right) =>
        statusRank(left.status) - statusRank(right.status) ||
        right.priority - left.priority ||
        estimateModelCost(left, request) - estimateModelCost(right, request) ||
        left.id.localeCompare(right.id),
    )[0];
}

export function routeModelRequest(
  providers: readonly ModelProvider[],
  request: ModelGatewayRequest,
): ModelGatewayRoute | undefined {
  const provider = chooseModelProvider(providers, request);
  if (!provider) return undefined;
  return {
    provider: { ...provider, models: [...provider.models] },
    request: { ...request, metadata: request.metadata ? { ...request.metadata } : undefined },
    estimatedCost: estimateModelCost(provider, request),
  };
}

export function estimateModelCost(provider: ModelProvider, request: ModelGatewayRequest): number {
  validateProvider(provider);
  validateRequest(request);
  return roundCost(
    (request.promptTokens / 1_000) * provider.inputCostPer1kTokens +
      (request.maxOutputTokens / 1_000) * provider.outputCostPer1kTokens,
  );
}

export function createModelCallRecord(input: {
  request: ModelGatewayRequest;
  provider: ModelProvider;
  completionTokens: number;
  startedAtMs: number;
  finishedAtMs: number;
  status: ModelCallRecord["status"];
  error?: string;
}): ModelCallRecord {
  validateRequest(input.request);
  validateProvider(input.provider);
  assertNonNegativeInteger(input.completionTokens, "completionTokens");
  assertNonNegativeInteger(input.startedAtMs, "startedAtMs");
  assertNonNegativeInteger(input.finishedAtMs, "finishedAtMs");
  if (input.finishedAtMs < input.startedAtMs) {
    throw new Error("finishedAtMs must be >= startedAtMs");
  }
  return {
    id: input.request.id,
    providerId: input.provider.id,
    model: input.request.model,
    promptTokens: input.request.promptTokens,
    completionTokens: input.completionTokens,
    status: input.status,
    cost: roundCost(
      (input.request.promptTokens / 1_000) * input.provider.inputCostPer1kTokens +
        (input.completionTokens / 1_000) * input.provider.outputCostPer1kTokens,
    ),
    startedAtMs: input.startedAtMs,
    finishedAtMs: input.finishedAtMs,
    error: input.error,
  };
}

export function shouldRetryModelCall(input: {
  statusCode?: number;
  errorCode?: string;
  attempt: number;
  maxAttempts: number;
}): boolean {
  assertPositiveInteger(input.attempt, "attempt");
  assertPositiveInteger(input.maxAttempts, "maxAttempts");
  if (input.attempt >= input.maxAttempts) return false;
  if (input.statusCode === 429) return true;
  if (input.statusCode !== undefined && input.statusCode >= 500) return true;
  return ["ETIMEDOUT", "ECONNRESET", "RATE_LIMITED"].includes(input.errorCode ?? "");
}

export function modelRetryDelayMs(input: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
}): number {
  assertPositiveInteger(input.attempt, "attempt");
  assertPositiveInteger(input.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(input.maxDelayMs, "maxDelayMs");
  return Math.min(input.maxDelayMs, input.baseDelayMs * 2 ** (input.attempt - 1));
}

function statusRank(status: ModelProviderStatus): number {
  if (status === "healthy") return 0;
  if (status === "degraded") return 1;
  return 2;
}

function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function validateRequest(request: ModelGatewayRequest): void {
  assertNonEmpty(request.id, "request.id");
  assertNonEmpty(request.model, "request.model");
  assertPositiveInteger(request.promptTokens, "request.promptTokens");
  assertPositiveInteger(request.maxOutputTokens, "request.maxOutputTokens");
}

function validateProvider(provider: ModelProvider): void {
  assertNonEmpty(provider.id, "provider.id");
  if (!provider.models.length) throw new Error("provider.models is required");
  if (!Number.isInteger(provider.priority)) throw new Error("provider.priority must be an integer");
  if (!["healthy", "degraded", "disabled"].includes(provider.status)) {
    throw new Error("provider.status is invalid");
  }
  assertNonNegativeNumber(provider.inputCostPer1kTokens, "inputCostPer1kTokens");
  assertNonNegativeNumber(provider.outputCostPer1kTokens, "outputCostPer1kTokens");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertNonNegativeNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be >= 0`);
}
