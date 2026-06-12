import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Service Registry Middleware

## Purpose

Use this module as a reusable reference for service registration and discovery: instance registration, heartbeat refresh, TTL expiry, health filtering, service snapshots, and deterministic endpoint selection.

This module is provider-neutral. Nacos, Consul, etcd, Kubernetes Services, Eureka, and custom SQL/Redis registries can be adapters behind the same registration and discovery contract.

## When To Use

- Need services, workers, agents, or local tools to discover available endpoints.
- Need heartbeat-based liveness before wiring Consul, Nacos, etcd, Kubernetes, or SQL.
- Need deterministic tests for registration, expiry, health filtering, and load-based routing.
- Need a small reference implementation for service-governance middleware.

## When Not To Use

- Do not use process-local memory as a production registry across multiple instances.
- Do not treat discovery as authorization; callers still need credentials and policy checks.
- Do not route to warning or critical instances unless the caller explicitly opts in.
- Do not assume heartbeat timestamps are reliable across machines without clock-drift handling.

## Implementation Variants

- Memory registry for unit tests, CLI prototypes, and local agent collaboration.
- Redis hash/sorted-set registry for short-lived instances and TTL pruning.
- SQL registry table with periodic heartbeat updates and lease cleanup.
- Consul/Nacos/etcd adapter for production service-discovery backends.
- Kubernetes adapter that maps Service/EndpointSlice records into the same endpoint contract.

## Recommended Architecture

- core.ts: pure instance creation, heartbeat refresh, expiry detection, discovery filtering, endpoint mapping, snapshots, and endpoint selection.
- memory-registry.ts: stateful register, heartbeat, deregister, discover, resolve, pruneExpired, snapshot, and list behavior.
- adapters/redis.ts: distributed registry with TTL indexes and atomic heartbeat updates.
- adapters/sql.ts: durable registry table with lease cleanup.
- adapters/provider.ts: Consul/Nacos/etcd/Kubernetes mapping.

## Public API Sketch

\`\`\`ts
const registry = new MemoryServiceRegistry({ defaultTtlMs: 30_000 });
registry.register({
  serviceName: "api",
  instanceId: "api-1",
  address: "127.0.0.1",
  port: 3000,
  metadata: { zone: "local" },
});

registry.heartbeat({ serviceName: "api", instanceId: "api-1", load: 0.4 });
const endpoint = registry.resolve({ serviceName: "api", strategy: "round-robin" });
const snapshot = registry.snapshot();
\`\`\`

## Integration Rules

1. Keep registration, heartbeat, expiry, and selection as explicit state transitions.
2. Filter expired and unhealthy instances before endpoint selection.
3. Use stable instance IDs so reconnects replace the intended instance.
4. Keep provider adapters behind the same endpoint contract.
5. Treat status, TTL, and load as routing inputs, not as authorization.
6. Make snapshots deterministic so tests and dashboards can diff them.

## Failure Modes

- Missed heartbeats remove healthy instances until they re-register.
- Process-local registries diverge in multi-instance deployments.
- Clock skew can expire instances too early or too late.
- Warning/critical instances leak into discovery when filtering is incomplete.
- Round-robin cursors reset after process restart unless stored externally.

## Security Notes

- Do not expose internal metadata to untrusted clients.
- Authenticate registry writes; otherwise attackers can register fake endpoints.
- Validate address and port before publishing endpoints.
- Audit register, heartbeat status changes, and deregister operations in production adapters.

## Verification Checklist

- Stateless tests cover instance creation, heartbeat refresh, TTL expiry, endpoint mapping, health filtering, round-robin selection, least-load selection, and deterministic snapshots.
- Stateful tests cover register, heartbeat, duplicate replacement, discover, resolve, deregister, pruneExpired, clone safety, and snapshot behavior.
- Redis/SQL/provider adapters should test concurrent heartbeats, lease cleanup, duplicate instance IDs, and provider mapping.
- Security-sensitive deployments should test unauthorized writes and metadata redaction.

## Source References

- Consul/Nacos/etcd style service registration and discovery.
- Kubernetes Service and EndpointSlice discovery patterns.
- Eureka-style heartbeat and lease expiry.
- Client-side load balancing with round-robin and least-load endpoint selection.
`;

export const SERVICE_REGISTRY_MODULE: MwhModule = {
  id: "service-registry",
  title: "Service Registry Middleware",
  summary:
    "Reusable service-governance reference with registration, heartbeat, TTL expiry, health filtering, snapshots, and endpoint selection.",
  version: "0.1.0",
  tags: [
    "service-governance",
    "service-discovery",
    "registry",
    "heartbeat",
    "load-balancing",
    "middleware",
  ],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
