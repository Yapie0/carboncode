export type UnitOfWorkStatus = "active" | "committed" | "rolled-back";
export type UnitOfWorkStepStatus = "staged" | "applied" | "compensated";

export interface UnitOfWorkStep {
  id: string;
  repository: string;
  operation: string;
  entityId?: string;
  status: UnitOfWorkStepStatus;
  stagedAtMs: number;
  appliedAtMs?: number;
  compensatedAtMs?: number;
}

export interface UnitOfWork {
  id: string;
  ownerId: string;
  status: UnitOfWorkStatus;
  startedAtMs: number;
  updatedAtMs: number;
  committedAtMs?: number;
  rolledBackAtMs?: number;
  steps: UnitOfWorkStep[];
}

export interface UnitOfWorkSnapshot {
  id: string;
  ownerId: string;
  status: UnitOfWorkStatus;
  staged: number;
  applied: number;
  compensated: number;
}

export interface UnitOfWorkReadiness {
  ready: boolean;
  stagedStepIds: string[];
  appliedStepIds: string[];
}

export function createUnitOfWork(input: {
  id: string;
  ownerId: string;
  nowMs: number;
}): UnitOfWork {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    id: input.id,
    ownerId: input.ownerId,
    status: "active",
    startedAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    steps: [],
  };
}

export function stageUnitOfWorkStep(
  unit: UnitOfWork,
  input: {
    stepId: string;
    repository: string;
    operation: string;
    entityId?: string;
    nowMs: number;
  },
): UnitOfWork {
  assertActiveUnit(unit);
  assertNonEmpty(input.stepId, "stepId");
  assertNonEmpty(input.repository, "repository");
  assertNonEmpty(input.operation, "operation");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (unit.steps.some((step) => step.id === input.stepId)) {
    throw new Error("unit-of-work step already exists");
  }
  return cloneUnitOfWork({
    ...unit,
    updatedAtMs: input.nowMs,
    steps: [
      ...unit.steps,
      {
        id: input.stepId,
        repository: input.repository,
        operation: input.operation,
        entityId: input.entityId,
        status: "staged",
        stagedAtMs: input.nowMs,
      },
    ],
  });
}

export function applyUnitOfWorkStep(
  unit: UnitOfWork,
  input: { stepId: string; nowMs: number },
): UnitOfWork {
  assertActiveUnit(unit);
  assertNonEmpty(input.stepId, "stepId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return updateStep(
    unit,
    input.stepId,
    (step) => {
      if (step.status !== "staged") throw new Error("unit-of-work step is not staged");
      return { ...step, status: "applied", appliedAtMs: input.nowMs };
    },
    input.nowMs,
  );
}

export function applyAllStagedUnitOfWorkSteps(
  unit: UnitOfWork,
  input: { nowMs: number },
): UnitOfWork {
  assertActiveUnit(unit);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return cloneUnitOfWork({
    ...unit,
    updatedAtMs: input.nowMs,
    steps: unit.steps.map((step) =>
      step.status === "staged"
        ? { ...step, status: "applied", appliedAtMs: input.nowMs }
        : { ...step },
    ),
  });
}

export function checkUnitOfWorkReadiness(unit: UnitOfWork): UnitOfWorkReadiness {
  const stagedStepIds = unit.steps
    .filter((step) => step.status === "staged")
    .map((step) => step.id)
    .sort();
  const appliedStepIds = unit.steps
    .filter((step) => step.status === "applied")
    .map((step) => step.id)
    .sort();
  return {
    ready: unit.status === "active" && stagedStepIds.length === 0,
    stagedStepIds,
    appliedStepIds,
  };
}

export function commitUnitOfWork(unit: UnitOfWork, input: { nowMs: number }): UnitOfWork {
  assertActiveUnit(unit);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const readiness = checkUnitOfWorkReadiness(unit);
  if (!readiness.ready) throw new Error("cannot commit unit-of-work with staged steps");
  return cloneUnitOfWork({
    ...unit,
    status: "committed",
    updatedAtMs: input.nowMs,
    committedAtMs: input.nowMs,
  });
}

export function rollbackUnitOfWork(unit: UnitOfWork, input: { nowMs: number }): UnitOfWork {
  assertActiveUnit(unit);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return cloneUnitOfWork({
    ...unit,
    status: "rolled-back",
    updatedAtMs: input.nowMs,
    rolledBackAtMs: input.nowMs,
    steps: unit.steps.map((step) =>
      step.status === "applied"
        ? { ...step, status: "compensated", compensatedAtMs: input.nowMs }
        : { ...step, status: "compensated", compensatedAtMs: input.nowMs },
    ),
  });
}

export function unitOfWorkSnapshot(unit: UnitOfWork): UnitOfWorkSnapshot {
  return {
    id: unit.id,
    ownerId: unit.ownerId,
    status: unit.status,
    staged: unit.steps.filter((step) => step.status === "staged").length,
    applied: unit.steps.filter((step) => step.status === "applied").length,
    compensated: unit.steps.filter((step) => step.status === "compensated").length,
  };
}

export function cloneUnitOfWork(unit: UnitOfWork): UnitOfWork {
  return {
    ...unit,
    steps: unit.steps.map((step) => ({ ...step })),
  };
}

function updateStep(
  unit: UnitOfWork,
  stepId: string,
  update: (step: UnitOfWorkStep) => UnitOfWorkStep,
  nowMs: number,
): UnitOfWork {
  let found = false;
  const steps = unit.steps.map((step) => {
    if (step.id !== stepId) return { ...step };
    found = true;
    return update(step);
  });
  if (!found) throw new Error("unit-of-work step not found");
  return cloneUnitOfWork({ ...unit, updatedAtMs: nowMs, steps });
}

function assertActiveUnit(unit: UnitOfWork): void {
  if (unit.status !== "active") throw new Error("unit-of-work is not active");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
