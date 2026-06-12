import {
  type RemoteConfigContext,
  type RemoteConfigEntry,
  type RemoteConfigResolution,
  type RemoteConfigSnapshot,
  type RemoteConfigValue,
  createRemoteConfigEntry,
  createRemoteConfigSnapshot,
  resolveRemoteConfig,
  updateRemoteConfigEntry,
} from "./core.js";

export interface MemoryRemoteConfigStoreOptions {
  now?: () => number;
}

export class MemoryRemoteConfigStore {
  private readonly now: () => number;
  private readonly entries = new Map<string, RemoteConfigEntry>();
  private readonly history = new Map<string, RemoteConfigEntry[]>();

  constructor(opts: MemoryRemoteConfigStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  upsert(input: {
    key: string;
    defaultValue: RemoteConfigValue;
    enabled?: boolean;
    rules?: RemoteConfigEntry["rules"];
  }): RemoteConfigEntry {
    const current = this.entries.get(input.key);
    const next = current
      ? updateRemoteConfigEntry(current, { ...input, nowMs: this.now() })
      : createRemoteConfigEntry({ ...input, nowMs: this.now() });
    this.save(next);
    return cloneEntry(next);
  }

  resolve(key: string, context: RemoteConfigContext): RemoteConfigResolution {
    const resolution = resolveRemoteConfig(this.entries.get(key), context);
    return resolution.key ? resolution : { ...resolution, key };
  }

  snapshot(context: RemoteConfigContext): RemoteConfigSnapshot {
    return createRemoteConfigSnapshot([...this.entries.values()], {
      ...context,
      nowMs: this.now(),
    });
  }

  rollback(key: string, version: number): RemoteConfigEntry {
    const versions = this.history.get(key) ?? [];
    const found = versions.find((entry) => entry.version === version);
    if (!found) throw new Error(`remote config version not found: ${key}@${version}`);
    const current = this.entries.get(key);
    const next = updateRemoteConfigEntry(
      { ...found, version: current?.version ?? found.version },
      {
        enabled: found.enabled,
        defaultValue: found.defaultValue,
        rules: found.rules,
        nowMs: this.now(),
      },
    );
    this.save(next);
    return cloneEntry(next);
  }

  get(key: string): RemoteConfigEntry | undefined {
    const entry = this.entries.get(key);
    return entry ? cloneEntry(entry) : undefined;
  }

  versions(key: string): RemoteConfigEntry[] {
    return (this.history.get(key) ?? []).map(cloneEntry);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  list(): RemoteConfigEntry[] {
    return [...this.entries.values()].sort((a, b) => a.key.localeCompare(b.key)).map(cloneEntry);
  }

  private save(entry: RemoteConfigEntry): void {
    this.entries.set(entry.key, entry);
    const versions = this.history.get(entry.key) ?? [];
    versions.push(entry);
    this.history.set(entry.key, versions);
  }
}

function cloneEntry(entry: RemoteConfigEntry): RemoteConfigEntry {
  return {
    ...entry,
    defaultValue: cloneValue(entry.defaultValue),
    rules: entry.rules?.map((rule) => ({
      ...rule,
      attributes: rule.attributes ? { ...rule.attributes } : undefined,
      value: cloneValue(rule.value),
    })),
  };
}

function cloneValue<T extends RemoteConfigValue | undefined>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
