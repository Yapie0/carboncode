export interface TokenBudgetPolicy {
  maxInputTokens: number;
  reservedOutputTokens: number;
  systemTokens?: number;
}

export interface TokenFragment<TMetadata = Record<string, unknown>> {
  id: string;
  tokens: number;
  priority: number;
  content: string;
  metadata?: TMetadata;
}

export interface TokenBudgetPlan<TMetadata = Record<string, unknown>> {
  maxInputTokens: number;
  reservedOutputTokens: number;
  availableInputTokens: number;
  usedInputTokens: number;
  droppedTokens: number;
  selected: TokenFragment<TMetadata>[];
  dropped: TokenFragment<TMetadata>[];
}

export interface TokenUsageRecord {
  id: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAtMs: number;
  metadata?: Record<string, string>;
}

export function createTokenFragment<TMetadata>(input: {
  id: string;
  tokens: number;
  priority?: number;
  content: string;
  metadata?: TMetadata;
}): TokenFragment<TMetadata> {
  assertNonEmpty(input.id, "id");
  assertPositiveInteger(input.tokens, "tokens");
  assertNonEmpty(input.content, "content");
  return {
    id: input.id,
    tokens: input.tokens,
    priority: input.priority ?? 0,
    content: input.content,
    metadata: cloneValue(input.metadata),
  };
}

export function availableInputTokens(policy: TokenBudgetPolicy): number {
  validatePolicy(policy);
  const available =
    policy.maxInputTokens - policy.reservedOutputTokens - (policy.systemTokens ?? 0);
  if (available < 0) throw new Error("reserved tokens exceed maxInputTokens");
  return available;
}

export function planTokenBudget<TMetadata>(
  policy: TokenBudgetPolicy,
  fragments: readonly TokenFragment<TMetadata>[],
): TokenBudgetPlan<TMetadata> {
  const available = availableInputTokens(policy);
  let used = 0;
  const selected: TokenFragment<TMetadata>[] = [];
  const dropped: TokenFragment<TMetadata>[] = [];
  for (const fragment of fragments.slice().sort(compareTokenFragments)) {
    validateFragment(fragment);
    if (used + fragment.tokens <= available) {
      selected.push(cloneTokenFragment(fragment));
      used += fragment.tokens;
    } else {
      dropped.push(cloneTokenFragment(fragment));
    }
  }
  return {
    maxInputTokens: policy.maxInputTokens,
    reservedOutputTokens: policy.reservedOutputTokens,
    availableInputTokens: available,
    usedInputTokens: used,
    droppedTokens: dropped.reduce((sum, fragment) => sum + fragment.tokens, 0),
    selected,
    dropped,
  };
}

export function createTokenUsageRecord(input: {
  id: string;
  promptTokens: number;
  completionTokens: number;
  nowMs: number;
  metadata?: Record<string, string>;
}): TokenUsageRecord {
  assertNonEmpty(input.id, "id");
  assertNonNegativeInteger(input.promptTokens, "promptTokens");
  assertNonNegativeInteger(input.completionTokens, "completionTokens");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    id: input.id,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.promptTokens + input.completionTokens,
    createdAtMs: input.nowMs,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function summarizeTokenUsage(records: readonly TokenUsageRecord[]): {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  return records.reduce(
    (summary, record) => ({
      requests: summary.requests + 1,
      promptTokens: summary.promptTokens + record.promptTokens,
      completionTokens: summary.completionTokens + record.completionTokens,
      totalTokens: summary.totalTokens + record.totalTokens,
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
}

export function cloneTokenFragment<TMetadata>(
  fragment: TokenFragment<TMetadata>,
): TokenFragment<TMetadata> {
  return {
    ...fragment,
    metadata: cloneValue(fragment.metadata),
  };
}

export function cloneTokenUsageRecord(record: TokenUsageRecord): TokenUsageRecord {
  return {
    ...record,
    metadata: record.metadata ? { ...record.metadata } : undefined,
  };
}

function compareTokenFragments<TMetadata>(
  left: TokenFragment<TMetadata>,
  right: TokenFragment<TMetadata>,
): number {
  return (
    right.priority - left.priority || left.tokens - right.tokens || left.id.localeCompare(right.id)
  );
}

function validatePolicy(policy: TokenBudgetPolicy): void {
  assertPositiveInteger(policy.maxInputTokens, "maxInputTokens");
  assertNonNegativeInteger(policy.reservedOutputTokens, "reservedOutputTokens");
  assertNonNegativeInteger(policy.systemTokens ?? 0, "systemTokens");
}

function validateFragment<TMetadata>(fragment: TokenFragment<TMetadata>): void {
  assertNonEmpty(fragment.id, "fragment.id");
  assertPositiveInteger(fragment.tokens, "fragment.tokens");
  assertNonEmpty(fragment.content, "fragment.content");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
