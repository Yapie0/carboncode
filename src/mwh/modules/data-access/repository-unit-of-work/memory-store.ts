import {
  type UnitOfWork,
  type UnitOfWorkSnapshot,
  applyAllStagedUnitOfWorkSteps,
  applyUnitOfWorkStep,
  checkUnitOfWorkReadiness,
  cloneUnitOfWork,
  commitUnitOfWork,
  createUnitOfWork,
  rollbackUnitOfWork,
  stageUnitOfWorkStep,
  unitOfWorkSnapshot,
} from "./core.js";

export interface MemoryUnitOfWorkStoreOptions {
  now?: () => number;
}

export class MemoryUnitOfWorkStore {
  private readonly now: () => number;
  private readonly units = new Map<string, UnitOfWork>();

  constructor(opts: MemoryUnitOfWorkStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  begin(input: { id: string; ownerId: string }): UnitOfWork {
    if (this.units.has(input.id)) throw new Error("unit-of-work already exists");
    const unit = createUnitOfWork({ ...input, nowMs: this.now() });
    this.units.set(unit.id, unit);
    return cloneUnitOfWork(unit);
  }

  stage(input: {
    unitId: string;
    stepId: string;
    repository: string;
    operation: string;
    entityId?: string;
  }): UnitOfWork {
    const unit = this.requireUnit(input.unitId);
    const next = stageUnitOfWorkStep(unit, { ...input, nowMs: this.now() });
    this.units.set(next.id, next);
    return cloneUnitOfWork(next);
  }

  apply(input: { unitId: string; stepId: string }): UnitOfWork {
    const unit = this.requireUnit(input.unitId);
    const next = applyUnitOfWorkStep(unit, { stepId: input.stepId, nowMs: this.now() });
    this.units.set(next.id, next);
    return cloneUnitOfWork(next);
  }

  applyAll(unitId: string): UnitOfWork {
    const unit = this.requireUnit(unitId);
    const next = applyAllStagedUnitOfWorkSteps(unit, { nowMs: this.now() });
    this.units.set(next.id, next);
    return cloneUnitOfWork(next);
  }

  readiness(unitId: string): ReturnType<typeof checkUnitOfWorkReadiness> {
    return checkUnitOfWorkReadiness(this.requireUnit(unitId));
  }

  commit(unitId: string): UnitOfWork {
    const unit = this.requireUnit(unitId);
    const next = commitUnitOfWork(unit, { nowMs: this.now() });
    this.units.set(next.id, next);
    return cloneUnitOfWork(next);
  }

  rollback(unitId: string): UnitOfWork {
    const unit = this.requireUnit(unitId);
    const next = rollbackUnitOfWork(unit, { nowMs: this.now() });
    this.units.set(next.id, next);
    return cloneUnitOfWork(next);
  }

  get(unitId: string): UnitOfWork | null {
    const unit = this.units.get(unitId);
    return unit ? cloneUnitOfWork(unit) : null;
  }

  snapshots(): UnitOfWorkSnapshot[] {
    return [...this.units.values()]
      .map(unitOfWorkSnapshot)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  listByOwner(ownerId: string): UnitOfWork[] {
    return [...this.units.values()]
      .filter((unit) => unit.ownerId === ownerId)
      .sort((a, b) => a.startedAtMs - b.startedAtMs || a.id.localeCompare(b.id))
      .map(cloneUnitOfWork);
  }

  private requireUnit(unitId: string): UnitOfWork {
    const unit = this.units.get(unitId);
    if (!unit) throw new Error("unit-of-work not found");
    return cloneUnitOfWork(unit);
  }
}
