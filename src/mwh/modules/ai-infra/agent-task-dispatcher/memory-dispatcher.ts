import {
  type AgentAssignment,
  type AgentStatus,
  type AgentTask,
  type AgentWorker,
  cancelAgentTask,
  chooseAgentForTask,
  claimAgentTask,
  cloneAgentTask,
  cloneAgentWorker,
  compareQueuedTasks,
  createAgentTask,
  createAgentWorker,
  finishAgentTask,
  requeueAgentTask,
} from "./core.js";

export class MemoryAgentTaskDispatcher<TPayload = unknown> {
  private readonly now: () => number;
  private readonly workers = new Map<string, AgentWorker>();
  private readonly tasks = new Map<string, AgentTask<TPayload>>();

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  upsertWorker(input: {
    id: string;
    capabilities: readonly string[];
    priority?: number;
    maxConcurrentTasks?: number;
    status?: AgentStatus;
  }): AgentWorker {
    const existing = this.workers.get(input.id);
    const worker = createAgentWorker({
      ...input,
      activeTaskIds: existing?.activeTaskIds ?? [],
      nowMs: this.now(),
    });
    this.workers.set(worker.id, worker);
    return cloneAgentWorker(worker);
  }

  enqueue(input: {
    id: string;
    type: string;
    payload: TPayload;
    requiredCapabilities: readonly string[];
    priority?: number;
  }): AgentTask<TPayload> {
    if (this.tasks.has(input.id)) throw new Error("task already exists");
    const task = createAgentTask({ ...input, nowMs: this.now() });
    this.tasks.set(task.id, task);
    return cloneAgentTask(task);
  }

  dispatchNext(): AgentAssignment<TPayload> | undefined {
    const queued = [...this.tasks.values()]
      .filter((task) => task.status === "queued")
      .sort(compareQueuedTasks);
    for (const task of queued) {
      const worker = chooseAgentForTask([...this.workers.values()], task);
      if (!worker) continue;
      const assignment = claimAgentTask(task, worker, { nowMs: this.now() });
      this.tasks.set(task.id, assignment.task);
      this.workers.set(worker.id, assignment.agent);
      return {
        task: cloneAgentTask(assignment.task),
        agent: cloneAgentWorker(assignment.agent),
      };
    }
    return undefined;
  }

  dispatchMany(limit = Number.MAX_SAFE_INTEGER): AgentAssignment<TPayload>[] {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const assignments: AgentAssignment<TPayload>[] = [];
    while (assignments.length < limit) {
      const assignment = this.dispatchNext();
      if (!assignment) break;
      assignments.push(assignment);
    }
    return assignments;
  }

  finish(input: {
    taskId: string;
    agentId: string;
    status: "succeeded" | "failed";
    error?: string;
  }): AgentAssignment<TPayload> {
    const task = this.mustGetTask(input.taskId);
    const worker = this.mustGetWorker(input.agentId);
    const next = finishAgentTask(task, worker, {
      status: input.status,
      error: input.error,
      nowMs: this.now(),
    });
    this.tasks.set(task.id, next.task);
    this.workers.set(worker.id, next.agent);
    return {
      task: cloneAgentTask(next.task),
      agent: cloneAgentWorker(next.agent),
    };
  }

  requeue(input: { taskId: string; agentId: string; reason?: string }): AgentAssignment<TPayload> {
    const task = this.mustGetTask(input.taskId);
    const worker = this.mustGetWorker(input.agentId);
    const next = requeueAgentTask(task, worker, {
      reason: input.reason,
      nowMs: this.now(),
    });
    this.tasks.set(task.id, next.task);
    this.workers.set(worker.id, next.agent);
    return {
      task: cloneAgentTask(next.task),
      agent: cloneAgentWorker(next.agent),
    };
  }

  requeueRunningForAgent(agentId: string, reason?: string): AgentTask<TPayload>[] {
    const worker = this.mustGetWorker(agentId);
    const running = [...this.tasks.values()].filter(
      (task) => task.status === "running" && task.assignedAgentId === agentId,
    );
    const requeued: AgentTask<TPayload>[] = [];
    for (const task of running) {
      const currentWorker = this.mustGetWorker(agentId);
      const next = requeueAgentTask(task, currentWorker, { reason, nowMs: this.now() });
      this.tasks.set(task.id, next.task);
      this.workers.set(worker.id, next.agent);
      requeued.push(cloneAgentTask(next.task));
    }
    return requeued.sort(compareQueuedTasks);
  }

  cancel(input: { taskId: string; reason?: string }): AgentTask<TPayload> {
    const task = this.mustGetTask(input.taskId);
    const next = cancelAgentTask(task, { reason: input.reason, nowMs: this.now() });
    this.tasks.set(task.id, next);
    if (task.assignedAgentId) {
      const worker = this.workers.get(task.assignedAgentId);
      if (worker) {
        this.workers.set(worker.id, {
          ...worker,
          activeTaskIds: worker.activeTaskIds.filter((id) => id !== task.id),
          updatedAtMs: this.now(),
        });
      }
    }
    return cloneAgentTask(next);
  }

  setWorkerStatus(agentId: string, status: AgentStatus): AgentWorker {
    const worker = this.mustGetWorker(agentId);
    const next = createAgentWorker({
      ...worker,
      status,
      nowMs: this.now(),
    });
    this.workers.set(agentId, next);
    return cloneAgentWorker(next);
  }

  listTasks(status?: AgentTask<TPayload>["status"]): AgentTask<TPayload>[] {
    return [...this.tasks.values()]
      .filter((task) => status === undefined || task.status === status)
      .sort(compareQueuedTasks)
      .map(cloneAgentTask);
  }

  listWorkers(): AgentWorker[] {
    return [...this.workers.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneAgentWorker);
  }

  queueDepth(): {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
  } {
    const tasks = [...this.tasks.values()];
    return {
      queued: tasks.filter((task) => task.status === "queued").length,
      running: tasks.filter((task) => task.status === "running").length,
      succeeded: tasks.filter((task) => task.status === "succeeded").length,
      failed: tasks.filter((task) => task.status === "failed").length,
      cancelled: tasks.filter((task) => task.status === "cancelled").length,
    };
  }

  private mustGetTask(taskId: string): AgentTask<TPayload> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("task not found");
    return task;
  }

  private mustGetWorker(agentId: string): AgentWorker {
    const worker = this.workers.get(agentId);
    if (!worker) throw new Error("agent not found");
    return worker;
  }
}
