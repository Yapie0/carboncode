import {
  type TimeoutBudget,
  type TimeoutBudgetSnapshot,
  type TimeoutBudgetState,
  addBudget,
  budgetSnapshot,
  cloneTimeoutBudgetState,
  createTimeoutBudget,
  createTimeoutBudgetState,
  deriveChildBudget,
  expireBudgets,
  finishBudget,
  parseTimeoutBudgetHeaders,
  replaceBudget,
} from "./core.js";

export interface MemoryTimeoutBudgetRegistryOptions {
  now?: () => number;
  defaultTimeoutMs?: number;
}

export class MemoryTimeoutBudgetRegistry {
  private state: TimeoutBudgetState = createTimeoutBudgetState();
  private readonly now: () => number;
  private readonly defaultTimeoutMs: number;

  constructor(options: MemoryTimeoutBudgetRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
  }

  create(input: { id: string; timeoutMs?: number }): TimeoutBudget {
    const budget = createTimeoutBudget({
      id: input.id,
      nowMs: this.now(),
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
    });
    this.state = addBudget(this.state, budget);
    return { ...budget };
  }

  fromHeaders(input: {
    id: string;
    headers: Record<string, string | undefined>;
  }): TimeoutBudget {
    const budget = parseTimeoutBudgetHeaders({
      id: input.id,
      headers: input.headers,
      nowMs: this.now(),
      defaultTimeoutMs: this.defaultTimeoutMs,
    });
    this.state = addBudget(this.state, budget);
    return { ...budget };
  }

  derive(parentId: string, input: { id: string; timeoutMs: number }): TimeoutBudget {
    const parent = this.requireBudget(parentId);
    const child = deriveChildBudget(parent, { ...input, nowMs: this.now() });
    this.state = addBudget(this.state, child);
    return { ...child };
  }

  complete(id: string): TimeoutBudget {
    const updated = finishBudget(this.requireBudget(id), {
      nowMs: this.now(),
      status: "completed",
    });
    this.state = replaceBudget(this.state, updated);
    return { ...updated };
  }

  cancel(id: string, reason: string): TimeoutBudget {
    const updated = finishBudget(this.requireBudget(id), {
      nowMs: this.now(),
      status: "cancelled",
      reason,
    });
    this.state = replaceBudget(this.state, updated);
    return { ...updated };
  }

  expire(): void {
    this.state = expireBudgets(this.state, this.now());
  }

  snapshot(): TimeoutBudgetSnapshot {
    return budgetSnapshot(this.state);
  }

  listBudgets(): TimeoutBudget[] {
    return cloneTimeoutBudgetState(this.state).budgets.map((budget) => ({ ...budget }));
  }

  private requireBudget(id: string): TimeoutBudget {
    const budget = this.state.budgets.find((candidate) => candidate.id === id);
    if (!budget) throw new Error("budget not found");
    return { ...budget };
  }
}
