import { type CdcChange, type CdcOperation, createCdcChange } from "../change-data-capture/core.js";

export interface SqlPollingSource {
  table: string;
  sourceTable: string;
  sequenceColumn: string;
  primaryKeyColumn: string;
  operationColumn: string;
  occurredAtColumn: string;
  beforeColumn?: string;
  afterColumn?: string;
}

export interface SqlPollingCheckpoint {
  consumerId: string;
  table: string;
  lastSequence: number;
  updatedAtMs: number;
}

export interface SqlPollingPlan {
  sql: string;
  params: readonly unknown[];
}

export interface SqlPollingRow {
  sequence: number;
  primaryKey: string;
  operation: CdcOperation;
  occurredAtMs: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface SqlPollingBatch {
  checkpoint: SqlPollingCheckpoint;
  changes: CdcChange[];
  nextCheckpoint: SqlPollingCheckpoint | null;
  hasMore: boolean;
}

export function createSqlPollingCheckpoint(input: {
  consumerId: string;
  table: string;
  nowMs: number;
  lastSequence?: number;
}): SqlPollingCheckpoint {
  assertNonEmpty(input.consumerId, "consumerId");
  assertNonEmpty(input.table, "table");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonNegativeInteger(input.lastSequence ?? 0, "lastSequence");
  return {
    consumerId: input.consumerId,
    table: input.table,
    lastSequence: input.lastSequence ?? 0,
    updatedAtMs: input.nowMs,
  };
}

export function buildSqlPollingPlan(
  source: SqlPollingSource,
  checkpoint: SqlPollingCheckpoint,
  input: { limit: number },
): SqlPollingPlan {
  validateSource(source);
  assertPositiveInteger(input.limit, "limit");
  if (source.table !== checkpoint.table) {
    throw new Error("checkpoint table must match polling source table");
  }

  const selectColumns = [
    source.sequenceColumn,
    source.primaryKeyColumn,
    source.operationColumn,
    source.occurredAtColumn,
    source.beforeColumn,
    source.afterColumn,
  ].filter(Boolean);
  return {
    sql: `select ${selectColumns.join(", ")} from ${source.sourceTable} where ${
      source.sequenceColumn
    } > ? order by ${source.sequenceColumn} asc limit ?`,
    params: [checkpoint.lastSequence, input.limit],
  };
}

export function rowsToCdcChanges(
  source: SqlPollingSource,
  rows: readonly SqlPollingRow[],
): CdcChange[] {
  validateSource(source);
  return rows
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((row) =>
      createCdcChange({
        sequence: row.sequence,
        table: source.table,
        primaryKey: row.primaryKey,
        operation: row.operation,
        before: cloneRecord(row.before),
        after: cloneRecord(row.after),
        occurredAtMs: row.occurredAtMs,
      }),
    );
}

export function createSqlPollingBatch(
  source: SqlPollingSource,
  checkpoint: SqlPollingCheckpoint,
  rows: readonly SqlPollingRow[],
  input: { limit: number; nowMs: number },
): SqlPollingBatch {
  assertPositiveInteger(input.limit, "limit");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const eligible = rowsToCdcChanges(source, rows).filter(
    (change) => change.sequence > checkpoint.lastSequence,
  );
  const changes = eligible.slice(0, input.limit);
  const last = changes.at(-1);
  return {
    checkpoint: cloneSqlPollingCheckpoint(checkpoint),
    changes,
    nextCheckpoint: last
      ? advanceSqlPollingCheckpoint(checkpoint, {
          sequence: last.sequence,
          nowMs: input.nowMs,
        })
      : null,
    hasMore: eligible.length > input.limit,
  };
}

export function commitSqlPollingBatch(
  checkpoint: SqlPollingCheckpoint,
  batch: SqlPollingBatch,
): SqlPollingCheckpoint {
  if (batch.checkpoint.consumerId !== checkpoint.consumerId) {
    throw new Error("batch consumer must match checkpoint consumer");
  }
  if (batch.checkpoint.table !== checkpoint.table) {
    throw new Error("batch table must match checkpoint table");
  }
  if (batch.checkpoint.lastSequence !== checkpoint.lastSequence) {
    throw new Error("batch checkpoint is stale");
  }
  return batch.nextCheckpoint
    ? cloneSqlPollingCheckpoint(batch.nextCheckpoint)
    : cloneSqlPollingCheckpoint(checkpoint);
}

export function advanceSqlPollingCheckpoint(
  checkpoint: SqlPollingCheckpoint,
  input: { sequence: number; nowMs: number },
): SqlPollingCheckpoint {
  assertNonNegativeInteger(input.sequence, "sequence");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.sequence < checkpoint.lastSequence) {
    throw new Error("cannot move SQL polling checkpoint backwards");
  }
  return {
    ...checkpoint,
    lastSequence: input.sequence,
    updatedAtMs: input.nowMs,
  };
}

export function cloneSqlPollingCheckpoint(checkpoint: SqlPollingCheckpoint): SqlPollingCheckpoint {
  return { ...checkpoint };
}

export function cloneSqlPollingRow(row: SqlPollingRow): SqlPollingRow {
  return {
    ...row,
    before: cloneRecord(row.before),
    after: cloneRecord(row.after),
  };
}

function validateSource(source: SqlPollingSource): void {
  assertNonEmpty(source.table, "table");
  assertSqlIdentifier(source.sourceTable, "sourceTable");
  assertSqlIdentifier(source.sequenceColumn, "sequenceColumn");
  assertSqlIdentifier(source.primaryKeyColumn, "primaryKeyColumn");
  assertSqlIdentifier(source.operationColumn, "operationColumn");
  assertSqlIdentifier(source.occurredAtColumn, "occurredAtColumn");
  if (source.beforeColumn !== undefined) assertSqlIdentifier(source.beforeColumn, "beforeColumn");
  if (source.afterColumn !== undefined) assertSqlIdentifier(source.afterColumn, "afterColumn");
}

function cloneRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function assertSqlIdentifier(value: string, name: string): void {
  assertNonEmpty(value, name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${name} must be a safe SQL identifier`);
  }
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
