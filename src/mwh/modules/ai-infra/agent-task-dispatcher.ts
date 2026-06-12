import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Agent Task Dispatcher

## Purpose

Use this module as a reusable reference for routing work across multiple coding agents, AI workers, tool executors, or background assistants by capability, status, priority, and available concurrency.

This is not a generic job queue. It focuses on agent-aware dispatch: which agent should handle a task, when a task can be claimed, and how assignment state is completed, failed, or cancelled.

## When To Use

- Need to split work across Codex, Claude Code, Carbon Code, or specialized subagents.
- Need capability-based routing such as "frontend", "database", "review", "playwright", or "mcp".
- Need deterministic tests before adding distributed storage, inbox/outbox collaboration, or worker processes.
- Need max-concurrency and health-aware dispatch without coupling to a broker.

## When Not To Use

- Do not use memory state as a durable production queue.
- Do not use this alone for long-running jobs that need retry, backoff, and dead-letter handling.
- Do not assign sensitive tasks to agents without explicit permission/capability checks.
- Do not assume task success unless the assigned agent reports completion.

## Implementation Variants

- Memory dispatcher for local tests and prototypes.
- SQL dispatcher with row locks and durable task/agent tables.
- Redis dispatcher with leases and heartbeat TTLs.
- File inbox/outbox dispatcher for local multi-agent collaboration.
- Broker-backed dispatcher that publishes assignments to agent-specific queues.

## Recommended Architecture

- core.ts: pure worker/task validation, capability matching, queue ordering, claiming, finishing, cancellation, and clone helpers.
- memory-dispatcher.ts: stateful worker registry, task queue, dispatchNext, finish, cancel, and status changes.
- adapters/sql.ts: durable worker heartbeat, task claim with SKIP LOCKED, and audit trail.
- adapters/file-collab.ts: map assignments to .carboncode/collab inbox/outbox messages.
- integrations/permissions.ts: require permission_request before sensitive task assignment.

## Public API Sketch

\`\`\`ts
const dispatcher = new MemoryAgentTaskDispatcher();
dispatcher.upsertWorker({
  id: "codex",
  capabilities: ["typescript", "tests", "mcp"],
  maxConcurrentTasks: 2,
});
dispatcher.enqueue({
  id: "task-1",
  type: "implement-module",
  requiredCapabilities: ["typescript", "tests"],
  payload: { module: "rate-limit-http" },
});

const assignment = dispatcher.dispatchNext();
dispatcher.finish({ taskId: assignment!.task.id, agentId: assignment!.agent.id, status: "succeeded" });
\`\`\`

## Integration Rules

1. Model required capabilities explicitly.
2. Keep agent heartbeat/status separate from task status.
3. Respect maxConcurrentTasks before claiming work.
4. Require explicit permission before sensitive operations.
5. Persist assignments before notifying an external agent.
6. Treat failed or abandoned tasks as auditable events.

## Failure Modes

- Tasks starve when required capabilities are too narrow.
- Offline agents keep assignments unless heartbeat cleanup is implemented.
- Duplicate execution can happen without durable claim semantics.
- Sensitive tasks can be leaked if capability and permission checks are weak.
- Memory dispatch state is lost on restart.

## Security Notes

- Treat capabilities as an authorization input, not only scheduling metadata.
- Include task id, sender, recipient, and permission intent in collaboration messages.
- Audit manual reassignment, cancellation, and failure reasons.
- Do not put secrets in task payloads unless the recipient is trusted.

## Verification Checklist

- Stateless tests cover task/worker creation, capability normalization, matching, queue ordering, claim, finish, cancel, and clone safety.
- Stateful tests cover worker registration, enqueue, dispatchNext, concurrency limits, status changes, finish/fail, cancellation, multiple agents, and clone-safe reads.
- SQL/Redis adapters should test atomic claims, heartbeat expiry, and duplicate-claim prevention.
- File-collab adapters should test inbox/outbox message generation and idempotent reads.

## Source References

- Capability-based worker routing patterns.
- Distributed task assignment with leases and heartbeats.
- Multi-agent collaboration inbox/outbox patterns.
- SQL SKIP LOCKED and Redis lease-based worker coordination.
`;

export const AGENT_TASK_DISPATCHER_MODULE: MwhModule = {
  id: "agent-task-dispatcher",
  title: "Agent Task Dispatcher",
  summary:
    "Reusable AI infrastructure reference for capability-based multi-agent task routing, assignment lifecycle, concurrency limits, and stateful dispatcher tests.",
  version: "0.1.0",
  tags: ["ai-infra", "agent", "dispatcher", "multi-agent", "task-routing", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
