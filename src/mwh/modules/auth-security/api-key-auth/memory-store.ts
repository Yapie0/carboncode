import {
  type ApiKeyAuthDecision,
  type ApiKeyRecord,
  apiKeyPrefix,
  authenticateApiKey,
  createApiKeyRecord,
  markApiKeyUsed,
  revokeApiKey,
  rotateApiKey,
  setApiKeyEnabled,
} from "./core.js";

export interface MemoryApiKeyStoreOptions {
  now?: () => number;
}

export class MemoryApiKeyStore {
  private readonly now: () => number;
  private readonly records = new Map<string, ApiKeyRecord>();

  constructor(opts: MemoryApiKeyStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  create(input: {
    id: string;
    ownerId: string;
    rawKey: string;
    scopes: readonly string[];
    expiresAtMs?: number;
  }): ApiKeyRecord {
    if (this.records.has(input.id)) throw new Error(`api key already exists: ${input.id}`);
    const record = createApiKeyRecord({ ...input, nowMs: this.now() });
    this.records.set(record.id, record);
    return { ...record, scopes: [...record.scopes] };
  }

  authenticate(rawKey: string, requiredScope?: string): ApiKeyAuthDecision {
    const prefix = apiKeyPrefix(rawKey);
    const candidates = [...this.records.values()].filter((record) => record.prefix === prefix);
    for (const record of candidates) {
      const decision = authenticateApiKey(record, {
        rawKey,
        requiredScope,
        nowMs: this.now(),
      });
      if (decision.allowed) {
        this.records.set(record.id, markApiKeyUsed(record, this.now()));
        return decision;
      }
      if (decision.status !== "mismatch") return decision;
    }
    return { allowed: false, status: "not-found", reason: "api key not found" };
  }

  setEnabled(id: string, enabled: boolean): ApiKeyRecord {
    const next = setApiKeyEnabled(this.require(id), enabled);
    this.records.set(id, next);
    return { ...next, scopes: [...next.scopes] };
  }

  revoke(id: string, reason: string): ApiKeyRecord {
    const next = revokeApiKey(this.require(id), { nowMs: this.now(), reason });
    this.records.set(id, next);
    return { ...next, scopes: [...next.scopes] };
  }

  rotate(id: string, rawKey: string, expiresAtMs?: number): ApiKeyRecord {
    const next = rotateApiKey(this.require(id), {
      rawKey,
      nowMs: this.now(),
      expiresAtMs,
    });
    this.records.set(id, next);
    return { ...next, scopes: [...next.scopes] };
  }

  get(id: string): ApiKeyRecord | undefined {
    const record = this.records.get(id);
    return record ? { ...record, scopes: [...record.scopes] } : undefined;
  }

  list(ownerId?: string): ApiKeyRecord[] {
    return [...this.records.values()]
      .filter((record) => ownerId === undefined || record.ownerId === ownerId)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map((record) => ({ ...record, scopes: [...record.scopes] }));
  }

  private require(id: string): ApiKeyRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`api key not found: ${id}`);
    return record;
  }
}
