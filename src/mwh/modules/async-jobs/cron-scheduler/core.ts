export type CronTaskStatus = "enabled" | "disabled" | "running" | "failed";

export interface CronSchedule {
  minute: string;
  hour: string;
}

export interface CronTask {
  id: string;
  name: string;
  schedule: CronSchedule;
  payload: unknown;
  status: CronTaskStatus;
  createdAtMs: number;
  updatedAtMs: number;
  nextRunAtMs: number;
  lastRunAtMs?: number;
  runningBy?: string;
  leaseUntilMs?: number;
  lastError?: string;
}

export interface CronSchedulerSummary {
  enabled: number;
  disabled: number;
  running: number;
  failed: number;
  due: number;
  total: number;
}

export function parseCronExpression(expression: string): CronSchedule {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 2) throw new Error("cron expression must contain minute and hour fields");
  validateCronField(parts[0]!, 0, 59, "minute");
  validateCronField(parts[1]!, 0, 23, "hour");
  return { minute: parts[0]!, hour: parts[1]! };
}

export function createCronTask(input: {
  id: string;
  name: string;
  expression: string;
  payload: unknown;
  nowMs: number;
}): CronTask {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.name, "name");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const schedule = parseCronExpression(input.expression);
  return {
    id: input.id,
    name: input.name,
    schedule,
    payload: cloneJson(input.payload),
    status: "enabled",
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    nextRunAtMs: nextCronRunAt(schedule, input.nowMs),
  };
}

export function nextCronRunAt(schedule: CronSchedule, afterMs: number): number {
  assertNonNegativeInteger(afterMs, "afterMs");
  const start = floorToNextMinute(afterMs);
  const limit = start + 366 * 24 * 60 * 60_000;
  for (let candidate = start; candidate <= limit; candidate += 60_000) {
    const date = new Date(candidate);
    if (
      cronFieldMatches(schedule.minute, date.getUTCMinutes(), 0, 59) &&
      cronFieldMatches(schedule.hour, date.getUTCHours(), 0, 23)
    ) {
      return candidate;
    }
  }
  throw new Error("cron schedule did not produce a run within one year");
}

export function cronTaskDue(task: CronTask, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return task.status === "enabled" && nowMs >= task.nextRunAtMs;
}

export function claimCronTask(
  task: CronTask,
  input: { nowMs: number; workerId: string; leaseMs: number },
): CronTask | undefined {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.leaseMs, "leaseMs");
  assertNonEmpty(input.workerId, "workerId");
  const released = releaseExpiredCronLease(task, input.nowMs);
  if (!cronTaskDue(released, input.nowMs)) return undefined;
  return {
    ...released,
    status: "running",
    runningBy: input.workerId,
    leaseUntilMs: input.nowMs + input.leaseMs,
    updatedAtMs: input.nowMs,
  };
}

export function completeCronTask(
  task: CronTask,
  input: { nowMs: number; workerId?: string },
): CronTask {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertCronOwner(task, input.workerId);
  if (task.status !== "running") throw new Error(`cannot complete cron task from ${task.status}`);
  return {
    ...task,
    status: "enabled",
    runningBy: undefined,
    leaseUntilMs: undefined,
    lastRunAtMs: input.nowMs,
    nextRunAtMs: nextCronRunAt(task.schedule, input.nowMs),
    updatedAtMs: input.nowMs,
    lastError: undefined,
  };
}

export function failCronTask(
  task: CronTask,
  input: { nowMs: number; error: string; workerId?: string; retryDelayMs?: number },
): CronTask {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonEmpty(input.error, "error");
  assertCronOwner(task, input.workerId);
  if (task.status !== "running") throw new Error(`cannot fail cron task from ${task.status}`);
  const retryDelayMs = input.retryDelayMs ?? 0;
  assertNonNegativeInteger(retryDelayMs, "retryDelayMs");
  return {
    ...task,
    status: retryDelayMs > 0 ? "enabled" : "failed",
    runningBy: undefined,
    leaseUntilMs: undefined,
    nextRunAtMs:
      retryDelayMs > 0 ? input.nowMs + retryDelayMs : nextCronRunAt(task.schedule, input.nowMs),
    updatedAtMs: input.nowMs,
    lastError: input.error,
  };
}

export function releaseExpiredCronLease(task: CronTask, nowMs: number): CronTask {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (task.status !== "running" || task.leaseUntilMs === undefined || nowMs < task.leaseUntilMs) {
    return task;
  }
  return {
    ...task,
    status: "enabled",
    runningBy: undefined,
    leaseUntilMs: undefined,
    updatedAtMs: nowMs,
    lastError: "lease expired",
  };
}

export function setCronTaskEnabled(task: CronTask, enabled: boolean, nowMs: number): CronTask {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (task.status === "running") throw new Error("cannot change enabled state while running");
  return {
    ...task,
    status: enabled ? "enabled" : "disabled",
    updatedAtMs: nowMs,
  };
}

export function cronSchedulerSummary(
  tasks: readonly CronTask[],
  input: { nowMs: number },
): CronSchedulerSummary {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    enabled: tasks.filter((task) => task.status === "enabled").length,
    disabled: tasks.filter((task) => task.status === "disabled").length,
    running: tasks.filter((task) => task.status === "running").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    due: tasks.filter((task) => cronTaskDue(task, input.nowMs)).length,
    total: tasks.length,
  };
}

export function cloneCronTask(task: CronTask): CronTask {
  return {
    ...task,
    payload: cloneJson(task.payload),
  };
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  validateCronField(field, min, max, "field");
  if (field === "*") return true;
  if (field.startsWith("*/")) return value % Number(field.slice(2)) === 0;
  return value === Number(field);
}

function validateCronField(field: string, min: number, max: number, name: string): void {
  if (field === "*") return;
  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    if (!Number.isInteger(step) || step <= 0 || step > max - min + 1) {
      throw new Error(`${name} step is invalid`);
    }
    return;
  }
  const value = Number(field);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} field is invalid`);
  }
}

function floorToNextMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000 + 60_000;
}

function assertCronOwner(task: CronTask, workerId?: string): void {
  if (workerId && task.runningBy && task.runningBy !== workerId) {
    throw new Error("cron task is leased by another worker");
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return null;
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
