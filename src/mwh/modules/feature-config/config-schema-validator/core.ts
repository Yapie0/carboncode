export type ConfigSchemaType = "object" | "string" | "number" | "boolean" | "array" | "null";

export interface ConfigSchema {
  type: ConfigSchemaType;
  required?: readonly string[];
  properties?: Record<string, ConfigSchema>;
  items?: ConfigSchema;
  enum?: readonly unknown[];
  defaultValue?: unknown;
  min?: number;
  max?: number;
  pattern?: string;
  additionalProperties?: boolean;
}

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  value: unknown;
  issues: readonly ConfigValidationIssue[];
}

export interface ConfigSchemaSnapshot {
  total: number;
  published: number;
  draft: number;
}

export interface ConfigCompatibilityIssue {
  path: string;
  message: string;
}

export interface ConfigCompatibilityResult {
  compatible: boolean;
  issues: readonly ConfigCompatibilityIssue[];
}

export interface ConfigSampleValidationResult {
  name: string;
  result: ConfigValidationResult;
}

export interface ConfigSchemaRecord {
  key: string;
  version: number;
  status: "draft" | "published";
  schema: ConfigSchema;
  createdAtMs: number;
  updatedAtMs: number;
}

export function validateConfigValue(value: unknown, schema: ConfigSchema): ConfigValidationResult {
  const normalized = validateAt(value, schema, "$");
  return {
    valid: normalized.issues.length === 0,
    value: normalized.value,
    issues: normalized.issues,
  };
}

export function validateConfigSamples(
  schema: ConfigSchema,
  samples: readonly { name: string; value: unknown }[],
): ConfigSampleValidationResult[] {
  return samples.map((sample) => {
    assertText(sample.name, "sample.name");
    return {
      name: sample.name,
      result: validateConfigValue(sample.value, schema),
    };
  });
}

export function checkConfigSchemaCompatibility(
  previous: ConfigSchema,
  next: ConfigSchema,
  path = "$",
): ConfigCompatibilityResult {
  const issues: ConfigCompatibilityIssue[] = [];
  collectCompatibilityIssues(previous, next, path, issues);
  return { compatible: issues.length === 0, issues };
}

export function createConfigSchemaRecord(input: {
  key: string;
  schema: ConfigSchema;
  nowMs: number;
}): ConfigSchemaRecord {
  assertText(input.key, "key");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  validateSchema(input.schema);
  return {
    key: input.key,
    version: 1,
    status: "draft",
    schema: cloneSchema(input.schema),
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
}

export function updateConfigSchemaRecord(
  record: ConfigSchemaRecord,
  input: { schema: ConfigSchema; nowMs: number },
): ConfigSchemaRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  validateSchema(input.schema);
  return cloneRecord({
    ...record,
    version: record.version + 1,
    status: "draft",
    schema: cloneSchema(input.schema),
    updatedAtMs: input.nowMs,
  });
}

export function publishConfigSchemaRecord(
  record: ConfigSchemaRecord,
  input: {
    nowMs: number;
    sampleValue?: unknown;
    samples?: readonly { name: string; value: unknown }[];
  },
): ConfigSchemaRecord {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.sampleValue !== undefined) {
    const result = validateConfigValue(input.sampleValue, record.schema);
    if (!result.valid)
      throw new Error(`sample config invalid: ${result.issues[0]?.message ?? "invalid"}`);
  }
  if (input.samples !== undefined) {
    const invalid = validateConfigSamples(record.schema, input.samples).find(
      (sample) => !sample.result.valid,
    );
    if (invalid) {
      throw new Error(
        `sample config invalid: ${invalid.name}: ${invalid.result.issues[0]?.message ?? "invalid"}`,
      );
    }
  }
  return cloneRecord({ ...record, status: "published", updatedAtMs: input.nowMs });
}

export function configSchemaSnapshot(records: readonly ConfigSchemaRecord[]): ConfigSchemaSnapshot {
  return {
    total: records.length,
    published: records.filter((record) => record.status === "published").length,
    draft: records.filter((record) => record.status === "draft").length,
  };
}

export function cloneConfigSchemaRecord(record: ConfigSchemaRecord): ConfigSchemaRecord {
  return cloneRecord(record);
}

function validateAt(
  value: unknown,
  schema: ConfigSchema,
  path: string,
): { value: unknown; issues: ConfigValidationIssue[] } {
  validateSchema(schema);
  const inputValue =
    value === undefined && schema.defaultValue !== undefined
      ? cloneJson(schema.defaultValue)
      : value;
  const issues: ConfigValidationIssue[] = [];
  if (!matchesType(inputValue, schema.type)) {
    return { value: inputValue, issues: [{ path, message: `expected ${schema.type}` }] };
  }
  if (schema.enum && !schema.enum.some((candidate) => deepEqual(candidate, inputValue))) {
    issues.push({ path, message: "value is not in enum" });
  }
  if (schema.type === "string" && typeof inputValue === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(inputValue)) {
      issues.push({ path, message: "string does not match pattern" });
    }
  }
  if (schema.type === "number" && typeof inputValue === "number") {
    if (schema.min !== undefined && inputValue < schema.min)
      issues.push({ path, message: "number below min" });
    if (schema.max !== undefined && inputValue > schema.max)
      issues.push({ path, message: "number above max" });
  }
  if (schema.type === "array" && Array.isArray(inputValue) && schema.items) {
    const output: unknown[] = [];
    inputValue.forEach((item, index) => {
      const nested = validateAt(item, schema.items!, `${path}.${index}`);
      output.push(nested.value);
      issues.push(...nested.issues);
    });
    return { value: output, issues };
  }
  if (schema.type === "object" && isPlainObject(inputValue)) {
    const output: Record<string, unknown> = { ...(inputValue as Record<string, unknown>) };
    for (const key of schema.required ?? []) {
      if (output[key] === undefined && schema.properties?.[key]?.defaultValue === undefined) {
        issues.push({ path: `${path}.${key}`, message: "required property is missing" });
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (output[key] === undefined && propertySchema.defaultValue === undefined) continue;
      const nested = validateAt(output[key], propertySchema, `${path}.${key}`);
      output[key] = nested.value;
      issues.push(...nested.issues);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(output)) {
        if (!allowed.has(key))
          issues.push({ path: `${path}.${key}`, message: "additional property is not allowed" });
      }
    }
    return { value: output, issues };
  }
  return { value: cloneJson(inputValue), issues };
}

function validateSchema(schema: ConfigSchema): void {
  if (!["object", "string", "number", "boolean", "array", "null"].includes(schema.type)) {
    throw new Error("unsupported schema type");
  }
  if (schema.type === "object") {
    for (const nested of Object.values(schema.properties ?? {})) validateSchema(nested);
  }
  if (schema.type === "array" && schema.items) validateSchema(schema.items);
  if (schema.pattern !== undefined) new RegExp(schema.pattern);
}

function collectCompatibilityIssues(
  previous: ConfigSchema,
  next: ConfigSchema,
  path: string,
  issues: ConfigCompatibilityIssue[],
): void {
  validateSchema(previous);
  validateSchema(next);
  if (previous.type !== next.type) {
    issues.push({ path, message: `type changed from ${previous.type} to ${next.type}` });
    return;
  }
  if (previous.type === "object") {
    const previousRequired = new Set(previous.required ?? []);
    const nextRequired = new Set(next.required ?? []);
    for (const key of nextRequired) {
      if (!previousRequired.has(key)) {
        const nextProperty = next.properties?.[key];
        if (nextProperty?.defaultValue === undefined) {
          issues.push({ path: `${path}.${key}`, message: "new required property has no default" });
        }
      }
    }
    for (const [key, previousProperty] of Object.entries(previous.properties ?? {})) {
      const nextProperty = next.properties?.[key];
      if (!nextProperty) continue;
      collectCompatibilityIssues(previousProperty, nextProperty, `${path}.${key}`, issues);
    }
    if (previous.additionalProperties !== false && next.additionalProperties === false) {
      issues.push({ path, message: "additionalProperties became stricter" });
    }
  }
  if (previous.type === "array" && previous.items && next.items) {
    collectCompatibilityIssues(previous.items, next.items, `${path}[]`, issues);
  }
  if (previous.type === "string" || previous.type === "number") {
    if (previous.enum && next.enum) {
      for (const value of previous.enum) {
        if (!next.enum.some((candidate) => deepEqual(candidate, value))) {
          issues.push({ path, message: "enum removed an existing value" });
          break;
        }
      }
    }
  }
}

function matchesType(value: unknown, type: ConfigSchemaType): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainObject(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number";
  return typeof value === "boolean";
}

function isPlainObject(value: unknown): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneSchema(schema: ConfigSchema): ConfigSchema {
  return cloneJson(schema) as ConfigSchema;
}

function cloneRecord(record: ConfigSchemaRecord): ConfigSchemaRecord {
  return { ...record, schema: cloneSchema(record.schema) };
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
