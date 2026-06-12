import {
  type AppliedMigration,
  type MigrationLock,
  type MigrationPlan,
  type MigrationSnapshot,
  type MigrationState,
  type SchemaMigration,
  acquireMigrationLock,
  cloneMigrationState,
  createMigrationState,
  markMigrationApplied,
  markMigrationFailed,
  migrationSnapshot,
  planMigrations,
  releaseMigrationLock,
} from "./core.js";

export interface MemorySchemaMigrationRunnerOptions {
  runnerId: string;
  migrations: readonly SchemaMigration[];
  now?: () => number;
  lockTtlMs?: number;
}

export interface MigrationExecutionResult {
  applied: AppliedMigration[];
  failed?: AppliedMigration;
}

export type MigrationExecutor = (
  migration: SchemaMigration,
  lock: MigrationLock,
) => Promise<void> | void;

export class MemorySchemaMigrationRunner {
  private state: MigrationState = createMigrationState();
  private readonly runnerId: string;
  private readonly migrations: readonly SchemaMigration[];
  private readonly now: () => number;
  private readonly lockTtlMs: number;

  constructor(options: MemorySchemaMigrationRunnerOptions) {
    this.runnerId = options.runnerId;
    this.migrations = options.migrations.map((migration) => ({ ...migration }));
    this.now = options.now ?? Date.now;
    this.lockTtlMs = options.lockTtlMs ?? 30_000;
  }

  acquireLock(): { lock: MigrationLock; acquired: boolean } {
    const result = acquireMigrationLock(this.state, {
      ownerId: this.runnerId,
      nowMs: this.now(),
      ttlMs: this.lockTtlMs,
    });
    this.state = result.state;
    return { lock: result.lock, acquired: result.acquired };
  }

  releaseLock(): void {
    this.state = releaseMigrationLock(this.state, { ownerId: this.runnerId });
  }

  plan(): MigrationPlan {
    return planMigrations(this.state, this.migrations);
  }

  applyNext(): AppliedMigration | null {
    const migration = this.plan().pending[0];
    if (!migration) return null;
    this.state = markMigrationApplied(this.state, {
      migration,
      runnerId: this.runnerId,
      nowMs: this.now(),
    });
    return this.listApplied().find((entry) => entry.id === migration.id) ?? null;
  }

  failNext(error: string): AppliedMigration | null {
    const migration = this.plan().pending[0];
    if (!migration) return null;
    this.state = markMigrationFailed(this.state, {
      migration,
      runnerId: this.runnerId,
      nowMs: this.now(),
      error,
    });
    return this.listApplied().find((entry) => entry.id === migration.id) ?? null;
  }

  async runPending(executor: MigrationExecutor): Promise<MigrationExecutionResult> {
    const lockResult = this.acquireLock();
    if (!lockResult.acquired) throw new Error("migration lock not acquired");
    const applied: AppliedMigration[] = [];
    while (true) {
      const migration = this.plan().pending[0];
      if (!migration) return { applied };
      try {
        await Promise.resolve(executor(migration, lockResult.lock));
        this.state = markMigrationApplied(this.state, {
          migration,
          runnerId: this.runnerId,
          nowMs: this.now(),
        });
        const entry = this.listApplied().find((candidate) => candidate.id === migration.id);
        if (entry) applied.push(entry);
      } catch (error) {
        this.state = markMigrationFailed(this.state, {
          migration,
          runnerId: this.runnerId,
          nowMs: this.now(),
          error: (error as Error).message,
        });
        const failed = this.listApplied().find((candidate) => candidate.id === migration.id);
        return { applied, failed };
      }
    }
  }

  snapshot(): MigrationSnapshot {
    return migrationSnapshot(this.state, this.migrations);
  }

  listApplied(): AppliedMigration[] {
    return cloneMigrationState(this.state).applied.map((entry) => ({ ...entry }));
  }

  stateView(): MigrationState {
    return cloneMigrationState(this.state);
  }
}
