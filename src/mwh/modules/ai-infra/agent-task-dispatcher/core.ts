export type AgentStatus = "healthy" | "degraded" | "offline";
export type AgentTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentWorker {
  id: string;
  capabilities: readonly string[];
  priority: number;
  maxConcurrentTasks: number;
  activeTaskIds: readonly string[];
  status: AgentStatus;
  updatedAtMs: number;
}

export interface AgentTask<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  requiredCapabilities: readonly string[];
  priority: number;
  status: AgentTaskStatus;
  createdAtMs: number;
  assignedAgentId?: string;
  startedAtMs?: number;
  finishedAtMs?: number;
  lastError?: string;
}

export interface AgentAssignment<TPayload = unknown> {
  task: AgentTask<TPayload>;
  agent: AgentWorker;
}

export function createAgentWorker(input: {
  id: string;
  capabilities: readonly string[];
  priority?: number;
  maxConcurrentTasks?: number;
  activeTaskIds?: readonly string[];
  status?: AgentStatus;
  nowMs: number;
}): AgentWorker {
  assertNonEmpty(input.id, "id");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const capabilities = normalizeCapabilities(input.capabilities);
  const maxConcurrentTasks = input.maxConcurrentTasks ?? 1;
  assertPositiveInteger(maxConcurrentTasks, "maxConcurrentTasks");
  if ((input.activeTaskIds?.length ?? 0) > maxConcurrentTasks) {
    throw new Error("activeTaskIds cannot exceed maxConcurrentTasks");
  }
  return {
    id: input.id,
    capabilities,
    priority: input.priority ?? 0,
    maxConcurrentTasks,
    activeTaskIds: [...(input.activeTaskIds ?? [])],
    status: input.status ?? "healthy",
    updatedAtMs: input.nowMs,
  };
}

export function createAgentTask<TPayload>(input: {
  id: string;
  type: string;
  payload: TPayload;
  requiredCapabilities: readonly string[];
  nowMs: number;
  priority?: number;
}): AgentTask<TPayload> {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.type, "type");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    id: input.id,
    type: input.type,
    payload: cloneValue(input.payload),
    requiredCapabilities: normalizeCapabilities(input.requiredCapabilities),
    priority: input.priority ?? 0,
    status: "queued",
    createdAtMs: input.nowMs,
  };
}

export function agentCanRunTask(worker: AgentWorker, task: AgentTask): boolean {
  if (worker.status === "offline") return false;
  if (task.status !== "queued") return false;
  if (worker.activeTaskIds.length >= worker.maxConcurrentTasks) return false;
  const capabilities = new Set(worker.capabilities);
  return task.requiredCapabilities.every((capability) => capabilities.has(capability));
}

export function chooseAgentForTask(
  workers: readonly AgentWorker[],
  task: AgentTask,
): AgentWorker | undefined {
  return workers.filter((worker) => agentCanRunTask(worker, task)).sort(compareAssignableAgents)[0];
}

export function compareQueuedTasks(left: AgentTask, right: AgentTask): number {
  return (
    right.priority - left.priority ||
    left.createdAtMs - right.createdAtMs ||
    left.id.localeCompare(right.id)
  );
}

export function claimAgentTask<TPayload>(
  task: AgentTask<TPayload>,
  worker: AgentWorker,
  input: { nowMs: number },
): AgentAssignment<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (!agentCanRunTask(worker, task)) throw new Error("agent cannot run task");
  return {
    task: {
      ...cloneAgentTask(task),
      status: "running",
      assignedAgentId: worker.id,
      startedAtMs: input.nowMs,
    },
    agent: {
      ...cloneAgentWorker(worker),
      activeTaskIds: [...worker.activeTaskIds, task.id],
      updatedAtMs: input.nowMs,
    },
  };
}

export function finishAgentTask<TPayload>(
  task: AgentTask<TPayload>,
  worker: AgentWorker,
  input: { status: "succeeded" | "failed"; nowMs: number; error?: string },
): AgentAssignment<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (task.status !== "running") throw new Error("task must be running");
  if (task.assignedAgentId !== worker.id) throw new Error("task is assigned to another agent");
  return {
    task: {
      ...cloneAgentTask(task),
      status: input.status,
      finishedAtMs: input.nowMs,
      lastError: input.status === "failed" ? (input.error ?? "task failed") : undefined,
    },
    agent: {
      ...cloneAgentWorker(worker),
      activeTaskIds: worker.activeTaskIds.filter((id) => id !== task.id),
      updatedAtMs: input.nowMs,
    },
  };
}

export function requeueAgentTask<TPayload>(
  task: AgentTask<TPayload>,
  worker: AgentWorker,
  input: { nowMs: number; reason?: string },
): AgentAssignment<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (task.status !== "running") throw new Error("task must be running");
  if (task.assignedAgentId !== worker.id) throw new Error("task is assigned to another agent");
  return {
    task: {
      ...cloneAgentTask(task),
      status: "queued",
      assignedAgentId: undefined,
      startedAtMs: undefined,
      lastError: input.reason,
    },
    agent: {
      ...cloneAgentWorker(worker),
      activeTaskIds: worker.activeTaskIds.filter((id) => id !== task.id),
      updatedAtMs: input.nowMs,
    },
  };
}

export function cancelAgentTask<TPayload>(
  task: AgentTask<TPayload>,
  input: { nowMs: number; reason?: string },
): AgentTask<TPayload> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (task.status === "succeeded" || task.status === "failed") return cloneAgentTask(task);
  return {
    ...cloneAgentTask(task),
    status: "cancelled",
    finishedAtMs: input.nowMs,
    lastError: input.reason,
  };
}

export function cloneAgentWorker(worker: AgentWorker): AgentWorker {
  return {
    ...worker,
    capabilities: [...worker.capabilities],
    activeTaskIds: [...worker.activeTaskIds],
  };
}

export function cloneAgentTask<TPayload>(task: AgentTask<TPayload>): AgentTask<TPayload> {
  return {
    ...task,
    payload: cloneValue(task.payload),
    requiredCapabilities: [...task.requiredCapabilities],
  };
}

function compareAssignableAgents(left: AgentWorker, right: AgentWorker): number {
  return (
    statusRank(left.status) - statusRank(right.status) ||
    left.activeTaskIds.length - right.activeTaskIds.length ||
    right.priority - left.priority ||
    left.id.localeCompare(right.id)
  );
}

function statusRank(status: AgentStatus): number {
  if (status === "healthy") return 0;
  if (status === "degraded") return 1;
  return 2;
}

function normalizeCapabilities(capabilities: readonly string[]): string[] {
  const normalized = capabilities
    .map((capability) => capability.trim())
    .filter(Boolean)
    .sort();
  if (!normalized.length) throw new Error("capabilities are required");
  return [...new Set(normalized)];
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

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
