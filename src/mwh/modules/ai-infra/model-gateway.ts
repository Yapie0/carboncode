import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Model Gateway Middleware

## Purpose

Use this module as a reusable reference for LLM/model gateway behavior: provider routing, model availability, cost estimation, retry decisions, provider health, and usage audit.

This module is separate from embedding retrieval. Embedding modules cache and search vectors; model gateway modules decide where a model request should go and how calls are accounted for.

## When To Use

- Route model calls across multiple providers or deployments.
- Need deterministic cost estimation before a call is made.
- Need provider health status and fallback behavior.
- Need usage/audit records for model calls.
- Need retry decisions for rate limits, timeouts, and transient 5xx errors.

## When Not To Use

- Do not hide provider-specific safety, privacy, or data residency requirements.
- Do not retry non-idempotent tool side effects without a higher-level idempotency key.
- Do not treat estimated cost as billing-grade truth.
- Do not store raw prompts in audit logs unless retention and privacy rules are explicit.

## Implementation Variants

- Memory gateway for tests and local prototypes.
- SQL audit table with provider/model/cost/token records.
- Redis/provider health cache for fast routing.
- OpenAI/Anthropic/DeepSeek/local model adapter layer.
- Policy adapter for tenant-level provider allow/deny rules.

## Recommended Architecture

- core.ts: pure request normalization, provider selection, cost estimation, retry delay, and call-record creation.
- memory-gateway.ts: stateful provider registry, status updates, route, success/failure records, and usage summary.
- adapters/provider-*.ts: provider-specific request/response mapping.
- adapters/sql-audit.ts: durable call audit storage.
- policy.ts: tenant, model, cost, and data residency routing constraints.

## Public API Sketch

\`\`\`ts
const gateway = new MemoryModelGateway();
gateway.upsertProvider({
  id: "deepseek",
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  priority: 10,
  status: "healthy",
  inputCostPer1kTokens: 0.001,
  outputCostPer1kTokens: 0.002,
});

const route = gateway.route({
  id: "req-1",
  model: "deepseek-v4-flash",
  promptTokens: 1000,
  maxOutputTokens: 500,
});
if (!route) throw new Error("no provider available");
\`\`\`

## Integration Rules

1. Keep routing deterministic and provider-neutral.
2. Filter disabled providers before degraded or healthy providers are ranked.
3. Account for prompt and completion tokens separately.
4. Record success and failure calls for audit and cost summaries.
5. Retry only transient failures such as 429, 5xx, timeout, or connection reset.
6. Keep raw prompt storage out of the gateway by default.

## Failure Modes

- Provider fallback violates tenant or data residency policy.
- Cost estimates differ from final provider billing.
- Retrying requests can duplicate downstream side effects.
- Disabled providers are accidentally routed when status is not checked.
- Audit logs leak prompt or user data.

## Security Notes

- Do not store raw prompts unless explicitly approved.
- Treat provider IDs, model names, and usage as operational metadata.
- Apply tenant/provider allow lists before route selection in production.
- Keep API keys in provider adapters, not in gateway records.

## Verification Checklist

- Stateless tests cover request validation, provider selection, required provider, model availability, max tokens, cost estimation, retry decisions, and call records.
- Stateful tests cover provider upsert, status updates, route, success/failure records, usage summaries, and provider isolation.
- Provider adapter tests should verify request/response mapping and error classification.
- Policy tests should verify tenant/model/provider constraints.

## Source References

- LLM gateway and model router patterns.
- Provider fallback and health-based routing.
- Token cost accounting and model usage audit.
- Exponential backoff for transient API errors.
`;

export const MODEL_GATEWAY_MODULE: MwhModule = {
  id: "model-gateway",
  title: "Model Gateway Middleware",
  summary:
    "Reusable AI model gateway reference with provider routing, cost estimation, retry decisions, provider health, and stateful usage audit tests.",
  version: "0.1.0",
  tags: ["ai-infra", "llm", "model-gateway", "routing", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
