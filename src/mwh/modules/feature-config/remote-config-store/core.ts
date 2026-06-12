import { createHash } from "node:crypto";

export type RemoteConfigValue = string | number | boolean | null | Record<string, unknown>;

export interface RemoteConfigContext {
  environment: string;
  tenantId?: string;
  attributes?: Record<string, string | number | boolean | undefined>;
}

export interface RemoteConfigRule {
  id: string;
  priority: number;
  environment?: string;
  tenantId?: string;
  attributes?: Record<string, string | number | boolean>;
  value: RemoteConfigValue;
}

export interface RemoteConfigEntry {
  key: string;
  version: number;
  enabled: boolean;
  defaultValue: RemoteConfigValue;
  rules?: readonly RemoteConfigRule[];
  updatedAtMs: number;
}

export interface RemoteConfigResolution {
  key: string;
  value: RemoteConfigValue | undefined;
  version?: number;
  source: "missing" | "disabled" | "default" | "rule";
  ruleId?: string;
}

export interface RemoteConfigSnapshot {
  environment: string;
  tenantId?: string;
  generatedAtMs: number;
  etag: string;
  values: Record<string, RemoteConfigValue | undefined>;
  versions: Record<string, number>;
}

export function createRemoteConfigEntry(input: {
  key: string;
  defaultValue: RemoteConfigValue;
  nowMs: number;
  enabled?: boolean;
  version?: number;
  rules?: readonly RemoteConfigRule[];
}): RemoteConfigEntry {
  assertNonEmpty(input.key, "key");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const version = input.version ?? 1;
  assertPositiveInteger(version, "version");
  const entry: RemoteConfigEntry = {
    key: input.key,
    version,
    enabled: input.enabled ?? true,
    defaultValue: cloneValue(input.defaultValue),
    rules: input.rules?.map(cloneRule),
    updatedAtMs: input.nowMs,
  };
  validateRemoteConfigEntry(entry);
  return entry;
}

export function updateRemoteConfigEntry(
  current: RemoteConfigEntry,
  patch: Partial<Omit<RemoteConfigEntry, "key" | "version" | "updatedAtMs">> & { nowMs: number },
): RemoteConfigEntry {
  assertNonNegativeInteger(patch.nowMs, "nowMs");
  const next: RemoteConfigEntry = {
    key: current.key,
    version: current.version + 1,
    enabled: patch.enabled ?? current.enabled,
    defaultValue:
      patch.defaultValue === undefined
        ? cloneValue(current.defaultValue)
        : cloneValue(patch.defaultValue),
    rules: patch.rules ? patch.rules.map(cloneRule) : current.rules?.map(cloneRule),
    updatedAtMs: patch.nowMs,
  };
  validateRemoteConfigEntry(next);
  return next;
}

export function resolveRemoteConfig(
  entry: RemoteConfigEntry | undefined,
  context: RemoteConfigContext,
): RemoteConfigResolution {
  assertNonEmpty(context.environment, "environment");
  if (!entry) return { key: "", value: undefined, source: "missing" };
  validateRemoteConfigEntry(entry);
  if (!entry.enabled) {
    return { key: entry.key, value: undefined, version: entry.version, source: "disabled" };
  }
  const rule = [...(entry.rules ?? [])]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .find((candidate) => remoteConfigRuleMatches(candidate, context));
  if (rule) {
    return {
      key: entry.key,
      value: cloneValue(rule.value),
      version: entry.version,
      source: "rule",
      ruleId: rule.id,
    };
  }
  return {
    key: entry.key,
    value: cloneValue(entry.defaultValue),
    version: entry.version,
    source: "default",
  };
}

export function remoteConfigRuleMatches(
  rule: RemoteConfigRule,
  context: RemoteConfigContext,
): boolean {
  validateRemoteConfigRule(rule);
  assertNonEmpty(context.environment, "environment");
  if (rule.environment !== undefined && rule.environment !== context.environment) return false;
  if (rule.tenantId !== undefined && rule.tenantId !== context.tenantId) return false;
  for (const [key, expected] of Object.entries(rule.attributes ?? {})) {
    if (context.attributes?.[key] !== expected) return false;
  }
  return true;
}

export function createRemoteConfigSnapshot(
  entries: readonly RemoteConfigEntry[],
  context: RemoteConfigContext & { nowMs: number },
): RemoteConfigSnapshot {
  assertNonNegativeInteger(context.nowMs, "nowMs");
  const values: Record<string, RemoteConfigValue | undefined> = {};
  const versions: Record<string, number> = {};
  for (const entry of [...entries].sort((a, b) => a.key.localeCompare(b.key))) {
    const resolution = resolveRemoteConfig(entry, context);
    values[entry.key] = resolution.value;
    versions[entry.key] = entry.version;
  }
  return {
    environment: context.environment,
    tenantId: context.tenantId,
    generatedAtMs: context.nowMs,
    etag: remoteConfigEtag(values, versions),
    values,
    versions,
  };
}

export function remoteConfigEtag(
  values: Record<string, RemoteConfigValue | undefined>,
  versions: Record<string, number>,
): string {
  return createHash("sha256").update(JSON.stringify({ values, versions }), "utf8").digest("hex");
}

function validateRemoteConfigEntry(entry: RemoteConfigEntry): void {
  assertNonEmpty(entry.key, "key");
  assertPositiveInteger(entry.version, "version");
  assertNonNegativeInteger(entry.updatedAtMs, "updatedAtMs");
  for (const rule of entry.rules ?? []) validateRemoteConfigRule(rule);
}

function validateRemoteConfigRule(rule: RemoteConfigRule): void {
  assertNonEmpty(rule.id, "rule.id");
  if (!Number.isInteger(rule.priority)) throw new Error("rule.priority must be an integer");
}

function cloneRule(rule: RemoteConfigRule): RemoteConfigRule {
  validateRemoteConfigRule(rule);
  return {
    ...rule,
    attributes: rule.attributes ? { ...rule.attributes } : undefined,
    value: cloneValue(rule.value),
  };
}

function cloneValue<T extends RemoteConfigValue | undefined>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
