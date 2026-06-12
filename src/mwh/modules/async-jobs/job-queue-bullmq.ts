import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: BullMQ-Style Job Queue Middleware

## Purpose

Use this module as a reusable reference when implementing BullMQ-style background workers with named jobs, processor registration, priority, delays, attempts, retry backoff, stalled lock recovery, and dead-letter behavior.

This module does not require Redis at test time. It captures the BullMQ integration contract in pure state transitions and a deterministic memory queue. Production adapters can map the same semantics to BullMQ Queue, Worker, QueueEvents, and failed job inspection.

## When To Use

- A codebase needs named background processors such as send-email, resize-image, or sync-account.
- Jobs need attempts, delay, priority, and retry backoff.
- Workers need finite locks so stalled jobs can be retried.
- Tests should validate queue behavior before wiring Redis/BullMQ.

## When Not To Use

- Do not use the memory queue for production durability.
- Do not assume exactly-once processing; handlers must be idempotent.
- Do not run unbounded retry loops without dead-letter inspection.
- Do not put business transactions inside queue acknowledgment without explicit recovery rules.

## Implementation Variants

1. Memory queue
   - Deterministic local tests and examples.
2. BullMQ adapter
   - Redis-backed Queue, Worker, retry attempts, delay, priority, and QueueEvents.
3. SQL worker queue
   - Same state model with row locks and durable job table.
4. Hybrid outbox + BullMQ
   - Transactional outbox persists the intent; a relay publishes to BullMQ.

## Recommended Architecture

- core.ts: pure job creation, delayed promotion, claim, complete, fail, stalled release, ordering, and backoff.
- memory-queue.ts: stateful add, registerProcessor, claimNext, processNext, complete, fail, list.
- adapters/bullmq.ts: Queue.add, Worker processor registry, events, dead-letter inspection.
- worker.ts: concurrency, graceful shutdown, logging, metrics, and retry policy.
- handlers/: idempotent named processors.

## Public API Sketch

\`\`\`ts
const queue = new MemoryBullQueue({
  backoff: { baseDelayMs: 1000, maxDelayMs: 60000 },
});
queue.registerProcessor("send-email", (job) => {
  sendEmail(job.data);
  return { sent: true };
});
queue.add({
  id: "job_1",
  queueName: "default",
  name: "send-email",
  data: { userId: "u1" },
  options: { attempts: 3, priority: 10 },
});
queue.processNext("default", "worker-a");
\`\`\`

## Integration Rules

1. Use stable job ids when producers may retry.
2. Keep processor names low-cardinality and versioned when payload shape changes.
3. Make processors idempotent because retries and stalled recovery can duplicate work.
4. Store terminal failures for operator inspection.
5. Use finite locks and release stalled jobs.
6. Persist enqueue intent transactionally when the job follows a domain write.

## Failure Modes

- Missing processors send jobs into retry/dead-letter.
- Worker crashes can leave active jobs locked until lock expiry.
- Non-idempotent processors duplicate side effects after retry.
- Retry storms happen when backoff is too small or uncapped.
- Priority starvation can occur if high-priority jobs arrive continuously.

## Verification Checklist

- Stateless tests cover job creation, delayed promotion, priority ordering, claim, complete, fail/retry, dead-letter, stalled release, and backoff.
- Stateful tests cover add, duplicate id rejection, processor success, processor failure retry, missing processor handling, delayed jobs, priority ordering, and clone-safe reads.
- BullMQ adapter tests should run against Redis in CI or a Docker fixture and verify Queue/Worker event mapping.
- Worker tests should cover graceful shutdown and handler errors.

## Source References

- BullMQ Queue.add, Worker, attempts, backoff, delay, priority, and stalled job concepts.
- Redis-backed worker queue patterns.
- Transactional outbox plus background worker patterns.
`;

export const JOB_QUEUE_BULLMQ_MODULE: MwhModule = {
  id: "job-queue-bullmq",
  title: "BullMQ-Style Job Queue Middleware",
  summary:
    "Reusable async-jobs reference for BullMQ-style named processors, delays, attempts, backoff, stalled locks, and dead-letter behavior.",
  version: "0.1.0",
  tags: ["async-jobs", "bullmq", "job-queue", "worker", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
