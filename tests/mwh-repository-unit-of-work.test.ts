import { describe, expect, it } from "vitest";
import {
  applyAllStagedUnitOfWorkSteps,
  applyUnitOfWorkStep,
  checkUnitOfWorkReadiness,
  cloneUnitOfWork,
  commitUnitOfWork,
  createUnitOfWork,
  rollbackUnitOfWork,
  stageUnitOfWorkStep,
  unitOfWorkSnapshot,
} from "../src/mwh/modules/data-access/repository-unit-of-work/core.js";
import { MemoryUnitOfWorkStore } from "../src/mwh/modules/data-access/repository-unit-of-work/memory-store.js";

describe("MWH repository-unit-of-work middleware", () => {
  it("creates units, stages steps, applies steps, and commits only applied work", () => {
    let unit = createUnitOfWork({ id: "uow-1", ownerId: "order-service", nowMs: 1_000 });
    unit = stageUnitOfWorkStep(unit, {
      stepId: "create-order",
      repository: "orders",
      operation: "insert",
      entityId: "order-1",
      nowMs: 1_100,
    });

    expect(unitOfWorkSnapshot(unit)).toEqual({
      id: "uow-1",
      ownerId: "order-service",
      status: "active",
      staged: 1,
      applied: 0,
      compensated: 0,
    });
    expect(() => commitUnitOfWork(unit, { nowMs: 1_200 })).toThrow(
      "cannot commit unit-of-work with staged steps",
    );
    expect(checkUnitOfWorkReadiness(unit)).toEqual({
      ready: false,
      stagedStepIds: ["create-order"],
      appliedStepIds: [],
    });

    unit = applyUnitOfWorkStep(unit, { stepId: "create-order", nowMs: 1_300 });
    expect(checkUnitOfWorkReadiness(unit)).toEqual({
      ready: true,
      stagedStepIds: [],
      appliedStepIds: ["create-order"],
    });
    const committed = commitUnitOfWork(unit, { nowMs: 1_400 });
    expect(committed).toEqual(
      expect.objectContaining({
        status: "committed",
        committedAtMs: 1_400,
      }),
    );
    expect(committed.steps[0]).toEqual(
      expect.objectContaining({ status: "applied", appliedAtMs: 1_300 }),
    );
  });

  it("rejects duplicate steps, missing steps, and mutation after completion", () => {
    let unit = createUnitOfWork({ id: "uow-1", ownerId: "svc", nowMs: 1_000 });
    unit = stageUnitOfWorkStep(unit, {
      stepId: "s1",
      repository: "repo",
      operation: "insert",
      nowMs: 1_100,
    });
    expect(() =>
      stageUnitOfWorkStep(unit, {
        stepId: "s1",
        repository: "repo",
        operation: "insert",
        nowMs: 1_200,
      }),
    ).toThrow("unit-of-work step already exists");
    expect(() => applyUnitOfWorkStep(unit, { stepId: "missing", nowMs: 1_300 })).toThrow(
      "unit-of-work step not found",
    );

    unit = applyUnitOfWorkStep(unit, { stepId: "s1", nowMs: 1_400 });
    const committed = commitUnitOfWork(unit, { nowMs: 1_500 });
    expect(() =>
      stageUnitOfWorkStep(committed, {
        stepId: "s2",
        repository: "repo",
        operation: "update",
        nowMs: 1_600,
      }),
    ).toThrow("unit-of-work is not active");
  });

  it("rolls back active work and marks staged/applied steps as compensated", () => {
    let unit = createUnitOfWork({ id: "uow-1", ownerId: "svc", nowMs: 1_000 });
    unit = stageUnitOfWorkStep(unit, {
      stepId: "s1",
      repository: "orders",
      operation: "insert",
      nowMs: 1_100,
    });
    unit = applyUnitOfWorkStep(unit, { stepId: "s1", nowMs: 1_200 });
    unit = stageUnitOfWorkStep(unit, {
      stepId: "s2",
      repository: "items",
      operation: "insert",
      nowMs: 1_300,
    });

    const rolledBack = rollbackUnitOfWork(unit, { nowMs: 1_400 });
    expect(rolledBack.status).toBe("rolled-back");
    expect(rolledBack.steps.map((step) => step.status)).toEqual(["compensated", "compensated"]);
    expect(rolledBack.steps.map((step) => step.compensatedAtMs)).toEqual([1_400, 1_400]);
    expect(unitOfWorkSnapshot(rolledBack)).toEqual(
      expect.objectContaining({ staged: 0, applied: 0, compensated: 2 }),
    );
  });

  it("applies all staged steps before commit", () => {
    let unit = createUnitOfWork({ id: "uow-1", ownerId: "svc", nowMs: 1_000 });
    unit = stageUnitOfWorkStep(unit, {
      stepId: "s1",
      repository: "orders",
      operation: "insert",
      nowMs: 1_100,
    });
    unit = stageUnitOfWorkStep(unit, {
      stepId: "s2",
      repository: "items",
      operation: "insert",
      nowMs: 1_200,
    });

    const applied = applyAllStagedUnitOfWorkSteps(unit, { nowMs: 1_300 });
    expect(applied.steps.map((step) => step.status)).toEqual(["applied", "applied"]);
    expect(applied.steps.map((step) => step.appliedAtMs)).toEqual([1_300, 1_300]);
    expect(commitUnitOfWork(applied, { nowMs: 1_400 }).status).toBe("committed");
  });

  it("runs stateful begin, stage, apply, commit, rollback, missing-unit, and clone-safe flows", () => {
    let now = 1_000;
    const store = new MemoryUnitOfWorkStore({ now: () => now });
    store.begin({ id: "uow-1", ownerId: "svc" });
    expect(() => store.begin({ id: "uow-1", ownerId: "svc" })).toThrow(
      "unit-of-work already exists",
    );

    now = 1_100;
    store.stage({
      unitId: "uow-1",
      stepId: "s1",
      repository: "orders",
      operation: "insert",
      entityId: "o1",
    });
    now = 1_200;
    store.apply({ unitId: "uow-1", stepId: "s1" });
    now = 1_300;
    expect(store.commit("uow-1")).toEqual(expect.objectContaining({ status: "committed" }));

    now = 1_400;
    store.begin({ id: "uow-2", ownerId: "svc" });
    store.stage({ unitId: "uow-2", stepId: "s2", repository: "items", operation: "insert" });
    expect(store.rollback("uow-2")).toEqual(expect.objectContaining({ status: "rolled-back" }));
    expect(() => store.commit("missing")).toThrow("unit-of-work not found");

    const read = store.get("uow-1");
    if (!read) throw new Error("unit missing");
    read.steps[0]!.operation = "mutated";
    expect(store.get("uow-1")?.steps[0]?.operation).toBe("insert");
    expect(store.snapshots().map((snapshot) => snapshot.status)).toEqual([
      "committed",
      "rolled-back",
    ]);
    expect(store.listByOwner("svc").map((unit) => unit.id)).toEqual(["uow-1", "uow-2"]);
    expect(cloneUnitOfWork(read).steps[0]?.operation).toBe("mutated");
  });

  it("runs stateful readiness and applyAll flows", () => {
    const store = new MemoryUnitOfWorkStore({ now: () => 1_000 });
    store.begin({ id: "uow-1", ownerId: "svc" });
    store.stage({ unitId: "uow-1", stepId: "s1", repository: "orders", operation: "insert" });
    store.stage({ unitId: "uow-1", stepId: "s2", repository: "items", operation: "insert" });

    expect(store.readiness("uow-1")).toEqual({
      ready: false,
      stagedStepIds: ["s1", "s2"],
      appliedStepIds: [],
    });
    expect(store.applyAll("uow-1").steps.map((step) => step.status)).toEqual([
      "applied",
      "applied",
    ]);
    expect(store.readiness("uow-1")).toEqual({
      ready: true,
      stagedStepIds: [],
      appliedStepIds: ["s1", "s2"],
    });
    expect(store.commit("uow-1").status).toBe("committed");
  });
});
