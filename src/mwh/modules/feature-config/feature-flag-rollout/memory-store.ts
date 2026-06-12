import {
  type FeatureFlagConfig,
  type FeatureFlagContext,
  type FeatureFlagEvaluation,
  evaluateFeatureFlagWithPrerequisites,
  mergeFeatureFlag,
} from "./core.js";

export class MemoryFeatureFlagStore {
  private readonly flags = new Map<string, FeatureFlagConfig>();

  upsert(patch: Partial<FeatureFlagConfig> & { key: string }): FeatureFlagConfig {
    const next = mergeFeatureFlag(this.flags.get(patch.key), patch);
    this.flags.set(next.key, next);
    return cloneFlag(next);
  }

  evaluate(key: string, context: FeatureFlagContext): FeatureFlagEvaluation {
    return evaluateFeatureFlagWithPrerequisites(this.flags.get(key), context, (flagKey) =>
      this.flags.get(flagKey),
    );
  }

  get(key: string): FeatureFlagConfig | undefined {
    const flag = this.flags.get(key);
    return flag ? cloneFlag(flag) : undefined;
  }

  delete(key: string): boolean {
    return this.flags.delete(key);
  }

  list(): FeatureFlagConfig[] {
    return [...this.flags.values()].map(cloneFlag);
  }
}

function cloneFlag(flag: FeatureFlagConfig): FeatureFlagConfig {
  return {
    ...flag,
    allowSubjects: flag.allowSubjects ? [...flag.allowSubjects] : undefined,
    denySubjects: flag.denySubjects ? [...flag.denySubjects] : undefined,
    prerequisites: flag.prerequisites
      ? flag.prerequisites.map((prerequisite) => ({ ...prerequisite }))
      : undefined,
    rules: flag.rules
      ? flag.rules.map((rule) => ({ ...rule, values: [...rule.values] }))
      : undefined,
  };
}
