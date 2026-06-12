import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Traffic Policy Router Middleware

## Purpose

Use this module as a reusable reference for service traffic policy: weighted routing, canary rules, attribute matching, health-aware endpoint filtering, deterministic stickiness, fallback routing, and route decision history.

This module complements service-registry and health-check-orchestrator. Registry provides available endpoints, health checks provide status, and traffic policy decides which endpoint should receive a request.

## When To Use

- Need canary or tenant-specific routing without binding to one gateway product.
- Need deterministic sticky routing by user, tenant, session, or request key.
- Need weighted traffic splitting across healthy endpoints.
- Need a testable policy core before wiring Envoy, Nginx, APISIX, Kubernetes, or custom clients.

## When Not To Use

- Do not use client-side routing as authorization.
- Do not route to degraded endpoints unless the policy explicitly allows it.
- Do not rely on memory decision history for production audit retention.
- Do not make traffic rules depend on untrusted attributes without validation.

## Implementation Variants

- Memory router for unit tests, local development, and CLI prototypes.
- API gateway adapter that renders routes into APISIX/Kong/Envoy style config.
- Client-side SDK adapter for service-to-service calls.
- SQL/Redis policy store with versioning and propagation.
- Registry integration that turns service-registry endpoints into traffic endpoints.

## Recommended Architecture

- core.ts: pure endpoint creation, policy validation, rule matching, stable hashing, weighted selection, status filtering, and route decisions.
- memory-router.ts: stateful upsertPolicy, route, updateEndpointStatus, listPolicies, and decision history.
- adapters/gateway.ts: gateway route config rendering.
- adapters/registry.ts: service-registry endpoint mapping.
- adapters/store.ts: versioned policy storage.

## Public API Sketch

\`\`\`ts
const router = new MemoryTrafficPolicyRouter();
router.upsertPolicy({
  serviceName: "api",
  endpoints: [
    createTrafficEndpoint({ id: "stable", url: "https://api.example.com", weight: 90 }),
    createTrafficEndpoint({ id: "canary", url: "https://api-canary.example.com", weight: 10 }),
  ],
  rules: [{ id: "beta", priority: 10, match: { cohort: "beta" }, endpointIds: ["canary"] }],
});

const decision = router.route({
  serviceName: "api",
  key: "user-123",
  attributes: { cohort: "beta" },
});
\`\`\`

## Integration Rules

1. Validate all endpoint IDs referenced by rules and fallbacks.
2. Filter unhealthy endpoints before weighted selection.
3. Use a stable hash key for deterministic sticky routing.
4. Sort rules by priority so more specific rules win.
5. Persist or export route decisions when auditability matters.
6. Keep policy evaluation pure so gateway and SDK adapters can share the same tests.

## Failure Modes

- All candidate endpoints are unhealthy, producing no route.
- Bad weights accidentally send all traffic to one endpoint.
- Canary rules match too broadly when attributes are not validated.
- In-memory policies diverge across service instances.
- Decision history is lost after process restart.

## Security Notes

- Treat route attributes as untrusted input.
- Do not expose internal endpoint metadata to clients.
- Require authorization for policy updates.
- Audit policy changes and high-risk canary rollout rules.

## Verification Checklist

- Stateless tests cover endpoint creation, policy validation, rule matching, stable hashing, weighted selection, fallback routing, health filtering, and clone safety.
- Stateful tests cover policy upsert, route decisions, endpoint status changes, decision history, missing policies, and clone-safe policy reads.
- Gateway adapters should test generated config and no-route behavior.
- Registry adapters should test service-registry and health-check status propagation.

## Source References

- Envoy weighted cluster and route match patterns.
- APISIX/Kong route matching and upstream selection patterns.
- Kubernetes service traffic splitting and canary rollout practices.
- Client-side load-balancing and sticky routing by stable hash.
`;

export const TRAFFIC_POLICY_ROUTER_MODULE: MwhModule = {
  id: "traffic-policy-router",
  title: "Traffic Policy Router Middleware",
  summary:
    "Reusable service-governance reference with weighted routing, canary rules, health filtering, sticky selection, fallback routes, and stateful decision tests.",
  version: "0.1.0",
  tags: [
    "service-governance",
    "traffic-policy",
    "routing",
    "canary",
    "load-balancing",
    "middleware",
  ],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
