import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Remote Config Store Middleware

## Purpose

Use this module as a reusable reference for remote configuration: environment-specific settings, tenant overrides, versioned configuration releases, snapshots, ETags, and rollback.

This module is separate from feature flags. Feature flags decide enablement and rollout; remote config distributes typed configuration values and versioned snapshots to services, CLIs, dashboards, and agents.

## When To Use

- Need environment or tenant-specific configuration.
- Need versioned config updates with rollback.
- Need deterministic snapshots with ETags for polling clients.
- Need a provider-neutral core before wiring SQL, Redis, Consul, etcd, S3, or a SaaS config provider.

## When Not To Use

- Do not store secrets unless values are encrypted and access-controlled.
- Do not use remote config as a substitute for authorization policy.
- Do not rely on process-local memory for distributed production configuration.
- Do not expose tenant-specific values to clients without explicit access checks.

## Implementation Variants

- Memory store for tests and single-process prototypes.
- SQL version table with current pointer and audit metadata.
- Redis cached snapshot with pub/sub invalidation.
- Object-store snapshot adapter for static config bundles.
- Consul/etcd adapter for service-discovery aligned configuration.

## Recommended Architecture

- core.ts: pure entry creation, update, rule matching, resolution, snapshot generation, ETag hashing, and validation.
- memory-store.ts: stateful upsert, resolve, snapshot, rollback, version history, delete, and list behavior.
- adapters/sql.ts: durable version history and transactional publish.
- adapters/redis.ts: cached snapshots and invalidation.
- client/polling.ts: ETag-aware config polling.

## Public API Sketch

\`\`\`ts
const store = new MemoryRemoteConfigStore();
store.upsert({
  key: "model.temperature",
  defaultValue: 0.2,
  rules: [
    { id: "tenant-fast", priority: 10, tenantId: "t1", value: 0.7 },
  ],
});

const resolution = store.resolve("model.temperature", {
  environment: "prod",
  tenantId: "t1",
});
const snapshot = store.snapshot({ environment: "prod", tenantId: "t1" });
\`\`\`

## Integration Rules

1. Keep config resolution pure and deterministic.
2. Version every config update.
3. Prefer snapshots with ETags for polling clients.
4. Use priority rules for environment, tenant, and attribute overrides.
5. Keep secrets out of plain remote config.
6. Store history so bad config releases can be rolled back.

## Failure Modes

- Bad config values break clients when no validation or staged rollout exists.
- Missing ETags cause unnecessary polling traffic.
- Tenant overrides leak when context checks are incomplete.
- Process-local stores diverge across service instances.
- Rollback is impossible without version history.

## Security Notes

- Treat config values as potentially sensitive operational data.
- Enforce access checks before exposing tenant or environment-specific snapshots.
- Redact secrets or use a dedicated secret manager.
- Audit updates, rollbacks, and deletes.

## Verification Checklist

- Stateless tests cover entry creation, version increments, rule matching, default resolution, disabled entries, snapshots, ETags, and clone safety.
- Stateful tests cover upsert, resolve, snapshot, version history, rollback, delete, and list behavior.
- SQL/Redis adapter tests should verify consistency, invalidation, and concurrent updates.
- Client tests should verify ETag reuse and stale snapshot handling.

## Source References

- Remote configuration service patterns.
- Consul/etcd style key-value configuration.
- ETag-based polling and snapshot caching.
- Versioned configuration rollback patterns.
`;

export const REMOTE_CONFIG_STORE_MODULE: MwhModule = {
  id: "remote-config-store",
  title: "Remote Config Store Middleware",
  summary:
    "Reusable remote config reference with environment/tenant rules, version history, snapshots, ETags, rollback, and stateful tests.",
  version: "0.1.0",
  tags: ["feature-config", "remote-config", "configuration", "etag", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
