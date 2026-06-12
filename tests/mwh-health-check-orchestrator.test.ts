import { describe, expect, it } from "vitest";
import {
  aggregateHealthStatus,
  applyHealthObservation,
  createHealthObservation,
  createHealthProbe,
  createHealthProbeState,
  createHealthRegistrySnapshot,
  evaluateHealthStatus,
  healthProbeKey,
  isHealthProbeDue,
} from "../src/mwh/modules/service-governance/health-check-orchestrator/core.js";
import { MemoryHealthCheckOrchestrator } from "../src/mwh/modules/service-governance/health-check-orchestrator/memory-orchestrator.js";

describe("MWH health-check-orchestrator middleware", () => {
  it("creates probes, observations, and applies threshold-based status transitions", () => {
    const probe = createHealthProbe({
      id: "ready",
      targetId: "api-1",
      kind: "http",
      timeoutMs: 500,
      intervalMs: 1_000,
      warningAfterFailures: 1,
      criticalAfterFailures: 2,
      metadata: { path: "/ready" },
    });
    const initial = createHealthProbeState({ probe, nowMs: 1_000 });

    expect(probe).toEqual({
      id: "ready",
      targetId: "api-1",
      kind: "http",
      timeoutMs: 500,
      intervalMs: 1_000,
      warningAfterFailures: 1,
      criticalAfterFailures: 2,
      metadata: { path: "/ready" },
    });
    expect(healthProbeKey({ targetId: "api-1", probeId: "ready" })).toBe("api-1\0ready");
    expect(initial).toEqual({
      probe,
      status: "passing",
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      updatedAtMs: 1_000,
    });

    const warning = applyHealthObservation(
      initial,
      createHealthObservation({
        probe,
        ok: false,
        latencyMs: 120,
        checkedAtMs: 2_000,
        message: "dependency slow",
      }),
    );
    expect(warning).toEqual(
      expect.objectContaining({
        status: "warning",
        consecutiveFailures: 1,
        consecutiveSuccesses: 0,
        updatedAtMs: 2_000,
      }),
    );
    const critical = applyHealthObservation(
      warning,
      createHealthObservation({ probe, ok: false, latencyMs: 130, checkedAtMs: 3_000 }),
    );
    expect(critical.status).toBe("critical");
    expect(evaluateHealthStatus(probe, 0)).toBe("passing");
    expect(evaluateHealthStatus(probe, 1)).toBe("warning");
    expect(evaluateHealthStatus(probe, 2)).toBe("critical");
  });

  it("checks due probes, aggregates target status, and creates deterministic snapshots", () => {
    const ready = createHealthProbe({
      id: "ready",
      targetId: "api-1",
      timeoutMs: 500,
      intervalMs: 1_000,
    });
    const live = createHealthProbe({
      id: "live",
      targetId: "api-1",
      timeoutMs: 500,
      intervalMs: 1_000,
      criticalAfterFailures: 1,
    });
    const readyState = createHealthProbeState({ probe: ready, nowMs: 1_000 });
    const liveState = applyHealthObservation(
      createHealthProbeState({ probe: live, nowMs: 1_000 }),
      createHealthObservation({ probe: live, ok: false, latencyMs: 10, checkedAtMs: 2_000 }),
    );

    expect(isHealthProbeDue(readyState, { nowMs: 1_999 })).toBe(false);
    expect(isHealthProbeDue(readyState, { nowMs: 2_000 })).toBe(true);
    expect(aggregateHealthStatus([readyState, liveState])).toBe("critical");
    expect(createHealthRegistrySnapshot([liveState, readyState], { nowMs: 3_000 })).toEqual({
      generatedAtMs: 3_000,
      targets: [
        {
          targetId: "api-1",
          status: "critical",
          probes: [
            expect.objectContaining({ probe: expect.objectContaining({ id: "live" }) }),
            expect.objectContaining({ probe: expect.objectContaining({ id: "ready" }) }),
          ],
        },
      ],
    });
  });

  it("runs due probes through a stateful runner and records observation history", () => {
    let now = 1_000;
    const results = [
      { ok: false, latencyMs: 50, message: "first failure" },
      { ok: false, latencyMs: 60, message: "second failure" },
      { ok: true, latencyMs: 20, message: "recovered" },
    ];
    const orchestrator = new MemoryHealthCheckOrchestrator({
      now: () => now,
      runner: () => results.shift() ?? { ok: true, latencyMs: 1 },
    });
    orchestrator.addProbe({
      id: "ready",
      targetId: "api-1",
      timeoutMs: 500,
      intervalMs: 100,
      warningAfterFailures: 1,
      criticalAfterFailures: 2,
    });

    expect(orchestrator.runDue()).toEqual([]);
    now = 1_100;
    expect(orchestrator.runDue()).toEqual([
      expect.objectContaining({ ok: false, message: "first failure", checkedAtMs: 1_100 }),
    ]);
    expect(orchestrator.getProbe({ targetId: "api-1", probeId: "ready" })).toEqual(
      expect.objectContaining({ status: "warning", consecutiveFailures: 1 }),
    );
    now = 1_200;
    orchestrator.runDue();
    expect(orchestrator.getProbe({ targetId: "api-1", probeId: "ready" })).toEqual(
      expect.objectContaining({ status: "critical", consecutiveFailures: 2 }),
    );
    now = 1_300;
    orchestrator.runDue();
    expect(orchestrator.getProbe({ targetId: "api-1", probeId: "ready" })).toEqual(
      expect.objectContaining({
        status: "passing",
        consecutiveFailures: 0,
        consecutiveSuccesses: 1,
      }),
    );
    expect(orchestrator.listObservations().map((item) => item.message)).toEqual([
      "first failure",
      "second failure",
      "recovered",
    ]);
  });

  it("supports manual records, snapshots, removal, and clone-safe state", () => {
    let now = 1_000;
    const orchestrator = new MemoryHealthCheckOrchestrator({ now: () => now });
    const state = orchestrator.addProbe({
      id: "db",
      targetId: "api-1",
      timeoutMs: 300,
      intervalMs: 1_000,
      metadata: { dependency: "postgres" },
    });
    state.probe.metadata.dependency = "mutated";

    now = 1_100;
    expect(
      orchestrator.record({
        targetId: "api-1",
        probeId: "db",
        ok: false,
        latencyMs: 200,
        message: "db timeout",
      }),
    ).toEqual(expect.objectContaining({ status: "warning" }));
    expect(orchestrator.snapshot()).toEqual({
      generatedAtMs: 1_100,
      targets: [
        {
          targetId: "api-1",
          status: "warning",
          probes: [
            expect.objectContaining({
              probe: expect.objectContaining({ metadata: { dependency: "postgres" } }),
              lastObservation: expect.objectContaining({ message: "db timeout" }),
            }),
          ],
        },
      ],
    });
    expect(orchestrator.removeProbe({ targetId: "api-1", probeId: "db" })).toBe(true);
    expect(orchestrator.listProbes()).toEqual([]);
    expect(
      orchestrator.record({ targetId: "api-1", probeId: "missing", ok: true, latencyMs: 1 }),
    ).toBeNull();
  });
});
