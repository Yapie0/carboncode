import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Config Schema Validator Middleware

## Purpose

Use this module as a reusable reference when validating remote config, feature-flag payloads, tenant settings, environment config, or admin-published JSON before rollout.

The module focuses on configuration correctness: define schemas, apply defaults, validate required fields, reject additional properties, enforce string patterns and numeric ranges, publish schema versions, validate values only against published schemas, and expose registry snapshots.

## When To Use

- Remote config values are edited by humans or automation before deployment.
- Feature flags carry structured payloads rather than booleans.
- Tenant settings need schema validation and safe defaults.
- Tests need config validation without AJV, Zod, a database, or an external config service.

## When Not To Use

- Do not use this as a full JSON Schema implementation.
- Do not accept unpublished draft schemas for production reads.
- Do not allow additional properties for security-sensitive config.
- Do not validate secrets without also enforcing storage and access policy.

## Implementation Variants

- memory-registry: deterministic in-process schema registry for unit tests and adapter contracts.
- AJV adapter: converts or delegates to JSON Schema for production-grade validation.
- Zod adapter: validates app-local schemas and emits compatible issue shapes.
- SQL adapter: stores schema versions, status, and publish timestamps.

## Recommended Architecture

- core.ts: pure schema validation, defaults, issue collection, schema records, publish gate, and snapshots.
- memory-registry.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/ajv.ts: maps ConfigSchema to JSON Schema or wraps AJV directly.
- admin routes: create draft, update draft, validate sample, publish schema, validate config.
- remote-config integration: validate value before updateRemoteConfigEntry.

## Public API Sketch

\`\`\`ts
const registry = new MemoryConfigSchemaRegistry();
registry.create({
  key: "checkout",
  schema: {
    type: "object",
    required: ["enabled"],
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      maxItems: { type: "number", min: 1, max: 50, defaultValue: 10 },
    },
  },
});
registry.publish("checkout", { enabled: true });
const result = registry.validate("checkout", { enabled: true });
\`\`\`

## Integration Steps

1. Register schemas per config key.
2. Keep drafts separate from published schemas.
3. Validate sample values before publish.
4. Validate every remote config update before persisting it.
5. Store validation issues with path and message for admin UIs.
6. Use clone-safe reads so callers cannot mutate registry internals.

## Failure Modes

- Invalid config reaches production because drafts are treated as published.
- Required fields are missing but default handling masks unrelated errors.
- Additional properties introduce unsupported behavior.
- Numeric limits or regex patterns differ between admin UI and runtime.
- Returned schema objects mutate the registry.

## Security Notes

- Reject unknown properties for security-sensitive config.
- Treat config changes as privileged writes and audit them.
- Do not expose secret config values in validation errors.
- Validate before rollout and again before runtime consumption.

## Verification Checklist

- Stateless tests cover required fields, defaults, enum, pattern, number ranges, arrays, nested objects, additional property rejection, publish sample validation, and snapshots.
- Stateful tests cover create/update/publish/validate, draft rejection, duplicate rejection, clone-safe reads, and version increments.
- Adapter tests should verify AJV/Zod/SQL mappings produce the same issue shape.

## Source References

- JSON Schema validation patterns.
- AJV and Zod runtime config validation patterns.
- Remote configuration publish and validation workflows.
`;

export const CONFIG_SCHEMA_VALIDATOR_MODULE: MwhModule = {
  id: "config-schema-validator",
  title: "Config Schema Validator Middleware",
  summary:
    "Reusable feature-config reference for schema validation, defaults, publish gates, issue paths, and config registry adapters.",
  version: "0.1.0",
  tags: ["feature-config", "config", "schema", "validation", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
