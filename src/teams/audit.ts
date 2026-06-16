import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { auditJsonlPath } from "./paths.js";
import type { TeamAuditEntry } from "./types.js";

const GENESIS_HASH = "0".repeat(64);
const SENSITIVE_KEYS = ["password", "token", "secret", "authorization", "apikey"];

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function redactValue(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    output[k] = keys.has(k.toLowerCase()) ? "[REDACTED]" : redactValue(v, keys);
  }
  return output;
}

function redactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  return redactValue(meta, new Set(SENSITIVE_KEYS)) as Record<string, unknown>;
}

function computeHash(entry: Omit<TeamAuditEntry, "hash">): string {
  const payload = stableStringify({
    id: entry.id,
    sequence: entry.sequence,
    prevHash: entry.prevHash,
    actor: entry.actor,
    action: entry.action,
    outcome: entry.outcome,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    createdAt: entry.createdAt,
    metadata: entry.metadata,
  });
  return createHash("sha256").update(payload, "utf-8").digest("hex");
}

export interface AppendAuditInput {
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome?: "success" | "failure" | "denied";
  metadata?: Record<string, unknown>;
}

export function appendAudit(
  workspaceRoot: string,
  teamId: string,
  input: AppendAuditInput,
): TeamAuditEntry {
  const path = auditJsonlPath(workspaceRoot, teamId);
  const prev = getLatestEntry(path);

  const entry: Omit<TeamAuditEntry, "hash"> = {
    id: randomUUID(),
    sequence: prev ? prev.sequence + 1 : 1,
    prevHash: prev?.hash ?? GENESIS_HASH,
    actor: input.actor,
    action: input.action,
    outcome: input.outcome ?? "success",
    resource: `${input.resourceType}:${input.resourceId}`,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    createdAt: new Date().toISOString(),
    metadata: input.metadata ? redactMetadata(input.metadata) : {},
  };

  const hash = computeHash(entry);
  const fullEntry: TeamAuditEntry = { ...entry, hash };

  appendFileSync(path, `${JSON.stringify(fullEntry)}\n`, "utf-8");
  return fullEntry;
}

export function readAuditLog(workspaceRoot: string, teamId: string): TeamAuditEntry[] {
  try {
    const raw = readFileSync(auditJsonlPath(workspaceRoot, teamId), "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line) as TeamAuditEntry);
  } catch {
    return [];
  }
}

export interface AuditQueryFilter {
  actor?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  limit?: number;
}

export function queryAuditLog(
  workspaceRoot: string,
  teamId: string,
  filter: AuditQueryFilter = {},
): TeamAuditEntry[] {
  const entries = readAuditLog(workspaceRoot, teamId);
  const limit = filter.limit && filter.limit > 0 ? filter.limit : Number.POSITIVE_INFINITY;

  return entries
    .filter(
      (e) =>
        (!filter.actor || e.actor === filter.actor) &&
        (!filter.resourceType || e.resourceType === filter.resourceType) &&
        (!filter.resourceId || e.resourceId === filter.resourceId) &&
        (!filter.action || e.action === filter.action),
    )
    .slice(0, limit);
}

export interface AuditVerifyResult {
  valid: boolean;
  invalidAtSequence?: number;
  reason?: string;
}

export function verifyAuditIntegrity(workspaceRoot: string, teamId: string): AuditVerifyResult {
  const entries = readAuditLog(workspaceRoot, teamId);
  if (entries.length === 0) return { valid: true };

  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  let prev: TeamAuditEntry | undefined;

  for (const entry of sorted) {
    // 检查 sequence 连续性
    const expectedSeq = prev ? prev.sequence + 1 : 1;
    if (entry.sequence !== expectedSeq) {
      return {
        valid: false,
        invalidAtSequence: entry.sequence,
        reason: "sequence gap or duplicate",
      };
    }

    // 检查 hash 链
    const expectedPrevHash = prev?.hash ?? GENESIS_HASH;
    if (entry.prevHash !== expectedPrevHash) {
      return {
        valid: false,
        invalidAtSequence: entry.sequence,
        reason: "previous hash mismatch",
      };
    }

    // 检查条目 hash
    const expectedHash = computeHash(entry);
    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        invalidAtSequence: entry.sequence,
        reason: "entry hash mismatch",
      };
    }

    prev = entry;
  }

  return { valid: true };
}

function getLatestEntry(path: string): TeamAuditEntry | null {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return null;
    const lines = raw.split("\n");
    const lastLine = lines[lines.length - 1]!;
    if (!lastLine.trim()) return null;
    return JSON.parse(lastLine) as TeamAuditEntry;
  } catch {
    return null;
  }
}
