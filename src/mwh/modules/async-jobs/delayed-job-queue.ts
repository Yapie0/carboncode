import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Delayed Job Queue Middleware

## Purpose

Use this module as a reusable reference when building background jobs, delayed tasks, retryable workers, scheduled execution, lease-based worker claims, and dead-letter style failure handling.

The module contains pure job state transitions plus a deterministic memory queue for tests. Production adapters can persist jobs in SQL, Redis, BullMQ, SQS, Cloud Tasks, or any durable queue while keeping the same lifecycle rules.

## When To Use

- Execute expensive or slow work outside the request path.
- Schedule delayed jobs such as reminders, retries, emails, cleanup, or sync tasks.
- Coordinate multiple workers with leases.
- Retry transient failures with capped exponential backoff.

## When Not To Use

- Do not use process memory as durable production queue storage.
- Do not assume exactly-once execution; handlers must be idempotent.
- Do not run long jobs without renewing or sizing leases intentionally.

## Recommended Architecture

- core.ts: pure job create, release due, claim, complete, fail, cancel, lease expiry, and backoff.
- memory-queue.ts: deterministic stateful queue for tests and local demos.
- adapters/sql.ts: durable queue table with status, runAt, priority, workerId, and leaseUntil columns.
- adapters/redis.ts: sorted-set backed delay queue with atomic claim scripts.
- worker.ts: polling loop with concurrency, graceful shutdown, and handler registry.

## Public API Sketch

\`\`\`ts
const queue = new MemoryDelayedJobQueue({
  backoff: { baseDelayMs: 1_000, maxDelayMs: 60_000 },
});

queue.enqueue({
  id: "job-1",
  queue: "emails",
  type: "send-welcome-email",
  payload: { userId: "u1" },
  delayMs: 30_000,
  priority: 10,
});

const job = queue.claimNext("emails", "worker-a");
if (job) {
  await handlers[job.type](job.payload);
  queue.complete(job.id, "worker-a");
}
\`\`\`

## Integration Rules

1. Persist jobs before acknowledging the event that requires them.
2. Use stable job ids for deduplication when the producer can retry.
3. Claim jobs with finite leases and release expired leases.
4. Make handlers idempotent because retries and lease takeovers can duplicate work.
5. Record terminal failures for operator inspection.
6. Use priority only for local ordering, not for business correctness.

## Failure Modes

- Lost jobs when enqueued outside the transaction that creates business state.
- Duplicate execution after worker crash or lease expiry.
- Retry storms from uncapped backoff.
- Starvation when high-priority jobs arrive continuously.
- Poison jobs cycling forever without max attempts.

## Verification Checklist

- Stateless tests cover delay release, priority ordering, claim, complete, fail/retry, terminal failure, cancel, and lease expiry.
- Stateful tests cover enqueue, delayed visibility, worker claims, retry delay, stale lease takeover, completion, cancellation, and per-queue isolation.
- Adapter tests should verify atomic claim behavior under concurrent workers.
- Worker tests should verify graceful shutdown does not claim new work.

## Source References

- BullMQ delayed jobs and retry backoff concepts.
- Celery retry and task state model.
- AWS SQS visibility timeout as a lease-like worker claim.
`;

export const DELAYED_JOB_QUEUE_MODULE: MwhModule = {
  id: "delayed-job-queue",
  title: "Delayed Job Queue Middleware",
  summary:
    "Reusable background job queue reference with delay, priority, leases, retries, cancellation, and stateful queue tests.",
  version: "0.1.0",
  tags: ["async-jobs", "job-queue", "delayed-jobs", "retry", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
