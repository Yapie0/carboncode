import {
  type CdcBatch,
  type CdcChange,
  type CdcCursor,
  type CdcEnvelope,
  type CdcOperation,
  type CdcSnapshot,
  ackCdcCursor,
  cdcSnapshot,
  cloneCdcChange,
  cloneCdcCursor,
  commitCdcBatch,
  createCdcBatch,
  createCdcChange,
  createCdcCursor,
  readCdcBatch,
} from "./core.js";

export interface MemoryCdcLogOptions {
  now?: () => number;
}

export class MemoryCdcLog {
  private readonly now: () => number;
  private nextSequence = 1;
  private readonly changes: CdcChange[] = [];
  private readonly cursors = new Map<string, CdcCursor>();

  constructor(opts: MemoryCdcLogOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  append(input: {
    table: string;
    primaryKey: string;
    operation: CdcOperation;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }): CdcChange {
    const change = createCdcChange({
      ...input,
      sequence: this.nextSequence,
      occurredAtMs: this.now(),
    });
    this.nextSequence += 1;
    this.changes.push(change);
    return cloneCdcChange(change);
  }

  ensureCursor(consumerId: string): CdcCursor {
    const existing = this.cursors.get(consumerId);
    if (existing) return cloneCdcCursor(existing);
    const cursor = createCdcCursor({ consumerId, nowMs: this.now() });
    this.cursors.set(consumerId, cursor);
    return cloneCdcCursor(cursor);
  }

  read(input: { consumerId: string; limit: number; tables?: readonly string[] }): CdcEnvelope[] {
    const cursor = this.ensureCursor(input.consumerId);
    return readCdcBatch(this.changes, cursor, input);
  }

  batch(input: { consumerId: string; limit: number; tables?: readonly string[] }): CdcBatch {
    const cursor = this.ensureCursor(input.consumerId);
    return createCdcBatch(this.changes, cursor, input);
  }

  ack(input: { consumerId: string; sequence: number }): CdcCursor {
    const cursor = this.ensureCursor(input.consumerId);
    const next = ackCdcCursor(cursor, { sequence: input.sequence, nowMs: this.now() });
    this.cursors.set(input.consumerId, next);
    return cloneCdcCursor(next);
  }

  ackBatch(batch: CdcBatch): CdcCursor {
    const cursor = this.ensureCursor(batch.cursor.consumerId);
    const next = commitCdcBatch(cursor, batch, { nowMs: this.now() });
    this.cursors.set(cursor.consumerId, next);
    return cloneCdcCursor(next);
  }

  lag(consumerId: string, tables?: readonly string[]): number {
    const cursor = this.ensureCursor(consumerId);
    const tableFilter = tables ? new Set(tables) : null;
    return this.changes.filter(
      (change) =>
        change.sequence > cursor.lastAckedSequence &&
        (!tableFilter || tableFilter.has(change.table)),
    ).length;
  }

  listChanges(): CdcChange[] {
    return this.changes.map(cloneCdcChange);
  }

  snapshot(): CdcSnapshot {
    return cdcSnapshot(this.changes, [...this.cursors.values()]);
  }
}
