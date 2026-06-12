export type CdcOperation = "insert" | "update" | "delete";

export interface CdcChange {
  sequence: number;
  table: string;
  primaryKey: string;
  operation: CdcOperation;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  occurredAtMs: number;
}

export interface CdcEnvelope {
  id: string;
  topic: string;
  key: string;
  change: CdcChange;
}

export interface CdcCursor {
  consumerId: string;
  lastAckedSequence: number;
  updatedAtMs: number;
}

export interface CdcSnapshot {
  totalChanges: number;
  minSequence: number | null;
  maxSequence: number | null;
  cursors: CdcCursor[];
}

export interface CdcBatch {
  cursor: CdcCursor;
  envelopes: CdcEnvelope[];
  nextCursor: CdcCursor | null;
  hasMore: boolean;
}

export function createCdcChange(input: {
  sequence: number;
  table: string;
  primaryKey: string;
  operation: CdcOperation;
  occurredAtMs: number;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): CdcChange {
  assertPositiveInteger(input.sequence, "sequence");
  assertNonEmpty(input.table, "table");
  assertNonEmpty(input.primaryKey, "primaryKey");
  assertNonNegativeInteger(input.occurredAtMs, "occurredAtMs");
  if (input.operation === "insert" && input.after === undefined) {
    throw new Error("insert change requires after");
  }
  if (input.operation === "delete" && input.before === undefined) {
    throw new Error("delete change requires before");
  }
  return {
    sequence: input.sequence,
    table: input.table,
    primaryKey: input.primaryKey,
    operation: input.operation,
    before: cloneRecord(input.before),
    after: cloneRecord(input.after),
    occurredAtMs: input.occurredAtMs,
  };
}

export function cdcEnvelope(change: CdcChange, input: { topicPrefix?: string } = {}): CdcEnvelope {
  const topic = `${input.topicPrefix ?? "cdc"}.${change.table}`;
  return {
    id: `${change.table}:${change.primaryKey}:${change.sequence}`,
    topic,
    key: change.primaryKey,
    change: cloneCdcChange(change),
  };
}

export function createCdcCursor(input: {
  consumerId: string;
  nowMs: number;
  lastAckedSequence?: number;
}): CdcCursor {
  assertNonEmpty(input.consumerId, "consumerId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertNonNegativeInteger(input.lastAckedSequence ?? 0, "lastAckedSequence");
  return {
    consumerId: input.consumerId,
    lastAckedSequence: input.lastAckedSequence ?? 0,
    updatedAtMs: input.nowMs,
  };
}

export function readCdcBatch(
  changes: readonly CdcChange[],
  cursor: CdcCursor,
  input: { limit: number; tables?: readonly string[] },
): CdcEnvelope[] {
  return createCdcBatch(changes, cursor, input).envelopes;
}

export function createCdcBatch(
  changes: readonly CdcChange[],
  cursor: CdcCursor,
  input: { limit: number; tables?: readonly string[] },
): CdcBatch {
  assertPositiveInteger(input.limit, "limit");
  const tableFilter = input.tables ? new Set(input.tables) : null;
  const eligible = changes
    .filter((change) => change.sequence > cursor.lastAckedSequence)
    .filter((change) => !tableFilter || tableFilter.has(change.table))
    .sort((a, b) => a.sequence - b.sequence);
  const envelopes = eligible.slice(0, input.limit).map((change) => cdcEnvelope(change));
  const last = envelopes.at(-1);
  return {
    cursor: cloneCdcCursor(cursor),
    envelopes,
    nextCursor: last
      ? ackCdcCursor(cursor, { sequence: last.change.sequence, nowMs: cursor.updatedAtMs })
      : null,
    hasMore: eligible.length > input.limit,
  };
}

export function commitCdcBatch(
  cursor: CdcCursor,
  batch: CdcBatch,
  input: { nowMs: number },
): CdcCursor {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (batch.cursor.consumerId !== cursor.consumerId) {
    throw new Error("batch consumer must match cursor consumer");
  }
  if (batch.cursor.lastAckedSequence !== cursor.lastAckedSequence) {
    throw new Error("batch cursor is stale");
  }
  return batch.nextCursor
    ? ackCdcCursor(cursor, { sequence: batch.nextCursor.lastAckedSequence, nowMs: input.nowMs })
    : ackCdcCursor(cursor, { sequence: cursor.lastAckedSequence, nowMs: input.nowMs });
}

export function ackCdcCursor(
  cursor: CdcCursor,
  input: { sequence: number; nowMs: number },
): CdcCursor {
  assertNonNegativeInteger(input.sequence, "sequence");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.sequence < cursor.lastAckedSequence) {
    throw new Error("cannot move CDC cursor backwards");
  }
  return {
    consumerId: cursor.consumerId,
    lastAckedSequence: input.sequence,
    updatedAtMs: input.nowMs,
  };
}

export function cdcSnapshot(
  changes: readonly CdcChange[],
  cursors: readonly CdcCursor[],
): CdcSnapshot {
  const sequences = changes.map((change) => change.sequence);
  return {
    totalChanges: changes.length,
    minSequence: sequences.length > 0 ? Math.min(...sequences) : null,
    maxSequence: sequences.length > 0 ? Math.max(...sequences) : null,
    cursors: cursors.map(cloneCdcCursor).sort((a, b) => a.consumerId.localeCompare(b.consumerId)),
  };
}

export function cloneCdcChange(change: CdcChange): CdcChange {
  return {
    ...change,
    before: cloneRecord(change.before),
    after: cloneRecord(change.after),
  };
}

export function cloneCdcCursor(cursor: CdcCursor): CdcCursor {
  return { ...cursor };
}

function cloneRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
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
