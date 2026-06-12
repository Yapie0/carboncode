import { describe, expect, it } from "vitest";
import {
  type ConfigSchema,
  checkConfigSchemaCompatibility,
  configSchemaSnapshot,
  createConfigSchemaRecord,
  publishConfigSchemaRecord,
  updateConfigSchemaRecord,
  validateConfigSamples,
  validateConfigValue,
} from "../src/mwh/modules/feature-config/config-schema-validator/core.js";
import { MemoryConfigSchemaRegistry } from "../src/mwh/modules/feature-config/config-schema-validator/memory-registry.js";

const checkoutSchema: ConfigSchema = {
  type: "object",
  required: ["enabled", "mode"],
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    mode: { type: "string", enum: ["test", "live"] },
    maxItems: { type: "number", min: 1, max: 50, defaultValue: 10 },
    emailPattern: { type: "string", pattern: "^.+@.+$" },
    tags: { type: "array", items: { type: "string" } },
  },
};

describe("config-schema-validator MWH module", () => {
  it("validates objects with defaults, enum, arrays, patterns, and additional property rejection", () => {
    const result = validateConfigValue(
      {
        enabled: true,
        mode: "live",
        emailPattern: "ops@example.com",
        tags: ["a", "b"],
      },
      checkoutSchema,
    );

    expect(result).toEqual({
      valid: true,
      value: {
        enabled: true,
        mode: "live",
        maxItems: 10,
        emailPattern: "ops@example.com",
        tags: ["a", "b"],
      },
      issues: [],
    });

    const invalid = validateConfigValue(
      {
        enabled: "yes",
        mode: "prod",
        maxItems: 99,
        emailPattern: "not-email",
        extra: true,
        tags: ["ok", 1],
      },
      checkoutSchema,
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.issues).toEqual([
      { path: "$.enabled", message: "expected boolean" },
      { path: "$.mode", message: "value is not in enum" },
      { path: "$.maxItems", message: "number above max" },
      { path: "$.emailPattern", message: "string does not match pattern" },
      { path: "$.tags.1", message: "expected string" },
      { path: "$.extra", message: "additional property is not allowed" },
    ]);
  });

  it("creates, updates, publishes, and snapshots schema records", () => {
    let record = createConfigSchemaRecord({
      key: "checkout",
      schema: checkoutSchema,
      nowMs: 1000,
    });
    expect(record.version).toBe(1);
    expect(record.status).toBe("draft");

    record = updateConfigSchemaRecord(record, {
      schema: { ...checkoutSchema, required: ["enabled"] },
      nowMs: 1010,
    });
    expect(record.version).toBe(2);
    expect(record.status).toBe("draft");

    expect(() =>
      publishConfigSchemaRecord(record, {
        nowMs: 1020,
        sampleValue: { enabled: "bad" },
      }),
    ).toThrow("sample config invalid");

    const published = publishConfigSchemaRecord(record, {
      nowMs: 1030,
      sampleValue: { enabled: true },
    });
    expect(published.status).toBe("published");
    expect(configSchemaSnapshot([published])).toEqual({ total: 1, published: 1, draft: 0 });
  });

  it("checks backward compatibility and validates named sample sets", () => {
    const compatibleNext: ConfigSchema = {
      ...checkoutSchema,
      required: ["enabled", "mode", "region"],
      properties: {
        ...checkoutSchema.properties,
        region: { type: "string", defaultValue: "us" },
      },
    };
    const incompatibleNext: ConfigSchema = {
      ...checkoutSchema,
      required: ["enabled", "mode", "currency"],
      properties: {
        ...checkoutSchema.properties,
        currency: { type: "string" },
      },
    };

    expect(checkConfigSchemaCompatibility(checkoutSchema, compatibleNext)).toEqual({
      compatible: true,
      issues: [],
    });
    expect(checkConfigSchemaCompatibility(checkoutSchema, incompatibleNext)).toEqual({
      compatible: false,
      issues: [{ path: "$.currency", message: "new required property has no default" }],
    });
    expect(
      validateConfigSamples(checkoutSchema, [
        { name: "live", value: { enabled: true, mode: "live" } },
        { name: "bad", value: { enabled: true, mode: "prod" } },
      ]).map((sample) => ({ name: sample.name, valid: sample.result.valid })),
    ).toEqual([
      { name: "live", valid: true },
      { name: "bad", valid: false },
    ]);
  });

  it("runs a clone-safe memory registry with publish-gated validation", () => {
    let now = 1000;
    const registry = new MemoryConfigSchemaRegistry({ now: () => now });

    registry.create({ key: "checkout", schema: checkoutSchema });
    expect(() => registry.create({ key: "checkout", schema: checkoutSchema })).toThrow(
      "config schema already exists",
    );
    expect(() => registry.validate("checkout", { enabled: true, mode: "live" })).toThrow(
      "config schema is not published",
    );
    expect(registry.validateDraft("checkout", { enabled: true, mode: "live" })).toMatchObject({
      valid: true,
    });

    const leaked = registry.list();
    leaked[0]!.schema.required = [];

    now = 1010;
    registry.publish("checkout", { enabled: true, mode: "live" });
    expect(registry.validate("checkout", { enabled: true, mode: "live" })).toMatchObject({
      valid: true,
    });
    expect(registry.list()[0]!.schema.required).toEqual(["enabled", "mode"]);
    expect(registry.snapshot()).toEqual({ total: 1, published: 1, draft: 0 });
  });

  it("increments registry versions and rejects missing schemas", () => {
    const registry = new MemoryConfigSchemaRegistry({ now: () => 1000 });
    registry.create({ key: "checkout", schema: checkoutSchema });
    const updated = registry.update("checkout", {
      ...checkoutSchema,
      properties: { enabled: { type: "boolean" } },
      required: ["enabled"],
    });

    expect(updated.version).toBe(2);
    expect(updated.status).toBe("draft");
    expect(() => registry.publish("missing", {})).toThrow("config schema not found");
  });

  it("runs stateful compatibility checks and sample validation", () => {
    const registry = new MemoryConfigSchemaRegistry({ now: () => 1000 });
    registry.create({ key: "checkout", schema: checkoutSchema });

    const incompatible: ConfigSchema = {
      ...checkoutSchema,
      required: ["enabled", "mode", "currency"],
      properties: { ...checkoutSchema.properties, currency: { type: "string" } },
    };
    expect(registry.compatibility("checkout", incompatible)).toEqual({
      compatible: false,
      issues: [{ path: "$.currency", message: "new required property has no default" }],
    });
    expect(() => registry.update("checkout", incompatible, { requireCompatible: true })).toThrow(
      "config schema is not backward compatible",
    );
    expect(
      registry.validateSamples("checkout", [
        { name: "ok", value: { enabled: true, mode: "live" } },
      ]),
    ).toEqual([
      expect.objectContaining({ name: "ok", result: expect.objectContaining({ valid: true }) }),
    ]);
  });
});
