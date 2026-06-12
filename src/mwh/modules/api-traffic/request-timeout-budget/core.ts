export type TimeoutBudgetStatus = "active" | "expired" | "cancelled" | "completed";

export interface TimeoutBudget {
  id: string;
  parentId?: string;
  startedAtMs: number;
  deadlineAtMs: number;
  status: TimeoutBudgetStatus;
  reason?: string;
}

export interface TimeoutBudgetState {
  budgets: readonly TimeoutBudget[];
}

export interface TimeoutBudgetSnapshot {
  total: number;
  active: number;
  expired: number;
  cancelled: number;
  completed: number;
}

export interface TimeoutBudgetHeaders {
  "x-request-deadline-ms": string;
  "x-request-timeout-ms": string;
}

export function createTimeoutBudget(input: {
  id: string;
  nowMs: number;
  timeoutMs: number;
  parentId?: string;
  parentDeadlineAtMs?: number;
}): TimeoutBudget {
  assertNonEmpty(input.id, "id");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.timeoutMs, "timeoutMs");
  if (input.parentId) assertNonEmpty(input.parentId, "parentId");
  if (input.parentDeadlineAtMs !== undefined) {
    assertNonNegativeInteger(input.parentDeadlineAtMs, "parentDeadlineAtMs");
  }
  const requestedDeadline = input.nowMs + input.timeoutMs;
  return {
    id: input.id,
    parentId: input.parentId,
    startedAtMs: input.nowMs,
    deadlineAtMs:
      input.parentDeadlineAtMs === undefined
        ? requestedDeadline
        : Math.min(requestedDeadline, input.parentDeadlineAtMs),
    status: "active",
  };
}

export function deriveChildBudget(
  parent: TimeoutBudget,
  input: {
    id: string;
    nowMs: number;
    timeoutMs: number;
  },
): TimeoutBudget {
  assertActive(parent, input.nowMs);
  return createTimeoutBudget({
    id: input.id,
    nowMs: input.nowMs,
    timeoutMs: input.timeoutMs,
    parentId: parent.id,
    parentDeadlineAtMs: parent.deadlineAtMs,
  });
}

export function remainingBudgetMs(budget: TimeoutBudget, nowMs: number): number {
  assertNonNegativeInteger(nowMs, "nowMs");
  return Math.max(0, budget.deadlineAtMs - nowMs);
}

export function timeoutBudgetHeaders(budget: TimeoutBudget, nowMs: number): TimeoutBudgetHeaders {
  assertNonNegativeInteger(nowMs, "nowMs");
  return {
    "x-request-deadline-ms": String(budget.deadlineAtMs),
    "x-request-timeout-ms": String(remainingBudgetMs(budget, nowMs)),
  };
}

export function parseTimeoutBudgetHeaders(input: {
  id: string;
  nowMs: number;
  headers: Record<string, string | undefined>;
  defaultTimeoutMs: number;
}): TimeoutBudget {
  assertNonEmpty(input.id, "id");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.defaultTimeoutMs, "defaultTimeoutMs");
  const deadlineHeader = input.headers["x-request-deadline-ms"];
  const timeoutHeader = input.headers["x-request-timeout-ms"];
  const deadlineAtMs = deadlineHeader ? Number(deadlineHeader) : undefined;
  const timeoutMs = timeoutHeader ? Number(timeoutHeader) : input.defaultTimeoutMs;
  if (
    deadlineAtMs !== undefined &&
    (!Number.isInteger(deadlineAtMs) || deadlineAtMs < input.nowMs)
  ) {
    throw new Error("deadline header must be an integer at or after nowMs");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeout header must be a positive integer");
  }
  return createTimeoutBudget({
    id: input.id,
    nowMs: input.nowMs,
    timeoutMs,
    parentDeadlineAtMs: deadlineAtMs,
  });
}

export function markBudgetExpired(
  budget: TimeoutBudget,
  nowMs: number,
  reason = "deadline exceeded",
): TimeoutBudget {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (remainingBudgetMs(budget, nowMs) > 0) return { ...budget };
  return { ...budget, status: "expired", reason };
}

export function finishBudget(
  budget: TimeoutBudget,
  input: {
    nowMs: number;
    status: "completed" | "cancelled";
    reason?: string;
  },
): TimeoutBudget {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (budget.status !== "active") throw new Error("budget is not active");
  return {
    ...budget,
    status: input.status,
    reason: input.reason,
  };
}

export function addBudget(state: TimeoutBudgetState, budget: TimeoutBudget): TimeoutBudgetState {
  assertState(state);
  if (state.budgets.some((candidate) => candidate.id === budget.id)) {
    throw new Error("budget already exists");
  }
  return cloneState({ budgets: [...state.budgets, budget] });
}

export function replaceBudget(
  state: TimeoutBudgetState,
  budget: TimeoutBudget,
): TimeoutBudgetState {
  assertState(state);
  if (!state.budgets.some((candidate) => candidate.id === budget.id)) {
    throw new Error("budget not found");
  }
  return cloneState({
    budgets: state.budgets.map((candidate) => (candidate.id === budget.id ? budget : candidate)),
  });
}

export function expireBudgets(state: TimeoutBudgetState, nowMs: number): TimeoutBudgetState {
  assertState(state);
  assertNonNegativeInteger(nowMs, "nowMs");
  return cloneState({
    budgets: state.budgets.map((budget) =>
      budget.status === "active" ? markBudgetExpired(budget, nowMs) : budget,
    ),
  });
}

export function budgetSnapshot(state: TimeoutBudgetState): TimeoutBudgetSnapshot {
  assertState(state);
  return {
    total: state.budgets.length,
    active: state.budgets.filter((budget) => budget.status === "active").length,
    expired: state.budgets.filter((budget) => budget.status === "expired").length,
    cancelled: state.budgets.filter((budget) => budget.status === "cancelled").length,
    completed: state.budgets.filter((budget) => budget.status === "completed").length,
  };
}

export function createTimeoutBudgetState(): TimeoutBudgetState {
  return { budgets: [] };
}

export function cloneTimeoutBudgetState(state: TimeoutBudgetState): TimeoutBudgetState {
  assertState(state);
  return cloneState(state);
}

function assertActive(budget: TimeoutBudget, nowMs: number): void {
  if (budget.status !== "active") throw new Error("budget is not active");
  if (remainingBudgetMs(budget, nowMs) <= 0) throw new Error("budget is expired");
}

function assertState(state: TimeoutBudgetState): void {
  if (!Array.isArray(state.budgets)) throw new Error("budgets must be an array");
}

function cloneState(state: TimeoutBudgetState): TimeoutBudgetState {
  return {
    budgets: state.budgets.map((budget) => ({ ...budget })),
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
