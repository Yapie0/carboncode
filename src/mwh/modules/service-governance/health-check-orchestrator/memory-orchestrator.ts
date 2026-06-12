import {
  type HealthProbe,
  type HealthProbeObservation,
  type HealthProbeState,
  type HealthRegistrySnapshot,
  applyHealthObservation,
  cloneHealthProbe,
  cloneHealthProbeState,
  createHealthObservation,
  createHealthProbe,
  createHealthProbeState,
  createHealthRegistrySnapshot,
  healthProbeKey,
  isHealthProbeDue,
} from "./core.js";

export type HealthProbeRunner = (probe: HealthProbe) => {
  ok: boolean;
  latencyMs: number;
  message?: string;
};

export interface MemoryHealthCheckOrchestratorOptions {
  now?: () => number;
  runner?: HealthProbeRunner;
}

export class MemoryHealthCheckOrchestrator {
  private readonly now: () => number;
  private readonly runner: HealthProbeRunner;
  private readonly states = new Map<string, HealthProbeState>();
  private readonly observations: HealthProbeObservation[] = [];

  constructor(opts: MemoryHealthCheckOrchestratorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.runner =
      opts.runner ??
      (() => ({
        ok: true,
        latencyMs: 0,
      }));
  }

  addProbe(input: Parameters<typeof createHealthProbe>[0]): HealthProbeState {
    const probe = createHealthProbe(input);
    const state = createHealthProbeState({ probe, nowMs: this.now() });
    this.states.set(healthProbeKey({ targetId: probe.targetId, probeId: probe.id }), state);
    return cloneHealthProbeState(state);
  }

  removeProbe(input: { targetId: string; probeId: string }): boolean {
    return this.states.delete(healthProbeKey(input));
  }

  getProbe(input: { targetId: string; probeId: string }): HealthProbeState | null {
    const state = this.states.get(healthProbeKey(input));
    return state ? cloneHealthProbeState(state) : null;
  }

  runDue(): HealthProbeObservation[] {
    const nowMs = this.now();
    const observations: HealthProbeObservation[] = [];
    for (const [key, state] of this.states) {
      if (!isHealthProbeDue(state, { nowMs })) continue;
      const result = this.runner(cloneHealthProbe(state.probe));
      const observation = createHealthObservation({
        probe: state.probe,
        ok: result.ok,
        latencyMs: result.latencyMs,
        checkedAtMs: nowMs,
        message: result.message,
      });
      this.states.set(key, applyHealthObservation(state, observation));
      this.observations.push(observation);
      observations.push({ ...observation });
    }
    return observations;
  }

  record(input: {
    targetId: string;
    probeId: string;
    ok: boolean;
    latencyMs: number;
    message?: string;
  }): HealthProbeState | null {
    const key = healthProbeKey(input);
    const state = this.states.get(key);
    if (!state) return null;
    const observation = createHealthObservation({
      probe: state.probe,
      ok: input.ok,
      latencyMs: input.latencyMs,
      checkedAtMs: this.now(),
      message: input.message,
    });
    const next = applyHealthObservation(state, observation);
    this.states.set(key, next);
    this.observations.push(observation);
    return cloneHealthProbeState(next);
  }

  snapshot(): HealthRegistrySnapshot {
    return createHealthRegistrySnapshot([...this.states.values()], { nowMs: this.now() });
  }

  listProbes(): HealthProbeState[] {
    return [...this.states.values()]
      .map(cloneHealthProbeState)
      .sort(
        (a, b) =>
          a.probe.targetId.localeCompare(b.probe.targetId) || a.probe.id.localeCompare(b.probe.id),
      );
  }

  listObservations(): HealthProbeObservation[] {
    return this.observations.map((observation) => ({ ...observation }));
  }
}
