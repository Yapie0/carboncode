import type { DeepSeekClientOptions } from "./client.js";
import { type ActiveModelProvider, defaultConfigPath, loadActiveModelProvider } from "./config.js";
import { DEEPSEEK_MAX_TOOLS } from "./models.js";

/** Convert a persisted provider into the complete runtime client contract. */
export function providerClientOptions(
  provider: ActiveModelProvider,
  overrides: DeepSeekClientOptions = {},
): DeepSeekClientOptions {
  const isDeepSeek = provider.kind === "deepseek";
  return {
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerName: provider.name,
    reasoningEffortMax: provider.reasoningEffortMax,
    wireApi: provider.wireApi,
    maxTools: isDeepSeek ? DEEPSEEK_MAX_TOOLS : null,
    sendThinking: isDeepSeek,
    ...overrides,
  };
}

/** Load the selected provider once and produce options for every CLI entry point. */
export function activeProviderClientOptions(
  overrides: DeepSeekClientOptions = {},
  configPath: string = defaultConfigPath(),
): DeepSeekClientOptions {
  return providerClientOptions(loadActiveModelProvider(configPath), overrides);
}
