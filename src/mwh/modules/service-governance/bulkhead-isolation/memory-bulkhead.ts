import {
  type BulkheadAdmissionResult,
  type BulkheadPolicy,
  type BulkheadPruneResult,
  type BulkheadReleaseResult,
  type BulkheadState,
  admitBulkheadRequest,
  bulkheadSnapshot,
  cloneBulkheadState,
  createBulkheadPolicy,
  createBulkheadState,
  drainBulkheadState,
  pruneTimedOutQueued,
  releaseBulkheadRequest,
} from "./core.js";

export interface MemoryBulkheadManagerOptions {
  now?: () => number;
}

export class MemoryBulkheadManager {
  private readonly now: () => number;
  private readonly states = new Map<string, BulkheadState>();
  private readonly events: Array<{
    scope: string;
    type: string;
    requestId?: string;
    atMs: number;
  }> = [];

  constructor(opts: MemoryBulkheadManagerOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  definePolicy(input: Parameters<typeof createBulkheadPolicy>[0]): BulkheadPolicy {
    const policy = createBulkheadPolicy(input);
    this.states.set(policy.scope, createBulkheadState(policy));
    this.events.push({ scope: policy.scope, type: "policy-defined", atMs: this.now() });
    return { ...policy };
  }

  admit(scope: string, requestId: string): BulkheadAdmissionResult | null {
    const state = this.states.get(scope);
    if (!state) return null;
    const result = admitBulkheadRequest(state, { requestId, nowMs: this.now() });
    this.states.set(scope, result.state);
    this.events.push({
      scope,
      type: result.request.status,
      requestId,
      atMs: result.request.startedAtMs ?? result.request.enqueuedAtMs,
    });
    return { request: { ...result.request }, state: cloneBulkheadState(result.state) };
  }

  release(scope: string, requestId: string): BulkheadReleaseResult | null {
    const state = this.states.get(scope);
    if (!state) return null;
    const result = releaseBulkheadRequest(state, { requestId, nowMs: this.now() });
    this.states.set(scope, result.state);
    if (result.completed) {
      this.events.push({
        scope,
        type: "completed",
        requestId,
        atMs: result.completed.completedAtMs ?? this.now(),
      });
    }
    if (result.promoted) {
      this.events.push({
        scope,
        type: "promoted",
        requestId: result.promoted.id,
        atMs: result.promoted.startedAtMs ?? this.now(),
      });
    }
    return {
      completed: result.completed ? { ...result.completed } : null,
      promoted: result.promoted ? { ...result.promoted } : null,
      state: cloneBulkheadState(result.state),
    };
  }

  prune(scope: string): BulkheadPruneResult | null {
    const state = this.states.get(scope);
    if (!state) return null;
    const result = pruneTimedOutQueued(state, { nowMs: this.now() });
    this.states.set(scope, result.state);
    for (const request of result.timedOut) {
      this.events.push({
        scope,
        type: "timed-out",
        requestId: request.id,
        atMs: request.completedAtMs ?? this.now(),
      });
    }
    return {
      timedOut: result.timedOut.map((request) => ({ ...request })),
      state: cloneBulkheadState(result.state),
    };
  }

  drain(
    scope: string,
    input: { reason?: string; includeRunning?: boolean } = {},
  ): ReturnType<typeof drainBulkheadState> | null {
    const state = this.states.get(scope);
    if (!state) return null;
    const result = drainBulkheadState(state, { ...input, nowMs: this.now() });
    this.states.set(scope, result.state);
    for (const request of result.drained) {
      this.events.push({
        scope,
        type: request.status === "completed" ? "drained-running" : "drained-queued",
        requestId: request.id,
        atMs: request.completedAtMs ?? this.now(),
      });
    }
    return {
      drained: result.drained.map((request) => ({ ...request })),
      state: cloneBulkheadState(result.state),
    };
  }

  getState(scope: string): BulkheadState | null {
    const state = this.states.get(scope);
    return state ? cloneBulkheadState(state) : null;
  }

  snapshots(): ReturnType<typeof bulkheadSnapshot>[] {
    return [...this.states.values()]
      .map(bulkheadSnapshot)
      .sort((a, b) => a.scope.localeCompare(b.scope));
  }

  listEvents(): Array<{ scope: string; type: string; requestId?: string; atMs: number }> {
    return this.events.map((event) => ({ ...event }));
  }
}
