import { readFileSync } from "node:fs";
import {
  type ModelProviderKind,
  type ProviderReasoningEffortMax,
  type ProviderWireApi,
  type ReasonixConfig,
  defaultConfigPath,
  loadActiveModelProvider,
} from "./config.js";

export interface RuntimeConnectionConfig {
  apiKey?: string;
  baseUrl?: string;
  providerName?: string;
  providerKind?: ModelProviderKind;
  reasoningEffortMax?: ProviderReasoningEffortMax;
  wireApi?: ProviderWireApi;
}

function readConfigStrict(path: string): ReasonixConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as ReasonixConfig) : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    return null;
  }
}

/** Re-read connection settings while preserving genuine environment overrides.
 * Matching env/file values are the CLI's config bridge; distinct env values stay pinned. */
export class RuntimeConnectionConfigSource {
  private readonly apiKeyPinnedByEnv: boolean;
  private readonly baseUrlPinnedByEnv: boolean;

  constructor(
    private readonly path = defaultConfigPath(),
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    const initial = readConfigStrict(path) ?? {};
    this.apiKeyPinnedByEnv = Boolean(
      env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY !== initial.apiKey,
    );
    this.baseUrlPinnedByEnv = Boolean(
      env.DEEPSEEK_BASE_URL && env.DEEPSEEK_BASE_URL !== initial.baseUrl,
    );
  }

  read(): RuntimeConnectionConfig | null {
    const config = readConfigStrict(this.path);
    if (!config) return null;
    const providerEnv = { ...this.env };
    if (!this.apiKeyPinnedByEnv) providerEnv.DEEPSEEK_API_KEY = undefined;
    if (!this.baseUrlPinnedByEnv) providerEnv.DEEPSEEK_BASE_URL = undefined;
    const provider = loadActiveModelProvider(this.path, providerEnv);
    return {
      apiKey: this.apiKeyPinnedByEnv ? this.env.DEEPSEEK_API_KEY : provider.apiKey,
      baseUrl: this.baseUrlPinnedByEnv ? this.env.DEEPSEEK_BASE_URL : provider.baseUrl,
      providerName: provider.name,
      providerKind: provider.kind,
      reasoningEffortMax: provider.reasoningEffortMax,
      wireApi: provider.wireApi,
    };
  }
}

export function sameRuntimeConnectionConfig(
  left: RuntimeConnectionConfig,
  right: RuntimeConnectionConfig,
): boolean {
  return (
    left.apiKey === right.apiKey &&
    left.baseUrl === right.baseUrl &&
    left.providerName === right.providerName &&
    left.providerKind === right.providerKind &&
    left.reasoningEffortMax === right.reasoningEffortMax &&
    left.wireApi === right.wireApi
  );
}
