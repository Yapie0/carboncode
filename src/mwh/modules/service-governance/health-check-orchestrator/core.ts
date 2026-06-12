export type HealthStatus = "passing" | "warning" | "critical";
export type HealthProbeKind = "http" | "tcp" | "custom";

export interface HealthProbe {
  id: string;
  targetId: string;
  kind: HealthProbeKind;
  timeoutMs: number;
  intervalMs: number;
  warningAfterFailures: number;
  criticalAfterFailures: number;
  metadata: Record<string, string>;
}

export interface HealthProbeObservation {
  probeId: string;
  targetId: string;
  ok: boolean;
  latencyMs: number;
  checkedAtMs: number;
  message?: string;
}

export interface HealthProbeState {
  probe: HealthProbe;
  status: HealthStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastObservation?: HealthProbeObservation;
  updatedAtMs: number;
}

export interface HealthTargetSnapshot {
  targetId: string;
  status: HealthStatus;
  probes: HealthProbeState[];
}

export interface HealthRegistrySnapshot {
  targets: HealthTargetSnapshot[];
  generatedAtMs: number;
}

export function createHealthProbe(input: {
  id: string;
  targetId: string;
  kind?: HealthProbeKind;
  timeoutMs: number;
  intervalMs: number;
  warningAfterFailures?: number;
  criticalAfterFailures?: number;
  metadata?: Record<string, string>;
}): HealthProbe {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.targetId, "targetId");
  assertPositiveInteger(input.timeoutMs, "timeoutMs");
  assertPositiveInteger(input.intervalMs, "intervalMs");
  const warningAfterFailures = input.warningAfterFailures ?? 1;
  const criticalAfterFailures = input.criticalAfterFailures ?? 3;
  assertPositiveInteger(warningAfterFailures, "warningAfterFailures");
  assertPositiveInteger(criticalAfterFailures, "criticalAfterFailures");
  if (warningAfterFailures > criticalAfterFailures) {
    throw new Error("warningAfterFailures must not exceed criticalAfterFailures");
  }
  return {
    id: input.id,
    targetId: input.targetId,
    kind: input.kind ?? "custom",
    timeoutMs: input.timeoutMs,
    intervalMs: input.intervalMs,
    warningAfterFailures,
    criticalAfterFailures,
    metadata: { ...(input.metadata ?? {}) },
  };
}

export function createHealthProbeState(input: {
  probe: HealthProbe;
  nowMs: number;
}): HealthProbeState {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    probe: cloneHealthProbe(input.probe),
    status: "passing",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    updatedAtMs: input.nowMs,
  };
}

export function createHealthObservation(input: {
  probe: HealthProbe;
  ok: boolean;
  latencyMs: number;
  checkedAtMs: number;
  message?: string;
}): HealthProbeObservation {
  assertNonNegativeInteger(input.latencyMs, "latencyMs");
  assertNonNegativeInteger(input.checkedAtMs, "checkedAtMs");
  return {
    probeId: input.probe.id,
    targetId: input.probe.targetId,
    ok: input.ok,
    latencyMs: input.latencyMs,
    checkedAtMs: input.checkedAtMs,
    message: input.message,
  };
}

export function applyHealthObservation(
  state: HealthProbeState,
  observation: HealthProbeObservation,
): HealthProbeState {
  if (observation.probeId !== state.probe.id) {
    throw new Error("observation probeId does not match state probe id");
  }
  const consecutiveFailures = observation.ok ? 0 : state.consecutiveFailures + 1;
  const consecutiveSuccesses = observation.ok ? state.consecutiveSuccesses + 1 : 0;
  return {
    ...state,
    status: evaluateHealthStatus(state.probe, consecutiveFailures),
    consecutiveFailures,
    consecutiveSuccesses,
    lastObservation: { ...observation },
    updatedAtMs: observation.checkedAtMs,
  };
}

export function evaluateHealthStatus(
  probe: HealthProbe,
  consecutiveFailures: number,
): HealthStatus {
  assertNonNegativeInteger(consecutiveFailures, "consecutiveFailures");
  if (consecutiveFailures >= probe.criticalAfterFailures) return "critical";
  if (consecutiveFailures >= probe.warningAfterFailures) return "warning";
  return "passing";
}

export function isHealthProbeDue(state: HealthProbeState, input: { nowMs: number }): boolean {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return input.nowMs - state.updatedAtMs >= state.probe.intervalMs;
}

export function aggregateHealthStatus(states: readonly HealthProbeState[]): HealthStatus {
  if (states.some((state) => state.status === "critical")) return "critical";
  if (states.some((state) => state.status === "warning")) return "warning";
  return "passing";
}

export function createHealthRegistrySnapshot(
  states: readonly HealthProbeState[],
  input: { nowMs: number },
): HealthRegistrySnapshot {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const targetIds = [...new Set(states.map((state) => state.probe.targetId))].sort();
  return {
    targets: targetIds.map((targetId) => {
      const probes = states
        .filter((state) => state.probe.targetId === targetId)
        .map(cloneHealthProbeState)
        .sort((a, b) => a.probe.id.localeCompare(b.probe.id));
      return {
        targetId,
        status: aggregateHealthStatus(probes),
        probes,
      };
    }),
    generatedAtMs: input.nowMs,
  };
}

export function healthProbeKey(input: { targetId: string; probeId: string }): string {
  assertNonEmpty(input.targetId, "targetId");
  assertNonEmpty(input.probeId, "probeId");
  return `${input.targetId}\0${input.probeId}`;
}

export function cloneHealthProbe(probe: HealthProbe): HealthProbe {
  return { ...probe, metadata: { ...probe.metadata } };
}

export function cloneHealthProbeState(state: HealthProbeState): HealthProbeState {
  return {
    ...state,
    probe: cloneHealthProbe(state.probe),
    lastObservation: state.lastObservation ? { ...state.lastObservation } : undefined,
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
