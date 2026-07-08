import { readFileSync } from "node:fs";
import { type ReasonixConfig, defaultConfigPath, resolveChatProviderConfig } from "./config.js";

export interface RuntimeConnectionConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
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
    const initialProvider = initial ? resolveChatProviderConfig(path) : { id: "deepseek" };
    this.apiKeyPinnedByEnv = Boolean(
      env.DEEPSEEK_API_KEY && env.DEEPSEEK_API_KEY !== initialProvider.apiKey,
    );
    this.baseUrlPinnedByEnv = Boolean(
      env.DEEPSEEK_BASE_URL && env.DEEPSEEK_BASE_URL !== initialProvider.baseUrl,
    );
  }

  read(): RuntimeConnectionConfig | null {
    const config = readConfigStrict(this.path);
    if (!config) return null;
    const provider = resolveChatProviderConfig(this.path);
    return {
      providerId: provider.id,
      apiKey: this.apiKeyPinnedByEnv ? this.env.DEEPSEEK_API_KEY : provider.apiKey,
      baseUrl: this.baseUrlPinnedByEnv ? this.env.DEEPSEEK_BASE_URL : provider.baseUrl,
      model: provider.model,
    };
  }
}

export function sameRuntimeConnectionConfig(
  left: RuntimeConnectionConfig,
  right: RuntimeConnectionConfig,
): boolean {
  return (
    left.providerId === right.providerId &&
    left.apiKey === right.apiKey &&
    left.baseUrl === right.baseUrl &&
    left.model === right.model
  );
}
