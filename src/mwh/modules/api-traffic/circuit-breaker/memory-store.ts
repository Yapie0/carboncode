import {
  type CircuitAllowResult,
  type CircuitBreakerPolicy,
  type CircuitBreakerState,
  type CircuitOutcome,
  allowCircuitRequest,
  cloneCircuitAllowResult,
  cloneCircuitBreakerState,
  initialCircuitState,
  recordCircuitOutcome,
} from "./core.js";

export interface MemoryCircuitBreakerStoreOptions {
  now?: () => number;
  policy: CircuitBreakerPolicy;
}

export class MemoryCircuitBreakerStore {
  private readonly now: () => number;
  private readonly policy: CircuitBreakerPolicy;
  private readonly circuits = new Map<string, CircuitBreakerState>();

  constructor(opts: MemoryCircuitBreakerStoreOptions) {
    this.now = opts.now ?? Date.now;
    this.policy = opts.policy;
  }

  allow(key: string): CircuitAllowResult {
    const result = allowCircuitRequest(this.circuits.get(key) ?? initialCircuitState(), {
      nowMs: this.now(),
      policy: this.policy,
    });
    this.circuits.set(key, result.state);
    return cloneCircuitAllowResult(result);
  }

  record(key: string, outcome: CircuitOutcome): CircuitBreakerState {
    const next = recordCircuitOutcome(this.circuits.get(key) ?? initialCircuitState(), {
      nowMs: this.now(),
      outcome,
      policy: this.policy,
    });
    this.circuits.set(key, next);
    return cloneCircuitBreakerState(next);
  }

  get(key: string): CircuitBreakerState {
    return cloneCircuitBreakerState(this.circuits.get(key) ?? initialCircuitState());
  }

  reset(key?: string): void {
    if (key === undefined) {
      this.circuits.clear();
      return;
    }
    this.circuits.delete(key);
  }
}
