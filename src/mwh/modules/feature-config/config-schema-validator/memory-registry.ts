import {
  type ConfigSchema,
  type ConfigSchemaRecord,
  type ConfigSchemaSnapshot,
  type ConfigValidationResult,
  checkConfigSchemaCompatibility,
  cloneConfigSchemaRecord,
  configSchemaSnapshot,
  createConfigSchemaRecord,
  publishConfigSchemaRecord,
  updateConfigSchemaRecord,
  validateConfigSamples,
  validateConfigValue,
} from "./core.js";

export interface MemoryConfigSchemaRegistryOptions {
  now?: () => number;
}

export class MemoryConfigSchemaRegistry {
  private readonly records = new Map<string, ConfigSchemaRecord>();
  private readonly now: () => number;

  constructor(options: MemoryConfigSchemaRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  create(input: { key: string; schema: ConfigSchema }): ConfigSchemaRecord {
    if (this.records.has(input.key)) throw new Error("config schema already exists");
    const record = createConfigSchemaRecord({ ...input, nowMs: this.now() });
    this.records.set(record.key, record);
    return cloneConfigSchemaRecord(record);
  }

  update(
    key: string,
    schema: ConfigSchema,
    input: { requireCompatible?: boolean } = {},
  ): ConfigSchemaRecord {
    const current = this.requireRecord(key);
    if (input.requireCompatible) {
      const compatibility = checkConfigSchemaCompatibility(current.schema, schema);
      if (!compatibility.compatible) {
        throw new Error(
          `config schema is not backward compatible: ${compatibility.issues[0]?.message ?? "invalid"}`,
        );
      }
    }
    const record = updateConfigSchemaRecord(current, {
      schema,
      nowMs: this.now(),
    });
    this.records.set(key, record);
    return cloneConfigSchemaRecord(record);
  }

  publish(key: string, sampleValue?: unknown): ConfigSchemaRecord {
    const record = publishConfigSchemaRecord(this.requireRecord(key), {
      nowMs: this.now(),
      sampleValue,
    });
    this.records.set(key, record);
    return cloneConfigSchemaRecord(record);
  }

  validate(key: string, value: unknown): ConfigValidationResult {
    const record = this.requireRecord(key);
    if (record.status !== "published") throw new Error("config schema is not published");
    return validateConfigValue(value, record.schema);
  }

  validateDraft(key: string, value: unknown): ConfigValidationResult {
    return validateConfigValue(value, this.requireRecord(key).schema);
  }

  validateSamples(
    key: string,
    samples: readonly { name: string; value: unknown }[],
  ): ReturnType<typeof validateConfigSamples> {
    return validateConfigSamples(this.requireRecord(key).schema, samples);
  }

  compatibility(
    key: string,
    nextSchema: ConfigSchema,
  ): ReturnType<typeof checkConfigSchemaCompatibility> {
    return checkConfigSchemaCompatibility(this.requireRecord(key).schema, nextSchema);
  }

  list(): ConfigSchemaRecord[] {
    return [...this.records.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map(cloneConfigSchemaRecord);
  }

  snapshot(): ConfigSchemaSnapshot {
    return configSchemaSnapshot([...this.records.values()]);
  }

  private requireRecord(key: string): ConfigSchemaRecord {
    const record = this.records.get(key);
    if (!record) throw new Error("config schema not found");
    return cloneConfigSchemaRecord(record);
  }
}
