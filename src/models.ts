export type ThinkingPreference = "auto" | "enabled" | "disabled";
export type EffectiveThinkingMode = Exclude<ThinkingPreference, "auto">;

export interface ModelPricing {
  inputCacheHit: number;
  inputCacheMiss: number;
  output: number;
}

export interface ModelCapabilities {
  id: string;
  contextTokens: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  defaultThinking: EffectiveThinkingMode;
  supportsThinkingToggle: boolean;
  reasoningEfforts: readonly ("high" | "max")[];
  selectable: boolean;
  retired?: boolean;
  replacement?: {
    model: string;
    thinking: EffectiveThinkingMode;
  };
}

export const FLASH_MODEL_ID = "deepseek-v4-flash";
export const PRO_MODEL_ID = "deepseek-v4-pro";
export const SUMMARY_MODEL_ID = FLASH_MODEL_ID;
export const ESCALATION_MODEL_ID = PRO_MODEL_ID;
export const DEFAULT_CONTEXT_TOKENS = 131_072;
export const DEEPSEEK_MAX_TOOLS = 128;

const FLASH_PRICING: ModelPricing = {
  inputCacheHit: 0.0028,
  inputCacheMiss: 0.14,
  output: 0.28,
};

const PRO_PRICING: ModelPricing = {
  inputCacheHit: 0.003625,
  inputCacheMiss: 0.435,
  output: 0.87,
};

export const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  [FLASH_MODEL_ID]: {
    id: FLASH_MODEL_ID,
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: FLASH_PRICING,
    defaultThinking: "enabled",
    supportsThinkingToggle: true,
    reasoningEfforts: ["high", "max"],
    selectable: true,
  },
  [PRO_MODEL_ID]: {
    id: PRO_MODEL_ID,
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: PRO_PRICING,
    defaultThinking: "enabled",
    supportsThinkingToggle: true,
    reasoningEfforts: ["high", "max"],
    selectable: true,
  },
  "deepseek-chat": {
    id: "deepseek-chat",
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: FLASH_PRICING,
    defaultThinking: "disabled",
    supportsThinkingToggle: false,
    reasoningEfforts: ["high", "max"],
    selectable: false,
    retired: true,
    replacement: { model: FLASH_MODEL_ID, thinking: "disabled" },
  },
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    contextTokens: 1_000_000,
    maxOutputTokens: 384_000,
    pricing: FLASH_PRICING,
    defaultThinking: "enabled",
    supportsThinkingToggle: false,
    reasoningEfforts: ["high", "max"],
    selectable: false,
    retired: true,
    replacement: { model: FLASH_MODEL_ID, thinking: "enabled" },
  },
};

export const SELECTABLE_MODEL_IDS = Object.freeze(
  Object.values(MODEL_CAPABILITIES)
    .filter((model) => model.selectable)
    .map((model) => model.id),
);

export function modelCapabilities(model: string): ModelCapabilities | undefined {
  return MODEL_CAPABILITIES[model];
}

export function contextTokensForModel(model: string): number | undefined {
  return modelCapabilities(model)?.contextTokens;
}

export function maxOutputTokensForModel(model: string): number | undefined {
  return modelCapabilities(model)?.maxOutputTokens;
}

export function toolResultBudgetForModel(model: string): number {
  const contextTokens = contextTokensForModel(model);
  if (!contextTokens) return 8_000;
  return Math.max(8_000, Math.min(32_000, Math.floor(contextTokens * 0.02)));
}

export function defaultThinkingForModel(model: string): EffectiveThinkingMode | undefined {
  return modelCapabilities(model)?.defaultThinking;
}

export function resolveThinkingPreference(
  model: string,
  preference: ThinkingPreference = "auto",
): EffectiveThinkingMode | undefined {
  if (preference !== "auto") return preference;
  return defaultThinkingForModel(model);
}

export function migrateRetiredModel(model: string): {
  model: string;
  thinking?: EffectiveThinkingMode;
  migrated: boolean;
} {
  const replacement = modelCapabilities(model)?.replacement;
  if (!replacement) return { model, migrated: false };
  return { ...replacement, migrated: true };
}
