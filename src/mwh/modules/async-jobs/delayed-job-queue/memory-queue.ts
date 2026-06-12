import {
  type JobBackoffPolicy,
  type JobRecord,
  cancelJob,
  claimJob,
  cloneJobRecord,
  compareRunnableJobs,
  completeJob,
  createJob,
  failJob,
  jobQueueSummary,
  releaseDueJob,
  releaseExpiredLease,
} from "./core.js";

export interface MemoryDelayedJobQueueOptions {
  now?: () => number;
  backoff?: JobBackoffPolicy;
  defaultLeaseMs?: number;
}

export type DelayedJobProcessor<TPayload = unknown, TResult = unknown> = (
  job: JobRecord<TPayload>,
) => Promise<TResult> | TResult;

export interface ProcessDelayedJobResult {
  job?: JobRecord;
  processed: boolean;
}

export class MemoryDelayedJobQueue {
  private readonly now: () => number;
  private readonly backoff: JobBackoffPolicy;
  private readonly defaultLeaseMs: number;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly processors = new Map<string, DelayedJobProcessor>();

  constructor(opts: MemoryDelayedJobQueueOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.backoff = opts.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    this.defaultLeaseMs = opts.defaultLeaseMs ?? 30_000;
  }

  enqueue<TPayload>(
    input: Omit<Parameters<typeof createJob<TPayload>>[0], "nowMs">,
  ): JobRecord<TPayload> {
    if (this.jobs.has(input.id)) throw new Error(`job already exists: ${input.id}`);
    const job = createJob({ ...input, nowMs: this.now() });
    this.jobs.set(job.id, job);
    return cloneJobRecord(job);
  }

  registerProcessor(type: string, processor: DelayedJobProcessor): void {
    if (!type.trim()) throw new Error("type is required");
    this.processors.set(type, processor);
  }

  claimNext(
    queue: string,
    workerId: string,
    opts: { leaseMs?: number } = {},
  ): JobRecord | undefined {
    const nowMs = this.now();
    const candidates = [...this.jobs.values()]
      .filter((job) => job.queue === queue)
      .map((job) => releaseExpiredLease(releaseDueJob(job, nowMs), nowMs))
      .sort(compareRunnableJobs);

    for (const job of candidates) {
      this.jobs.set(job.id, job);
      const claimed = claimJob(job, {
        nowMs,
        workerId,
        leaseMs: opts.leaseMs ?? this.defaultLeaseMs,
      });
      if (claimed) {
        this.jobs.set(claimed.id, claimed);
        return cloneJobRecord(claimed);
      }
    }
    return undefined;
  }

  async processNext(queue: string, workerId: string): Promise<ProcessDelayedJobResult> {
    const claimed = this.claimNext(queue, workerId);
    if (!claimed) return { processed: false };
    const processor = this.processors.get(claimed.type);
    if (!processor) {
      return {
        processed: true,
        job: this.fail(claimed.id, workerId, `missing processor: ${claimed.type}`),
      };
    }
    try {
      await Promise.resolve(processor(claimed));
      return { processed: true, job: this.complete(claimed.id, workerId) };
    } catch (error) {
      return {
        processed: true,
        job: this.fail(claimed.id, workerId, (error as Error).message),
      };
    }
  }

  complete(id: string, workerId: string): JobRecord {
    const next = completeJob(this.require(id), { nowMs: this.now(), workerId });
    this.jobs.set(id, next);
    return cloneJobRecord(next);
  }

  fail(id: string, workerId: string, error: string): JobRecord {
    const next = failJob(this.require(id), {
      nowMs: this.now(),
      workerId,
      error,
      backoff: this.backoff,
    });
    this.jobs.set(id, next);
    return cloneJobRecord(next);
  }

  cancel(id: string, reason?: string): JobRecord {
    const next = cancelJob(this.require(id), { nowMs: this.now(), reason });
    this.jobs.set(id, next);
    return cloneJobRecord(next);
  }

  get(id: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJobRecord(job) : undefined;
  }

  list(queue?: string): JobRecord[] {
    return [...this.jobs.values()]
      .filter((job) => queue === undefined || job.queue === queue)
      .map(cloneJobRecord);
  }

  summary(queue?: string): ReturnType<typeof jobQueueSummary> {
    return jobQueueSummary(this.list(queue));
  }

  private require(id: string): JobRecord {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`unknown job: ${id}`);
    return job;
  }
}
