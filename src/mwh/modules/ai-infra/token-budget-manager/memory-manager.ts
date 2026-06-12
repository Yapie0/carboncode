import {
  type TokenBudgetPlan,
  type TokenBudgetPolicy,
  type TokenFragment,
  type TokenUsageRecord,
  cloneTokenFragment,
  cloneTokenUsageRecord,
  createTokenFragment,
  createTokenUsageRecord,
  planTokenBudget,
  summarizeTokenUsage,
} from "./core.js";

export class MemoryTokenBudgetManager<TMetadata = Record<string, unknown>> {
  private readonly now: () => number;
  private policy: TokenBudgetPolicy;
  private readonly fragments = new Map<string, TokenFragment<TMetadata>>();
  private readonly usage: TokenUsageRecord[] = [];

  constructor(input: { policy: TokenBudgetPolicy; now?: () => number }) {
    this.policy = { ...input.policy };
    this.now = input.now ?? Date.now;
  }

  setPolicy(policy: TokenBudgetPolicy): TokenBudgetPolicy {
    planTokenBudget(policy, []);
    this.policy = { ...policy };
    return { ...this.policy };
  }

  upsertFragment(input: {
    id: string;
    tokens: number;
    priority?: number;
    content: string;
    metadata?: TMetadata;
  }): TokenFragment<TMetadata> {
    const fragment = createTokenFragment(input);
    this.fragments.set(fragment.id, fragment);
    return cloneTokenFragment(fragment);
  }

  removeFragment(id: string): boolean {
    return this.fragments.delete(id);
  }

  plan(): TokenBudgetPlan<TMetadata> {
    return planTokenBudget(this.policy, [...this.fragments.values()]);
  }

  recordUsage(input: {
    id: string;
    promptTokens: number;
    completionTokens: number;
    metadata?: Record<string, string>;
  }): TokenUsageRecord {
    const record = createTokenUsageRecord({ ...input, nowMs: this.now() });
    this.usage.push(record);
    return cloneTokenUsageRecord(record);
  }

  usageSummary(): ReturnType<typeof summarizeTokenUsage> {
    return summarizeTokenUsage(this.usage);
  }

  listFragments(): TokenFragment<TMetadata>[] {
    return [...this.fragments.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneTokenFragment);
  }

  audit(): TokenUsageRecord[] {
    return this.usage.map(cloneTokenUsageRecord);
  }
}
