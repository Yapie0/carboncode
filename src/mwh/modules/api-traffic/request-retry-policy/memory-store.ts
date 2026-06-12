import {
  type RequestRetryPolicy,
  type RetryAttemptFailure,
  type RetryExecution,
  type RetryExecutionSnapshot,
  cancelRetryExecution,
  cloneRetryExecution,
  createRetryExecution,
  nextRetryAtMs,
  recordRetryFailure,
  recordRetrySuccess,
  retryExecutionSnapshot,
} from "./core.js";

export interface MemoryRetryExecutionStoreOptions {
  policy: RequestRetryPolicy;
  now?: () => number;
}

export class MemoryRetryExecutionStore {
  private readonly executions = new Map<string, RetryExecution>();
  private readonly policy: RequestRetryPolicy;
  private readonly now: () => number;

  constructor(options: MemoryRetryExecutionStoreOptions) {
    this.policy = clonePolicy(options.policy);
    this.now = options.now ?? Date.now;
  }

  start(input: { id: string; deadlineAtMs?: number }): RetryExecution {
    if (this.executions.has(input.id)) throw new Error("retry execution already exists");
    const execution = createRetryExecution({
      id: input.id,
      nowMs: this.now(),
      deadlineAtMs: input.deadlineAtMs,
    });
    this.executions.set(input.id, execution);
    return cloneRetryExecution(execution);
  }

  recordFailure(id: string, failure: RetryAttemptFailure): RetryExecution {
    const execution = recordRetryFailure(this.requireExecution(id), {
      failure,
      nowMs: this.now(),
      policy: this.policy,
    });
    this.executions.set(id, execution);
    return cloneRetryExecution(execution);
  }

  recordSuccess(id: string): RetryExecution {
    const execution = recordRetrySuccess(this.requireExecution(id), this.now());
    this.executions.set(id, execution);
    return cloneRetryExecution(execution);
  }

  cancel(id: string): RetryExecution {
    const execution = cancelRetryExecution(this.requireExecution(id), { nowMs: this.now() });
    this.executions.set(id, execution);
    return cloneRetryExecution(execution);
  }

  dueExecutions(): RetryExecution[] {
    const nowMs = this.now();
    return [...this.executions.values()]
      .filter((execution) => execution.status === "active")
      .filter((execution) => {
        const nextAt = nextRetryAtMs(execution);
        return nextAt === undefined || nextAt <= nowMs;
      })
      .sort(
        (left, right) => left.startedAtMs - right.startedAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneRetryExecution);
  }

  list(): RetryExecution[] {
    return [...this.executions.values()].map(cloneRetryExecution);
  }

  snapshot(): RetryExecutionSnapshot {
    return retryExecutionSnapshot([...this.executions.values()]);
  }

  private requireExecution(id: string): RetryExecution {
    const execution = this.executions.get(id);
    if (!execution) throw new Error("retry execution not found");
    return cloneRetryExecution(execution);
  }
}

function clonePolicy(policy: RequestRetryPolicy): RequestRetryPolicy {
  return {
    ...policy,
    retryableMethods: [...policy.retryableMethods].map((method) => method.toUpperCase()),
    retryableStatusCodes: [...policy.retryableStatusCodes],
  };
}
