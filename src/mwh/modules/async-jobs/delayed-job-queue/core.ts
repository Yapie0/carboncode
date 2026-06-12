export type JobStatus =
  | "scheduled"
  | "ready"
  | "running"
  | "succeeded"
  | "retrying"
  | "failed"
  | "cancelled";

export interface JobRecord<TPayload = unknown> {
  id: string;
  queue: string;
  type: string;
  payload: TPayload;
  priority: number;
  status: JobStatus;
  createdAtMs: number;
  runAtMs: number;
  attempt: number;
  maxAttempts: number;
  leaseUntilMs?: number;
  workerId?: string;
  lastError?: string;
  finishedAtMs?: number;
}

export interface JobBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export interface JobQueueSummary {
  scheduled: number;
  ready: number;
  running: number;
  succeeded: number;
  retrying: number;
  failed: number;
  cancelled: number;
  total: number;
}

export function createJob<TPayload>(input: {
  id: string;
  queue: string;
  type: string;
  payload: TPayload;
  nowMs: number;
  delayMs?: number;
  priority?: number;
  maxAttempts?: number;
}): JobRecord<TPayload> {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.queue, "queue");
  assertNonEmpty(input.type, "type");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const delayMs = input.delayMs ?? 0;
  assertNonNegativeInteger(delayMs, "delayMs");
  const maxAttempts = input.maxAttempts ?? 3;
  assertPositiveInteger(maxAttempts, "maxAttempts");

  return {
    id: input.id,
    queue: input.queue,
    type: input.type,
    payload: cloneJson(input.payload) as TPayload,
    priority: input.priority ?? 0,
    status: delayMs > 0 ? "scheduled" : "ready",
    createdAtMs: input.nowMs,
    runAtMs: input.nowMs + delayMs,
    attempt: 0,
    maxAttempts,
  };
}

export function releaseDueJob<TPayload>(
  job: JobRecord<TPayload>,
  nowMs: number,
): JobRecord<TPayload> {
  assertNonNegativeInteger(nowMs, "nowMs");
  if ((job.status === "scheduled" || job.status === "retrying") && nowMs >= job.runAtMs) {
    return { ...job, status: "ready" };
  }
  return job;
}

export function claimJob<TPayload>(
  job: JobRecord<TPayload>,
  input: { nowMs: number; workerId: string; leaseMs: number },
): JobRecord<TPayload> | undefined {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.leaseMs, "leaseMs");
  assertNonEmpty(input.workerId, "workerId");
  const due = releaseExpiredLease(releaseDueJob(job, input.nowMs), input.nowMs);
  if (due.status !== "ready") return undefined;
  return {
    ...due,
    status: "running",
    workerId: input.workerId,
    leaseUntilMs: input.nowMs + input.leaseMs,
  };
}

export function completeJob<TPayload>(
  job: JobRecord<TPayload>,
  input: { nowMs: number; workerId?: string },
): JobRecord<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertWorker(job, input.workerId);
  return {
    ...job,
    status: "succeeded",
    workerId: undefined,
    leaseUntilMs: undefined,
    finishedAtMs: input.nowMs,
    lastError: undefined,
  };
}

export function failJob<TPayload>(
  job: JobRecord<TPayload>,
  input: { nowMs: number; error: string; workerId?: string; backoff: JobBackoffPolicy },
): JobRecord<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.error, "error");
  assertWorker(job, input.workerId);
  const nextAttempt = job.attempt + 1;
  const terminal = nextAttempt >= job.maxAttempts;
  return {
    ...job,
    status: terminal ? "failed" : "retrying",
    attempt: nextAttempt,
    runAtMs: terminal
      ? input.nowMs
      : input.nowMs + calculateJobBackoffMs(nextAttempt, input.backoff),
    workerId: undefined,
    leaseUntilMs: undefined,
    lastError: input.error,
    finishedAtMs: terminal ? input.nowMs : undefined,
  };
}

export function cancelJob<TPayload>(
  job: JobRecord<TPayload>,
  input: { nowMs: number; reason?: string },
): JobRecord<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (job.status === "succeeded" || job.status === "failed") return job;
  return {
    ...job,
    status: "cancelled",
    workerId: undefined,
    leaseUntilMs: undefined,
    lastError: input.reason,
    finishedAtMs: input.nowMs,
  };
}

export function releaseExpiredLease<TPayload>(
  job: JobRecord<TPayload>,
  nowMs: number,
): JobRecord<TPayload> {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (job.status !== "running" || job.leaseUntilMs === undefined || nowMs < job.leaseUntilMs) {
    return job;
  }
  return {
    ...job,
    status: "ready",
    workerId: undefined,
    leaseUntilMs: undefined,
    lastError: "lease expired",
  };
}

export function compareRunnableJobs(left: JobRecord, right: JobRecord): number {
  return (
    right.priority - left.priority ||
    left.runAtMs - right.runAtMs ||
    left.createdAtMs - right.createdAtMs
  );
}

export function calculateJobBackoffMs(attempt: number, policy: JobBackoffPolicy): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * multiplier ** (attempt - 1)));
}

export function jobQueueSummary(jobs: readonly JobRecord[]): JobQueueSummary {
  return {
    scheduled: jobs.filter((job) => job.status === "scheduled").length,
    ready: jobs.filter((job) => job.status === "ready").length,
    running: jobs.filter((job) => job.status === "running").length,
    succeeded: jobs.filter((job) => job.status === "succeeded").length,
    retrying: jobs.filter((job) => job.status === "retrying").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    cancelled: jobs.filter((job) => job.status === "cancelled").length,
    total: jobs.length,
  };
}

export function cloneJobRecord<TPayload>(job: JobRecord<TPayload>): JobRecord<TPayload> {
  return {
    ...job,
    payload: cloneJson(job.payload) as TPayload,
  };
}

function assertWorker<TPayload>(job: JobRecord<TPayload>, workerId?: string): void {
  if (workerId && job.workerId && job.workerId !== workerId) {
    throw new Error("job is leased by another worker");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
