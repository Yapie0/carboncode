import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Cron Scheduler Middleware

## Purpose

Use this module as a reusable reference for recurring background jobs: cleanup tasks, report generation, synchronization loops, health probes, billing cycles, cache refreshes, and scheduled maintenance.

The module contains pure cron-like schedule calculation and task state transitions plus a deterministic in-memory scheduler for tests. Production adapters can replace memory state with SQL, Redis, BullMQ repeatable jobs, cloud schedulers, or Kubernetes CronJobs.

## When To Use

- Need recurring jobs inside a service before adopting a full scheduler.
- Need deterministic tests for schedule calculation, worker leases, retries, and enable/disable behavior.
- Need a provider-neutral task contract before wiring BullMQ, Agenda, Temporal, Quartz, Kubernetes, or cloud schedulers.
- Need local development behavior without external Redis or database dependencies.

## When Not To Use

- Do not use process-local memory for multi-instance production scheduling.
- Do not run long jobs without worker leases and stale lease recovery.
- Do not rely on local wall-clock behavior without considering timezone and clock skew.
- Do not use this minimal cron parser when full cron syntax is required.

## Implementation Variants

- Memory scheduler for tests and single-process prototypes.
- SQL task table with row-level locking and nextRunAt indexes.
- Redis sorted-set scheduler with worker leases.
- BullMQ repeatable jobs adapter.
- Kubernetes CronJob or cloud scheduler adapter for infrastructure-owned scheduling.

## Recommended Architecture

- core.ts: pure minute/hour schedule parsing, next-run calculation, claim, complete, fail, lease release, and enable/disable transitions.
- memory-scheduler.ts: stateful register, claimNext, complete, fail, setEnabled, get, and list behavior.
- adapters/sql.ts: durable task table and transactional claim.
- adapters/redis.ts: sorted-set due tasks and lock keys.
- adapters/bullmq.ts: repeatable jobs bridge.

## Public API Sketch

\`\`\`ts
const scheduler = new MemoryCronScheduler({ defaultLeaseMs: 30_000, retryDelayMs: 60_000 });
scheduler.register({
  id: "daily-report",
  name: "Daily report",
  expression: "0 1",
  payload: { report: "daily" },
});

const task = scheduler.claimNext("worker-a");
if (task) {
  try {
    await runTask(task.payload);
    scheduler.complete(task.id, "worker-a");
  } catch (error) {
    scheduler.fail(task.id, "worker-a", String(error));
  }
}
\`\`\`

## Integration Rules

1. Store nextRunAt as the scheduling index.
2. Claim tasks with a lease before running side effects.
3. Release stale leases so crashed workers do not block future runs.
4. Compute the next schedule only after successful completion.
5. Use retryDelayMs for transient failures when immediate next schedule is too far away.
6. Use SQL/Redis/cloud scheduler adapters for distributed production deployments.

## Failure Modes

- Duplicate runs when multiple instances claim from non-atomic memory state.
- Missed runs when process-local memory is lost on restart.
- Stale running tasks if leases do not expire.
- Timezone errors when business schedules are not normalized.
- Minimal cron syntax may reject expressions supported by full cron libraries.

## Security Notes

- Treat task payloads as operational data; avoid secrets in stored payloads.
- Restrict who can enable, disable, or edit scheduled jobs.
- Log task claims and failures for operational auditability.

## Verification Checklist

- Stateless tests cover expression parsing, next-run calculation, due checks, claim, complete, fail, stale lease release, and enable/disable transitions.
- Stateful tests cover register, claimNext ordering, complete scheduling, retry-on-failure, lease takeover, disable/enable, and listing.
- SQL/Redis adapter tests should verify atomic claim and duplicate-run prevention.
- Infrastructure adapter tests should verify schedule drift and failure retry behavior.

## Source References

- Cron-style recurring task scheduling.
- BullMQ repeatable jobs and delayed queues.
- SQL row locking scheduler patterns.
- Redis sorted-set schedulers and worker leases.
`;

export const CRON_SCHEDULER_MODULE: MwhModule = {
  id: "cron-scheduler",
  title: "Cron Scheduler Middleware",
  summary:
    "Reusable recurring job scheduler reference with cron-like minute/hour schedules, leases, retries, enable/disable, and stateful tests.",
  version: "0.1.0",
  tags: ["async-jobs", "cron", "scheduler", "recurring-jobs", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
