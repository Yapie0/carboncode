import {
  type LoadSheddingDecision,
  type LoadSheddingPolicy,
  type LoadSheddingState,
  cloneLoadSheddingState,
  createLoadSheddingPolicy,
  createLoadSheddingState,
  evaluateLoadShedding,
  loadSheddingSnapshot,
  previewLoadShedding,
  rollLoadSheddingWindow,
} from "./core.js";

export interface MemoryLoadShedderOptions {
  now?: () => number;
}

export class MemoryLoadShedder {
  private readonly now: () => number;
  private readonly states = new Map<string, LoadSheddingState>();
  private readonly decisions: LoadSheddingDecision[] = [];

  constructor(opts: MemoryLoadShedderOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  definePolicy(input: Parameters<typeof createLoadSheddingPolicy>[0]): LoadSheddingPolicy {
    const policy = createLoadSheddingPolicy(input);
    this.states.set(policy.scope, createLoadSheddingState(policy, { nowMs: this.now() }));
    return { ...policy };
  }

  decide(input: {
    scope: string;
    requestId: string;
    priority: number;
  }): LoadSheddingDecision | null {
    const state = this.states.get(input.scope);
    if (!state) return null;
    const result = evaluateLoadShedding(state, {
      id: input.requestId,
      scope: input.scope,
      priority: input.priority,
      nowMs: this.now(),
    });
    this.states.set(input.scope, result.state);
    this.decisions.push({ ...result.decision });
    return { ...result.decision };
  }

  preview(input: {
    scope: string;
    requestId: string;
    priority: number;
  }): LoadSheddingDecision | null {
    const state = this.states.get(input.scope);
    if (!state) return null;
    const result = previewLoadShedding(state, {
      id: input.requestId,
      scope: input.scope,
      priority: input.priority,
      nowMs: this.now(),
    });
    return { ...result.decision };
  }

  updatePolicy(input: Parameters<typeof createLoadSheddingPolicy>[0]): LoadSheddingPolicy {
    const policy = createLoadSheddingPolicy(input);
    const existing = this.states.get(policy.scope);
    this.states.set(
      policy.scope,
      existing
        ? { policy, window: { ...existing.window } }
        : createLoadSheddingState(policy, { nowMs: this.now() }),
    );
    return { ...policy };
  }

  roll(scope: string): LoadSheddingState | null {
    const state = this.states.get(scope);
    if (!state) return null;
    const next = rollLoadSheddingWindow(state, { nowMs: this.now() });
    this.states.set(scope, next);
    return cloneLoadSheddingState(next);
  }

  getState(scope: string): LoadSheddingState | null {
    const state = this.states.get(scope);
    return state ? cloneLoadSheddingState(state) : null;
  }

  snapshots(): ReturnType<typeof loadSheddingSnapshot>[] {
    return [...this.states.values()]
      .map(loadSheddingSnapshot)
      .sort((a, b) => a.scope.localeCompare(b.scope));
  }

  listDecisions(): LoadSheddingDecision[] {
    return this.decisions.map((decision) => ({ ...decision }));
  }
}
