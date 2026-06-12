export type MigrationStatus = "applied" | "failed";

export interface SchemaMigration {
  id: string;
  checksum: string;
  description: string;
}

export interface AppliedMigration {
  id: string;
  checksum: string;
  status: MigrationStatus;
  appliedAtMs: number;
  runnerId: string;
  error?: string;
}

export interface MigrationLock {
  ownerId: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  fencingToken: number;
}

export interface MigrationState {
  applied: readonly AppliedMigration[];
  lock?: MigrationLock;
  nextFencingToken: number;
}

export interface MigrationPlan {
  pending: readonly SchemaMigration[];
  alreadyApplied: readonly AppliedMigration[];
}

export interface MigrationSnapshot {
  applied: number;
  failed: number;
  pending: number;
  lockOwner?: string;
}

export function createMigrationState(): MigrationState {
  return {
    applied: [],
    nextFencingToken: 1,
  };
}

export function acquireMigrationLock(
  state: MigrationState,
  input: {
    ownerId: string;
    nowMs: number;
    ttlMs: number;
  },
): { state: MigrationState; lock: MigrationLock; acquired: boolean } {
  assertState(state);
  assertNonEmpty(input.ownerId, "ownerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");

  if (state.lock && state.lock.expiresAtMs > input.nowMs && state.lock.ownerId !== input.ownerId) {
    return { state: cloneState(state), lock: { ...state.lock }, acquired: false };
  }

  const lock: MigrationLock = {
    ownerId: input.ownerId,
    acquiredAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    fencingToken:
      state.lock?.ownerId === input.ownerId ? state.lock.fencingToken : state.nextFencingToken,
  };
  return {
    state: cloneState({
      ...state,
      lock,
      nextFencingToken:
        state.lock?.ownerId === input.ownerId ? state.nextFencingToken : state.nextFencingToken + 1,
    }),
    lock,
    acquired: true,
  };
}

export function releaseMigrationLock(
  state: MigrationState,
  input: {
    ownerId: string;
  },
): MigrationState {
  assertState(state);
  assertNonEmpty(input.ownerId, "ownerId");
  if (!state.lock || state.lock.ownerId !== input.ownerId) throw new Error("lock not owned");
  return cloneState({
    ...state,
    lock: undefined,
  });
}

export function planMigrations(
  state: MigrationState,
  migrations: readonly SchemaMigration[],
): MigrationPlan {
  assertState(state);
  assertMigrations(migrations);
  const applied = state.applied.filter((entry) => entry.status === "applied");
  for (const migration of migrations) {
    const existing = applied.find((entry) => entry.id === migration.id);
    if (existing && existing.checksum !== migration.checksum) {
      throw new Error(`checksum mismatch for migration ${migration.id}`);
    }
  }
  const appliedIds = new Set(applied.map((entry) => entry.id));
  return {
    pending: migrations.filter((migration) => !appliedIds.has(migration.id)).map(cloneMigration),
    alreadyApplied: applied.map(cloneApplied),
  };
}

export function markMigrationApplied(
  state: MigrationState,
  input: {
    migration: SchemaMigration;
    runnerId: string;
    nowMs: number;
  },
): MigrationState {
  assertState(state);
  assertMigration(input.migration);
  assertLockOwner(state, input.runnerId, input.nowMs);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const existingApplied = state.applied.find(
    (entry) => entry.id === input.migration.id && entry.status === "applied",
  );
  if (existingApplied) {
    if (existingApplied.checksum !== input.migration.checksum) {
      throw new Error(`checksum mismatch for migration ${input.migration.id}`);
    }
    return cloneState(state);
  }

  return cloneState({
    ...state,
    applied: [
      ...state.applied.filter((entry) => entry.id !== input.migration.id),
      {
        id: input.migration.id,
        checksum: input.migration.checksum,
        status: "applied",
        appliedAtMs: input.nowMs,
        runnerId: input.runnerId,
      },
    ],
  });
}

export function markMigrationFailed(
  state: MigrationState,
  input: {
    migration: SchemaMigration;
    runnerId: string;
    nowMs: number;
    error: string;
  },
): MigrationState {
  assertState(state);
  assertMigration(input.migration);
  assertLockOwner(state, input.runnerId, input.nowMs);
  assertNonEmpty(input.error, "error");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return cloneState({
    ...state,
    applied: [
      ...state.applied.filter((entry) => entry.id !== input.migration.id),
      {
        id: input.migration.id,
        checksum: input.migration.checksum,
        status: "failed",
        appliedAtMs: input.nowMs,
        runnerId: input.runnerId,
        error: input.error,
      },
    ],
  });
}

export function migrationSnapshot(
  state: MigrationState,
  migrations: readonly SchemaMigration[],
): MigrationSnapshot {
  assertState(state);
  assertMigrations(migrations);
  return {
    applied: state.applied.filter((entry) => entry.status === "applied").length,
    failed: state.applied.filter((entry) => entry.status === "failed").length,
    pending: planMigrations(state, migrations).pending.length,
    lockOwner: state.lock?.ownerId,
  };
}

export function cloneMigrationState(state: MigrationState): MigrationState {
  assertState(state);
  return cloneState(state);
}

function assertLockOwner(state: MigrationState, runnerId: string, nowMs: number): void {
  assertNonEmpty(runnerId, "runnerId");
  if (!state.lock || state.lock.ownerId !== runnerId || state.lock.expiresAtMs <= nowMs) {
    throw new Error("active migration lock required");
  }
}

function assertMigrations(migrations: readonly SchemaMigration[]): void {
  const ids = new Set<string>();
  for (const migration of migrations) {
    assertMigration(migration);
    if (ids.has(migration.id)) throw new Error(`duplicate migration ${migration.id}`);
    ids.add(migration.id);
  }
}

function assertMigration(migration: SchemaMigration): void {
  assertNonEmpty(migration.id, "migration.id");
  assertNonEmpty(migration.checksum, "migration.checksum");
  assertNonEmpty(migration.description, "migration.description");
}

function assertState(state: MigrationState): void {
  if (!Array.isArray(state.applied)) throw new Error("applied must be an array");
  assertPositiveInteger(state.nextFencingToken, "nextFencingToken");
}

function cloneState(state: MigrationState): MigrationState {
  return {
    applied: state.applied.map(cloneApplied),
    lock: state.lock ? { ...state.lock } : undefined,
    nextFencingToken: state.nextFencingToken,
  };
}

function cloneMigration(migration: SchemaMigration): SchemaMigration {
  return { ...migration };
}

function cloneApplied(applied: AppliedMigration): AppliedMigration {
  return { ...applied };
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
