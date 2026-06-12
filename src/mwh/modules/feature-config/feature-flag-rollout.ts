import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Feature Flag Rollout Middleware

## Purpose

Use this module as a reusable reference when building feature flags, percentage rollouts, kill switches, tenant allowlists, experiment gates, or config-driven release controls.

The module contains deterministic stateless evaluation plus a stateful in-memory flag store for tests. Production adapters can load flag configs from SQL, Redis, edge config, LaunchDarkly-like services, or internal config APIs while reusing the same evaluation rules.

## When To Use

- Release a feature gradually by stable user or tenant bucket.
- Override rollout decisions for explicit allow/deny subjects.
- Gate features by request, user, tenant, environment, or plan attributes.
- Add a kill switch that can disable a feature without redeploying.

## When Not To Use

- Do not use feature flags as authorization checks unless the rule set is security-reviewed.
- Do not use random-per-request rollout; users must get stable decisions.
- Do not keep stale flags forever without ownership and cleanup.

## Recommended Architecture

- core.ts: pure flag evaluation, stable bucket hashing, attribute rule matching, and config merging.
- memory-store.ts: deterministic stateful config store for tests and local development.
- adapters/sql.ts: durable flag config store with audit history.
- adapters/redis.ts: low-latency cached config adapter.
- sdk/http.ts: request-context extraction and response metadata helpers.

## Public API Sketch

\`\`\`ts
const flags = new MemoryFeatureFlagStore();
flags.upsert({
  key: "new-checkout",
  enabled: true,
  defaultValue: false,
  rolloutPercentage: 25,
  allowSubjects: ["internal-user"],
});

const decision = flags.evaluate("new-checkout", {
  subjectKey: user.id,
  attributes: { plan: user.plan, region: user.region },
});
if (decision.enabled) renderNewCheckout();
\`\`\`

## Integration Rules

1. Use stable subject keys such as user id, tenant id, or device id.
2. Hash flag key, subject key, and salt into a deterministic bucket.
3. Apply deny overrides before allow overrides.
4. Apply explicit attribute rules before percentage rollout.
5. Return reason metadata for debugging and audit logs.
6. Keep flag definitions versioned and removable.

## Failure Modes

- Users flip between variants when rollout uses request randomness.
- Tenant leaks when context omits tenant-specific attributes.
- Dead flags accumulate and make behavior hard to reason about.
- Emergency disables fail when config cache has no invalidation story.
- Product experiments become security controls without review.

## Security Notes

- Treat client-visible flag decisions as public information.
- Evaluate server-side for sensitive behavior.
- Do not put raw secrets in flag attributes or audit logs.

## Verification Checklist

- Stateless tests cover missing flags, disabled flags, allow/deny overrides, rule matches, default decisions, and stable percentage buckets.
- Stateful tests cover upsert, patch merge, evaluate, delete, and list behavior.
- Adapter tests should cover stale config refresh and rollback behavior.
- Integration tests should assert the same subject receives stable decisions across requests.

## Source References

- OpenFeature evaluation model: provider-agnostic feature flag contract.
- Unleash gradual rollout model: stable stickiness and strategy constraints.
- LaunchDarkly rollout concepts: percentage rollout, targeting rules, and fallthrough behavior.
`;

export const FEATURE_FLAG_ROLLOUT_MODULE: MwhModule = {
  id: "feature-flag-rollout",
  title: "Feature Flag Rollout Middleware",
  summary:
    "Reusable feature-flag rollout reference with stable buckets, targeting rules, overrides, and stateful config tests.",
  version: "0.1.0",
  tags: ["feature-config", "feature-flag", "rollout", "experiment", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
