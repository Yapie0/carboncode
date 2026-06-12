import { createHash } from "node:crypto";

export type FeatureFlagDecisionReason =
  | "missing"
  | "disabled"
  | "prerequisite-failed"
  | "deny-override"
  | "allow-override"
  | "rule-match"
  | "percentage"
  | "default";

export interface FeatureFlagContext {
  subjectKey: string;
  attributes?: Record<string, string | number | boolean | undefined>;
}

export interface FeatureFlagRule {
  id: string;
  attribute: string;
  operator: "equals" | "in" | "not-in";
  values: readonly string[];
  enabled: boolean;
}

export interface FeatureFlagConfig {
  key: string;
  enabled: boolean;
  defaultValue: boolean;
  rolloutPercentage?: number;
  salt?: string;
  allowSubjects?: readonly string[];
  denySubjects?: readonly string[];
  prerequisites?: readonly FeatureFlagPrerequisite[];
  rules?: readonly FeatureFlagRule[];
}

export interface FeatureFlagPrerequisite {
  key: string;
  expected: boolean;
}

export interface FeatureFlagEvaluation {
  enabled: boolean;
  reason: FeatureFlagDecisionReason;
  prerequisiteKey?: string;
  ruleId?: string;
  bucket?: number;
}

export function evaluateFeatureFlag(
  config: FeatureFlagConfig | undefined,
  context: FeatureFlagContext,
): FeatureFlagEvaluation {
  assertNonEmpty(context.subjectKey, "subjectKey");
  if (!config) return { enabled: false, reason: "missing" };
  validateConfig(config);

  if (!config.enabled) return { enabled: false, reason: "disabled" };
  if (config.denySubjects?.includes(context.subjectKey)) {
    return { enabled: false, reason: "deny-override" };
  }
  if (config.allowSubjects?.includes(context.subjectKey)) {
    return { enabled: true, reason: "allow-override" };
  }

  for (const rule of config.rules ?? []) {
    if (matchesRule(rule, context)) {
      return { enabled: rule.enabled, reason: "rule-match", ruleId: rule.id };
    }
  }

  if (config.rolloutPercentage !== undefined) {
    const bucket = stableBucket({
      flagKey: config.key,
      subjectKey: context.subjectKey,
      salt: config.salt,
    });
    return {
      enabled: bucket < config.rolloutPercentage * 100,
      reason: "percentage",
      bucket,
    };
  }

  return { enabled: config.defaultValue, reason: "default" };
}

export function evaluateFeatureFlagWithPrerequisites(
  config: FeatureFlagConfig | undefined,
  context: FeatureFlagContext,
  lookup: (key: string) => FeatureFlagConfig | undefined,
  path: readonly string[] = [],
): FeatureFlagEvaluation {
  assertNonEmpty(context.subjectKey, "subjectKey");
  if (!config) return { enabled: false, reason: "missing" };
  validateConfig(config);
  if (path.includes(config.key))
    throw new Error(`feature flag prerequisite cycle: ${[...path, config.key].join(" -> ")}`);
  for (const prerequisite of config.prerequisites ?? []) {
    assertNonEmpty(prerequisite.key, "prerequisite.key");
    const evaluation = evaluateFeatureFlagWithPrerequisites(
      lookup(prerequisite.key),
      context,
      lookup,
      [...path, config.key],
    );
    if (evaluation.enabled !== prerequisite.expected) {
      return {
        enabled: false,
        reason: "prerequisite-failed",
        prerequisiteKey: prerequisite.key,
      };
    }
  }
  return evaluateFeatureFlag(config, context);
}

export function stableBucket(input: {
  flagKey: string;
  subjectKey: string;
  salt?: string;
}): number {
  assertNonEmpty(input.flagKey, "flagKey");
  assertNonEmpty(input.subjectKey, "subjectKey");
  const hash = createHash("sha256")
    .update(`${input.salt ?? ""}:${input.flagKey}:${input.subjectKey}`, "utf8")
    .digest("hex");
  return Number.parseInt(hash.slice(0, 8), 16) % 10_000;
}

export function matchesRule(rule: FeatureFlagRule, context: FeatureFlagContext): boolean {
  assertNonEmpty(rule.id, "rule.id");
  assertNonEmpty(rule.attribute, "rule.attribute");
  if (!rule.values.length) throw new Error("rule.values is required");
  const rawValue = context.attributes?.[rule.attribute];
  if (rawValue === undefined) return false;
  const value = String(rawValue);
  if (rule.operator === "equals") return value === rule.values[0];
  if (rule.operator === "in") return rule.values.includes(value);
  return !rule.values.includes(value);
}

export function mergeFeatureFlag(
  current: FeatureFlagConfig | undefined,
  patch: Partial<FeatureFlagConfig> & { key: string },
): FeatureFlagConfig {
  const next: FeatureFlagConfig = {
    key: patch.key,
    enabled: patch.enabled ?? current?.enabled ?? true,
    defaultValue: patch.defaultValue ?? current?.defaultValue ?? false,
    rolloutPercentage: patch.rolloutPercentage ?? current?.rolloutPercentage,
    salt: patch.salt ?? current?.salt,
    allowSubjects: patch.allowSubjects ?? current?.allowSubjects,
    denySubjects: patch.denySubjects ?? current?.denySubjects,
    prerequisites: patch.prerequisites ?? current?.prerequisites,
    rules: patch.rules ?? current?.rules,
  };
  validateConfig(next);
  return next;
}

function validateConfig(config: FeatureFlagConfig): void {
  assertNonEmpty(config.key, "key");
  if (config.rolloutPercentage !== undefined) {
    if (
      !Number.isFinite(config.rolloutPercentage) ||
      config.rolloutPercentage < 0 ||
      config.rolloutPercentage > 100
    ) {
      throw new Error("rolloutPercentage must be between 0 and 100");
    }
  }
  for (const prerequisite of config.prerequisites ?? []) {
    assertNonEmpty(prerequisite.key, "prerequisite.key");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
