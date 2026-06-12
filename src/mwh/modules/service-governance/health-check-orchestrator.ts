import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Health Check Orchestrator Middleware

## Purpose

Use this module as a reusable reference for health-check orchestration: probe definitions, due scheduling, observation recording, consecutive failure tracking, status evaluation, target aggregation, and deterministic health snapshots.

This module is intentionally transport-neutral. HTTP, TCP, gRPC, process, queue, database, and custom probes can be adapters around the same state machine.

## When To Use

- Need liveness/readiness checks for services, workers, queues, or local agent helpers.
- Need warning/critical degradation based on consecutive failures.
- Need deterministic tests before wiring HTTP, TCP, Kubernetes, Consul, or Nacos health checks.
- Need health state that can feed service registry status or traffic policy.

## When Not To Use

- Do not use a local memory orchestrator as the only production source of truth across many nodes.
- Do not assume a passing probe means the caller is authorized.
- Do not run expensive probes at high frequency without backoff or budgets.
- Do not collapse all failure reasons into one status when operators need diagnostics.

## Implementation Variants

- Memory orchestrator for tests, CLI prototypes, and local development.
- HTTP probe adapter for /health, /ready, and dependency status endpoints.
- TCP/gRPC probe adapter for backend services.
- SQL/Redis state adapter for distributed health history and leases.
- Kubernetes/Consul/Nacos adapter that maps provider health checks into the same snapshot contract.

## Recommended Architecture

- core.ts: pure probe creation, observation creation, failure counters, status evaluation, due checks, target aggregation, snapshots, and clone helpers.
- memory-orchestrator.ts: stateful add/remove probes, runDue, record manual observations, list observations, and snapshots.
- adapters/http.ts: fetch-based HTTP probe with timeout budget.
- adapters/tcp.ts: socket-connect probe.
- integrations/service-registry.ts: propagate health status into service-registry instances.

## Public API Sketch

\`\`\`ts
const orchestrator = new MemoryHealthCheckOrchestrator({
  runner: (probe) => ({ ok: true, latencyMs: 12, message: probe.id }),
});

orchestrator.addProbe({
  id: "ready",
  targetId: "api-1",
  kind: "http",
  timeoutMs: 500,
  intervalMs: 5_000,
});

const observations = orchestrator.runDue();
const snapshot = orchestrator.snapshot();
\`\`\`

## Integration Rules

1. Keep probe execution separate from health state evaluation.
2. Track consecutive failures so temporary blips degrade before becoming critical.
3. Aggregate target status from all probes; any critical probe makes the target critical.
4. Keep observation history available for diagnostics.
5. Feed target health into service discovery or traffic policy after state mutation succeeds.
6. Keep expensive checks bounded by timeout and interval budgets.

## Failure Modes

- Probe runner hangs without timeout enforcement.
- One noisy dependency keeps a target critical without diagnostic messages.
- Clock drift causes probes to run too often or not often enough.
- Distributed orchestrators race unless probe ownership is leased.
- Health snapshots leak internal hostnames or dependency details.

## Security Notes

- Do not expose full diagnostic messages to untrusted clients.
- Authenticate writes to manual observation APIs.
- Avoid embedding credentials in probe metadata.
- Rate-limit probe execution and protect internal health endpoints.

## Verification Checklist

- Stateless tests cover probe creation, observation creation, status thresholds, due checks, aggregation, snapshots, and clone safety.
- Stateful tests cover add/remove probes, runDue, manual record, warning/critical transitions, recovery, observation history, and deterministic snapshots.
- HTTP/TCP adapters should test timeout, non-2xx handling, connection failure, and diagnostic messages.
- Distributed adapters should test lease ownership and duplicate runner suppression.

## Source References

- Kubernetes liveness/readiness/startup probe patterns.
- Consul/Nacos health-check and service-discovery status patterns.
- Circuit-breaker style consecutive failure thresholds.
- RED/USE operational health-check practices.
`;

export const HEALTH_CHECK_ORCHESTRATOR_MODULE: MwhModule = {
  id: "health-check-orchestrator",
  title: "Health Check Orchestrator Middleware",
  summary:
    "Reusable service-governance reference with probe definitions, due checks, observations, status thresholds, target snapshots, and stateful runner tests.",
  version: "0.1.0",
  tags: [
    "service-governance",
    "health-check",
    "readiness",
    "liveness",
    "service-discovery",
    "middleware",
  ],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
