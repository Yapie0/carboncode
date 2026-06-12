import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Prompt Template Registry

## Purpose

Use this module as a reusable reference for managing prompt templates: variable extraction, required-variable validation, safe deterministic rendering, published/draft lifecycle, version selection, and render audit records.

This module complements model-gateway. The registry prepares prompt text and records template usage; the model gateway decides which provider/model handles the final request.

## When To Use

- Need reusable prompt templates with explicit variables.
- Need published versions instead of ad hoc prompt strings.
- Need render-time validation before model calls.
- Need audit records that say which template/version generated a prompt.
- Need deterministic tests before adding SQL, Git-backed, or remote prompt storage.

## When Not To Use

- Do not render unreviewed draft templates in production.
- Do not treat template rendering as prompt-injection protection.
- Do not store secrets inside templates or render audit variables.
- Do not allow arbitrary helper execution inside prompt templates.

## Implementation Variants

- Memory registry for tests and local prototypes.
- SQL registry with prompt version table and render audit table.
- Git-backed registry where template files are reviewed and released.
- Remote config registry with environment and tenant overrides.
- Provider prompt-store adapter that syncs published templates.

## Recommended Architecture

- core.ts: pure variable extraction, template creation, publish/disable transitions, latest-version selection, render validation, and clone helpers.
- memory-registry.ts: stateful create, publish, disable, render, get, list, and audit behavior.
- adapters/sql.ts: durable prompt templates and render audit records.
- adapters/git.ts: load reviewed templates from repository files.
- integrations/model-gateway.ts: render template before routing model calls.

## Public API Sketch

\`\`\`ts
const registry = new MemoryPromptTemplateRegistry();
registry.create({
  id: "review-summary",
  name: "Review Summary",
  template: "Summarize {{file}} for {{audience}}.",
});
registry.publish("review-summary");

const rendered = registry.render({
  id: "review-summary",
  variables: { file: "src/app.ts", audience: "maintainers" },
});
\`\`\`

## Integration Rules

1. Extract variables from {{name}} placeholders.
2. Render only published templates by default.
3. Keep template versions immutable after creation.
4. Record template id and version for every render.
5. Keep sensitive runtime variables out of long-retention audit logs.
6. Apply model and tenant policies after rendering.

## Failure Modes

- Missing variables create malformed prompts.
- Draft templates are accidentally used in production.
- Template changes are not versioned, making model outputs hard to debug.
- Render audit stores sensitive variables without redaction.
- Placeholder syntax is too permissive and executes code.

## Security Notes

- This module uses variable substitution only; no code execution.
- Review templates before publishing them to production.
- Redact secrets before writing render audit records.
- Treat prompt templates as configuration with change history.

## Verification Checklist

- Stateless tests cover variable extraction, template creation, publish/disable transitions, version selection, missing-variable rejection, render output, and clone safety.
- Stateful tests cover create, version increments, publish, render audit, disable, latest-version selection, draft rejection, and clone-safe reads.
- SQL/Git adapters should test persistence, immutable versions, and restart loading.
- Integration tests should verify rendered prompts feed model-gateway requests with template audit metadata.

## Source References

- Prompt registry and prompt versioning patterns.
- Runtime template rendering with explicit variables.
- LLMOps prompt audit and release workflows.
- Remote config style published/draft lifecycle.
`;

export const PROMPT_TEMPLATE_REGISTRY_MODULE: MwhModule = {
  id: "prompt-template-registry",
  title: "Prompt Template Registry",
  summary:
    "Reusable AI infrastructure reference for prompt variables, versioned templates, published rendering, and stateful render audit tests.",
  version: "0.1.0",
  tags: ["ai-infra", "prompt", "template", "registry", "llmops", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
