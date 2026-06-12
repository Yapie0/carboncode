export type BullJobStatus =
  | "waiting"
  | "delayed"
  | "active"
  | "completed"
  | "retrying"
  | "dead-lettered";

export interface BullJobOptions {
  attempts?: number;
  delayMs?: number;
  priority?: number;
  backoffMs?: number;
}

export interface BullJob<Data = unknown, Result = unknown> {
  id: string;
  queueName: string;
  name: string;
  data: Data;
  status: BullJobStatus;
  attempts: number;
  attemptsMade: number;
  priority: number;
  createdAtMs: number;
  availableAtMs: number;
  activeAtMs?: number;
  lockedBy?: string;
  lockUntilMs?: number;
  finishedAtMs?: number;
  failedReason?: string;
  result?: Result;
}

export interface BullBackoffPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier?: number;
}

export function createBullJob<Data>(input: {
  id: string;
  queueName: string;
  name: string;
  data: Data;
  nowMs: number;
  options?: BullJobOptions;
}): BullJob<Data> {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.queueName, "queueName");
  assertNonEmpty(input.name, "name");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const attempts = input.options?.attempts ?? 1;
  const delayMs = input.options?.delayMs ?? 0;
  const priority = input.options?.priority ?? 0;
  assertPositiveInteger(attempts, "attempts");
  assertNonNegativeInteger(delayMs, "delayMs");
  assertNonNegativeInteger(priority, "priority");
  return {
    id: input.id,
    queueName: input.queueName,
    name: input.name,
    data: cloneJson(input.data) as Data,
    status: delayMs > 0 ? "delayed" : "waiting",
    attempts,
    attemptsMade: 0,
    priority,
    createdAtMs: input.nowMs,
    availableAtMs: input.nowMs + delayMs,
  };
}

export function promoteDelayedBullJob<Data, Result>(
  job: BullJob<Data, Result>,
  nowMs: number,
): BullJob<Data, Result> {
  assertNonNegativeInteger(nowMs, "nowMs");
  if ((job.status === "delayed" || job.status === "retrying") && nowMs >= job.availableAtMs) {
    return { ...job, status: "waiting" };
  }
  return job;
}

export function releaseStalledBullJob<Data, Result>(
  job: BullJob<Data, Result>,
  nowMs: number,
): BullJob<Data, Result> {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (job.status !== "active" || job.lockUntilMs === undefined || nowMs < job.lockUntilMs) {
    return job;
  }
  return {
    ...job,
    status: "waiting",
    lockedBy: undefined,
    lockUntilMs: undefined,
    failedReason: "lock expired",
  };
}

export function claimBullJob<Data, Result>(
  job: BullJob<Data, Result>,
  input: { nowMs: number; workerId: string; lockMs: number },
): BullJob<Data, Result> | undefined {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.workerId, "workerId");
  assertPositiveInteger(input.lockMs, "lockMs");
  const runnable = releaseStalledBullJob(promoteDelayedBullJob(job, input.nowMs), input.nowMs);
  if (runnable.status !== "waiting") return undefined;
  return {
    ...runnable,
    status: "active",
    activeAtMs: input.nowMs,
    lockedBy: input.workerId,
    lockUntilMs: input.nowMs + input.lockMs,
  };
}

export function completeBullJob<Data, Result>(
  job: BullJob<Data, Result>,
  input: { nowMs: number; workerId?: string; result?: Result },
): BullJob<Data, Result> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertWorker(job, input.workerId);
  if (job.status !== "active") throw new Error(`cannot complete job from ${job.status}`);
  return {
    ...job,
    status: "completed",
    result: cloneJson(input.result) as Result,
    finishedAtMs: input.nowMs,
    lockedBy: undefined,
    lockUntilMs: undefined,
    failedReason: undefined,
  };
}

export function failBullJob<Data, Result>(
  job: BullJob<Data, Result>,
  input: {
    nowMs: number;
    workerId?: string;
    error: string;
    backoff: BullBackoffPolicy;
  },
): BullJob<Data, Result> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.error, "error");
  assertWorker(job, input.workerId);
  if (job.status !== "active") throw new Error(`cannot fail job from ${job.status}`);
  const attemptsMade = job.attemptsMade + 1;
  const terminal = attemptsMade >= job.attempts;
  return {
    ...job,
    status: terminal ? "dead-lettered" : "retrying",
    attemptsMade,
    availableAtMs: terminal
      ? input.nowMs
      : input.nowMs + calculateBullBackoffMs(attemptsMade, input.backoff),
    finishedAtMs: terminal ? input.nowMs : undefined,
    lockedBy: undefined,
    lockUntilMs: undefined,
    failedReason: input.error,
  };
}

export function compareBullRunnableJobs(left: BullJob, right: BullJob): number {
  return (
    right.priority - left.priority ||
    left.availableAtMs - right.availableAtMs ||
    left.createdAtMs - right.createdAtMs ||
    left.id.localeCompare(right.id)
  );
}

export function calculateBullBackoffMs(attempt: number, policy: BullBackoffPolicy): number {
  assertPositiveInteger(attempt, "attempt");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
  const multiplier = policy.multiplier ?? 2;
  if (!Number.isFinite(multiplier) || multiplier < 1) throw new Error("multiplier must be >= 1");
  return Math.min(policy.maxDelayMs, Math.round(policy.baseDelayMs * multiplier ** (attempt - 1)));
}

function assertWorker<Data, Result>(job: BullJob<Data, Result>, workerId?: string): void {
  if (workerId && job.lockedBy && job.lockedBy !== workerId) {
    throw new Error("job is locked by another worker");
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
