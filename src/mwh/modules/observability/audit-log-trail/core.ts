import { createHash } from "node:crypto";

export type AuditAction = "create" | "update" | "delete" | "read" | "login" | "logout" | "custom";
export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditEvent {
  id: string;
  actorId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  outcome: AuditOutcome;
  occurredAtMs: number;
  metadata?: Record<string, unknown>;
}

export interface AuditLogEntry extends AuditEvent {
  sequence: number;
  previousHash: string;
  hash: string;
}

export interface AuditVerifyResult {
  valid: boolean;
  invalidAtSequence?: number;
  reason?: string;
}

export function createAuditEvent(input: {
  id: string;
  actorId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  outcome?: AuditOutcome;
  occurredAtMs: number;
  metadata?: Record<string, unknown>;
  redactedKeys?: string[];
}): AuditEvent {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.actorId, "actorId");
  assertNonEmpty(input.resourceType, "resourceType");
  assertNonEmpty(input.resourceId, "resourceId");
  assertNonNegativeInteger(input.occurredAtMs, "occurredAtMs");
  return {
    id: input.id,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? "success",
    occurredAtMs: input.occurredAtMs,
    metadata: input.metadata
      ? redactAuditMetadata(input.metadata, input.redactedKeys ?? defaultRedactedKeys)
      : undefined,
  };
}

export function appendAuditEntry(
  previous: AuditLogEntry | undefined,
  event: AuditEvent,
): AuditLogEntry {
  const sequence = previous ? previous.sequence + 1 : 1;
  const previousHash = previous?.hash ?? genesisHash;
  const entryWithoutHash = { ...event, sequence, previousHash };
  return {
    ...entryWithoutHash,
    hash: hashAuditEntry(entryWithoutHash),
  };
}

export function verifyAuditChain(entries: readonly AuditLogEntry[]): AuditVerifyResult {
  let previous: AuditLogEntry | undefined;
  for (const entry of [...entries].sort((a, b) => a.sequence - b.sequence)) {
    const expectedSequence = previous ? previous.sequence + 1 : 1;
    if (entry.sequence !== expectedSequence) {
      return {
        valid: false,
        invalidAtSequence: entry.sequence,
        reason: "sequence gap or duplicate",
      };
    }
    const expectedPreviousHash = previous?.hash ?? genesisHash;
    if (entry.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        invalidAtSequence: entry.sequence,
        reason: "previous hash mismatch",
      };
    }
    const expectedHash = hashAuditEntry(entry);
    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        invalidAtSequence: entry.sequence,
        reason: "entry hash mismatch",
      };
    }
    previous = entry;
  }
  return { valid: true };
}

export function redactAuditMetadata(
  value: Record<string, unknown>,
  redactedKeys: readonly string[],
): Record<string, unknown> {
  const keys = new Set(redactedKeys.map((key) => key.toLowerCase()));
  return redactValue(value, keys) as Record<string, unknown>;
}

export function hashAuditEntry(entry: Omit<AuditLogEntry, "hash"> | AuditLogEntry): string {
  const stable = stableStringify({
    id: entry.id,
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    outcome: entry.outcome,
    occurredAtMs: entry.occurredAtMs,
    metadata: entry.metadata,
    sequence: entry.sequence,
    previousHash: entry.previousHash,
  });
  return createHash("sha256").update(stable, "utf8").digest("hex");
}

export function auditEntryMatches(
  entry: AuditLogEntry,
  filter: { actorId?: string; resourceType?: string; resourceId?: string; action?: AuditAction },
): boolean {
  return (
    (!filter.actorId || entry.actorId === filter.actorId) &&
    (!filter.resourceType || entry.resourceType === filter.resourceType) &&
    (!filter.resourceId || entry.resourceId === filter.resourceId) &&
    (!filter.action || entry.action === filter.action)
  );
}

const genesisHash = "0".repeat(64);
const defaultRedactedKeys = ["password", "token", "secret", "authorization", "apiKey"];

function redactValue(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = keys.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(nested, keys);
  }
  return output;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
