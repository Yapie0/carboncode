import {
  type BullBackoffPolicy,
  type BullJob,
  type BullJobOptions,
  claimBullJob,
  compareBullRunnableJobs,
  completeBullJob,
  createBullJob,
  failBullJob,
  promoteDelayedBullJob,
  releaseStalledBullJob,
} from "./core.js";

export type BullProcessor<Data = unknown, Result = unknown> = (job: BullJob<Data>) => Result;

export interface ProcessBullJobResult {
  job?: BullJob;
  processed: boolean;
}

export interface MemoryBullQueueOptions {
  now?: () => number;
  defaultLockMs?: number;
  backoff?: BullBackoffPolicy;
}

export class MemoryBullQueue {
  private readonly now: () => number;
  private readonly defaultLockMs: number;
  private readonly backoff: BullBackoffPolicy;
  private readonly jobs = new Map<string, BullJob>();
  private readonly processors = new Map<string, BullProcessor>();

  constructor(options: MemoryBullQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultLockMs = options.defaultLockMs ?? 30_000;
    this.backoff = options.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
  }

  registerProcessor(name: string, processor: BullProcessor): void {
    if (!name.trim()) throw new Error("name is required");
    this.processors.set(name, processor);
  }

  add<Data>(input: {
    id: string;
    queueName: string;
    name: string;
    data: Data;
    options?: BullJobOptions;
  }): BullJob<Data> {
    if (this.jobs.has(input.id)) throw new Error(`job already exists: ${input.id}`);
    const job = createBullJob({ ...input, nowMs: this.now() });
    this.jobs.set(job.id, job);
    return cloneJob(job);
  }

  claimNext(queueName: string, workerId: string, lockMs = this.defaultLockMs): BullJob | undefined {
    const nowMs = this.now();
    const candidates = [...this.jobs.values()]
      .filter((job) => job.queueName === queueName)
      .map((job) => releaseStalledBullJob(promoteDelayedBullJob(job, nowMs), nowMs))
      .sort(compareBullRunnableJobs);

    for (const job of candidates) {
      this.jobs.set(job.id, job);
      const claimed = claimBullJob(job, { nowMs, workerId, lockMs });
      if (!claimed) continue;
      this.jobs.set(claimed.id, claimed);
      return cloneJob(claimed);
    }
    return undefined;
  }

  processNext(queueName: string, workerId: string): ProcessBullJobResult {
    const claimed = this.claimNext(queueName, workerId);
    if (!claimed) return { processed: false };
    const processor = this.processors.get(claimed.name);
    if (!processor) {
      const failed = this.fail(claimed.id, workerId, `missing processor: ${claimed.name}`);
      return { processed: true, job: failed };
    }
    try {
      const result = processor(claimed);
      return { processed: true, job: this.complete(claimed.id, workerId, result) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { processed: true, job: this.fail(claimed.id, workerId, message) };
    }
  }

  complete<Result>(id: string, workerId: string, result?: Result): BullJob {
    const next = completeBullJob(this.require(id), { nowMs: this.now(), workerId, result });
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  fail(id: string, workerId: string, error: string): BullJob {
    const next = failBullJob(this.require(id), {
      nowMs: this.now(),
      workerId,
      error,
      backoff: this.backoff,
    });
    this.jobs.set(id, next);
    return cloneJob(next);
  }

  get(id: string): BullJob | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  list(queueName?: string): BullJob[] {
    return [...this.jobs.values()]
      .filter((job) => !queueName || job.queueName === queueName)
      .map(cloneJob);
  }

  private require(id: string): BullJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`unknown job: ${id}`);
    return job;
  }
}

function cloneJob<T extends BullJob>(job: T): T {
  return JSON.parse(JSON.stringify(job)) as T;
}
