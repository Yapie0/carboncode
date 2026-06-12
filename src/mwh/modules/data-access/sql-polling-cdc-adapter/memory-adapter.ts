import {
  type SqlPollingBatch,
  type SqlPollingCheckpoint,
  type SqlPollingRow,
  type SqlPollingSource,
  advanceSqlPollingCheckpoint,
  cloneSqlPollingCheckpoint,
  cloneSqlPollingRow,
  commitSqlPollingBatch,
  createSqlPollingBatch,
  createSqlPollingCheckpoint,
} from "./core.js";

export class MemorySqlPollingCdcAdapter {
  private readonly now: () => number;
  private readonly source: SqlPollingSource;
  private readonly rows: SqlPollingRow[] = [];
  private readonly checkpoints = new Map<string, SqlPollingCheckpoint>();
  private nextSequence = 1;

  constructor(input: { source: SqlPollingSource; now?: () => number }) {
    this.source = input.source;
    this.now = input.now ?? Date.now;
  }

  append(
    input: Omit<SqlPollingRow, "sequence" | "occurredAtMs"> & { occurredAtMs?: number },
  ): SqlPollingRow {
    const row: SqlPollingRow = {
      sequence: this.nextSequence,
      primaryKey: input.primaryKey,
      operation: input.operation,
      before: cloneRecord(input.before),
      after: cloneRecord(input.after),
      occurredAtMs: input.occurredAtMs ?? this.now(),
    };
    createSqlPollingBatch(this.source, this.ensureCheckpoint("validator"), [row], {
      limit: 1,
      nowMs: row.occurredAtMs,
    });
    this.nextSequence += 1;
    this.rows.push(cloneSqlPollingRow(row));
    this.checkpoints.delete(this.key("validator"));
    return cloneSqlPollingRow(row);
  }

  ensureCheckpoint(consumerId: string): SqlPollingCheckpoint {
    const key = this.key(consumerId);
    const existing = this.checkpoints.get(key);
    if (existing) return cloneSqlPollingCheckpoint(existing);
    const created = createSqlPollingCheckpoint({
      consumerId,
      table: this.source.table,
      nowMs: this.now(),
    });
    this.checkpoints.set(key, created);
    return cloneSqlPollingCheckpoint(created);
  }

  poll(input: { consumerId: string; limit: number }): SqlPollingBatch {
    const checkpoint = this.ensureCheckpoint(input.consumerId);
    return createSqlPollingBatch(this.source, checkpoint, this.rows, {
      limit: input.limit,
      nowMs: this.now(),
    });
  }

  ack(input: { consumerId: string; sequence: number }): SqlPollingCheckpoint {
    const current = this.ensureCheckpoint(input.consumerId);
    const checked = advanceSqlPollingCheckpoint(current, {
      sequence: input.sequence,
      nowMs: this.now(),
    });
    this.checkpoints.set(this.key(input.consumerId), checked);
    return cloneSqlPollingCheckpoint(checked);
  }

  ackBatch(batch: SqlPollingBatch): SqlPollingCheckpoint {
    const current = this.ensureCheckpoint(batch.checkpoint.consumerId);
    const next = commitSqlPollingBatch(current, batch);
    this.checkpoints.set(this.key(batch.checkpoint.consumerId), next);
    return cloneSqlPollingCheckpoint(next);
  }

  lag(consumerId: string): number {
    const checkpoint = this.ensureCheckpoint(consumerId);
    return this.rows.filter((row) => row.sequence > checkpoint.lastSequence).length;
  }

  listRows(): SqlPollingRow[] {
    return this.rows.map(cloneSqlPollingRow);
  }

  listCheckpoints(): SqlPollingCheckpoint[] {
    return [...this.checkpoints.values()]
      .map(cloneSqlPollingCheckpoint)
      .sort((a, b) => a.consumerId.localeCompare(b.consumerId));
  }

  private key(consumerId: string): string {
    return `${consumerId}:${this.source.table}`;
  }
}

function cloneRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
