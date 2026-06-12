import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Token Budget Manager

## Purpose

Use this module as a reusable reference for managing model context budgets: reserve output tokens, account for system prompt tokens, select prompt/context fragments by priority, drop overflow safely, and audit prompt/completion token usage.

This module deliberately does not bind to one tokenizer. Production adapters can provide exact token counts from tiktoken, DeepSeek/OpenAI tokenizers, or local model tokenizers while reusing the same planning contract.

## When To Use

- Need deterministic context selection before model-gateway calls.
- Need to reserve completion tokens while packing prompt fragments.
- Need priority-aware prompt, retrieval, memory, and tool-result trimming.
- Need token usage audit records per request, task, tenant, or model.
- Need tests before integrating provider-specific tokenizers.

## When Not To Use

- Do not rely on estimated token counts for hard provider limits without a tokenizer adapter.
- Do not drop safety, system, or policy fragments by treating all fragments equally.
- Do not store sensitive prompt fragments in long-retention audit logs.
- Do not assume higher priority means semantically better context.

## Implementation Variants

- Memory manager for tests and local prototypes.
- Tokenizer adapter for tiktoken, DeepSeek, OpenAI, Anthropic, or local models.
- SQL usage audit table for tenant/model request summaries.
- Retriever integration that converts vector-search results into budgeted fragments.
- Prompt registry integration that accounts for rendered prompt templates.

## Recommended Architecture

- core.ts: pure fragment validation, available-input calculation, priority packing, usage records, summaries, and clone helpers.
- memory-manager.ts: stateful policy, fragment registry, planning, usage audit, and summary behavior.
- adapters/tokenizer.ts: exact token counts for provider/model pairs.
- integrations/retriever.ts: budget vector-search-adapter results before prompt assembly.
- integrations/model-gateway.ts: attach prompt/completion token audit to model calls.

## Public API Sketch

\`\`\`ts
const manager = new MemoryTokenBudgetManager({
  policy: { maxInputTokens: 8192, reservedOutputTokens: 1024, systemTokens: 500 },
});
manager.upsertFragment({ id: "system", tokens: 500, priority: 100, content: "..." });
manager.upsertFragment({ id: "retrieval-1", tokens: 1200, priority: 20, content: "..." });

const plan = manager.plan();
manager.recordUsage({ id: "req-1", promptTokens: plan.usedInputTokens, completionTokens: 300 });
\`\`\`

## Integration Rules

1. Reserve completion tokens before selecting input fragments.
2. Give safety/system/policy fragments high priority.
3. Use exact tokenizers before calling providers with strict limits.
4. Treat dropped fragments as observable planning output.
5. Audit prompt and completion tokens separately.
6. Keep sensitive fragment contents out of durable usage records.

## Failure Modes

- Reserved output tokens exceed model context limits.
- Estimated token counts undercount provider tokens.
- Important safety context is dropped due to bad priority.
- Retrieval floods the prompt and crowds out task instructions.
- Usage records lose model/request metadata needed for debugging.

## Security Notes

- Do not persist raw prompt content unless retention is approved.
- Keep tenant/model/task metadata explicit in usage records.
- Redact sensitive fragment metadata before audit export.
- Treat token budget policies as production configuration.

## Verification Checklist

- Stateless tests cover available token calculation, reserved overflow rejection, fragment validation, priority packing, dropped fragments, usage records, summaries, and clone safety.
- Stateful tests cover policy updates, fragment upsert/remove, planning, usage audit, summaries, and clone-safe reads.
- Tokenizer adapter tests should compare estimated and exact counts for fixture prompts.
- Integration tests should verify prompt-template-registry and vector-search-adapter fragments fit before model-gateway calls.

## Source References

- LLM context-window budgeting patterns.
- RAG context packing and priority trimming.
- Prompt/token usage audit workflows.
- Provider-specific tokenizer adapter patterns.
`;

export const TOKEN_BUDGET_MANAGER_MODULE: MwhModule = {
  id: "token-budget-manager",
  title: "Token Budget Manager",
  summary:
    "Reusable AI infrastructure reference for context-window budgeting, priority fragment packing, reserved output tokens, and stateful usage audit tests.",
  version: "0.1.0",
  tags: ["ai-infra", "token", "budget", "context", "llmops", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
