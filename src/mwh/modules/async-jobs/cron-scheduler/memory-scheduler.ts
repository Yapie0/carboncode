import {
  type CronTask,
  type CronTaskStatus,
  claimCronTask,
  cloneCronTask,
  completeCronTask,
  createCronTask,
  cronSchedulerSummary,
  failCronTask,
  releaseExpiredCronLease,
  setCronTaskEnabled,
} from "./core.js";

export interface MemoryCronSchedulerOptions {
  now?: () => number;
  defaultLeaseMs?: number;
  retryDelayMs?: number;
}

export type CronTaskProcessor = (task: CronTask) => Promise<void> | void;

export interface RunDueCronResult {
  task?: CronTask;
  processed: boolean;
}

export class MemoryCronScheduler {
  private readonly now: () => number;
  private readonly defaultLeaseMs: number;
  private readonly retryDelayMs: number;
  private readonly tasks = new Map<string, CronTask>();
  private readonly processors = new Map<string, CronTaskProcessor>();

  constructor(opts: MemoryCronSchedulerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.defaultLeaseMs = opts.defaultLeaseMs ?? 30_000;
    this.retryDelayMs = opts.retryDelayMs ?? 0;
  }

  register(input: {
    id: string;
    name: string;
    expression: string;
    payload: unknown;
  }): CronTask {
    if (this.tasks.has(input.id)) throw new Error(`cron task already exists: ${input.id}`);
    const task = createCronTask({ ...input, nowMs: this.now() });
    this.tasks.set(task.id, task);
    return cloneCronTask(task);
  }

  registerProcessor(name: string, processor: CronTaskProcessor): void {
    if (!name.trim()) throw new Error("name is required");
    this.processors.set(name, processor);
  }

  claimNext(workerId: string, opts: { leaseMs?: number } = {}): CronTask | undefined {
    const nowMs = this.now();
    const candidates = [...this.tasks.values()]
      .map((task) => releaseExpiredCronLease(task, nowMs))
      .sort(
        (left, right) => left.nextRunAtMs - right.nextRunAtMs || left.id.localeCompare(right.id),
      );

    for (const task of candidates) {
      this.tasks.set(task.id, task);
      const claimed = claimCronTask(task, {
        nowMs,
        workerId,
        leaseMs: opts.leaseMs ?? this.defaultLeaseMs,
      });
      if (claimed) {
        this.tasks.set(claimed.id, claimed);
        return cloneCronTask(claimed);
      }
    }
    return undefined;
  }

  complete(id: string, workerId: string): CronTask {
    const next = completeCronTask(this.require(id), { nowMs: this.now(), workerId });
    this.tasks.set(id, next);
    return cloneCronTask(next);
  }

  fail(id: string, workerId: string, error: string): CronTask {
    const next = failCronTask(this.require(id), {
      nowMs: this.now(),
      workerId,
      error,
      retryDelayMs: this.retryDelayMs,
    });
    this.tasks.set(id, next);
    return cloneCronTask(next);
  }

  async runDue(workerId: string): Promise<RunDueCronResult> {
    const claimed = this.claimNext(workerId);
    if (!claimed) return { processed: false };
    const processor = this.processors.get(claimed.name);
    if (!processor) {
      return {
        processed: true,
        task: this.fail(claimed.id, workerId, `missing processor: ${claimed.name}`),
      };
    }
    try {
      await Promise.resolve(processor(claimed));
      return { processed: true, task: this.complete(claimed.id, workerId) };
    } catch (error) {
      return { processed: true, task: this.fail(claimed.id, workerId, (error as Error).message) };
    }
  }

  setEnabled(id: string, enabled: boolean): CronTask {
    const next = setCronTaskEnabled(this.require(id), enabled, this.now());
    this.tasks.set(id, next);
    return cloneCronTask(next);
  }

  get(id: string): CronTask | undefined {
    const task = this.tasks.get(id);
    return task ? cloneCronTask(task) : undefined;
  }

  list(status?: CronTaskStatus): CronTask[] {
    const tasks = [...this.tasks.values()]
      .filter((task) => status === undefined || task.status === status)
      .sort(
        (left, right) => left.nextRunAtMs - right.nextRunAtMs || left.id.localeCompare(right.id),
      );
    return tasks.map(cloneCronTask);
  }

  summary(): ReturnType<typeof cronSchedulerSummary> {
    return cronSchedulerSummary(this.list(), { nowMs: this.now() });
  }

  private require(id: string): CronTask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`unknown cron task: ${id}`);
    return task;
  }
}
