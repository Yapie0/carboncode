import {
  type AuditAction,
  type AuditEvent,
  type AuditLogEntry,
  type AuditVerifyResult,
  appendAuditEntry,
  auditEntryMatches,
  createAuditEvent,
  verifyAuditChain,
} from "./core.js";

export interface MemoryAuditLogStoreOptions {
  now?: () => number;
  redactedKeys?: string[];
}

export class MemoryAuditLogStore {
  private readonly now: () => number;
  private readonly redactedKeys?: string[];
  private readonly entries: AuditLogEntry[] = [];

  constructor(options: MemoryAuditLogStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.redactedKeys = options.redactedKeys;
  }

  append(
    input: Omit<Parameters<typeof createAuditEvent>[0], "occurredAtMs" | "redactedKeys"> & {
      occurredAtMs?: number;
    },
  ): AuditLogEntry {
    const event = createAuditEvent({
      ...input,
      occurredAtMs: input.occurredAtMs ?? this.now(),
      redactedKeys: this.redactedKeys,
    });
    const entry = appendAuditEntry(this.entries.at(-1), event);
    this.entries.push(entry);
    return cloneEntry(entry);
  }

  appendEvent(event: AuditEvent): AuditLogEntry {
    const entry = appendAuditEntry(this.entries.at(-1), event);
    this.entries.push(entry);
    return cloneEntry(entry);
  }

  query(
    filter: {
      actorId?: string;
      resourceType?: string;
      resourceId?: string;
      action?: AuditAction;
      limit?: number;
    } = {},
  ): AuditLogEntry[] {
    const limit = filter.limit ?? Number.POSITIVE_INFINITY;
    if (limit !== Number.POSITIVE_INFINITY && (!Number.isInteger(limit) || limit <= 0)) {
      throw new Error("limit must be a positive integer");
    }
    return this.entries
      .filter((entry) => auditEntryMatches(entry, filter))
      .slice(0, limit)
      .map(cloneEntry);
  }

  verify(): AuditVerifyResult {
    return verifyAuditChain(this.entries);
  }

  list(): AuditLogEntry[] {
    return this.entries.map(cloneEntry);
  }
}

function cloneEntry(entry: AuditLogEntry): AuditLogEntry {
  return JSON.parse(JSON.stringify(entry)) as AuditLogEntry;
}
