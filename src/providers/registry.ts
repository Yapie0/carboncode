import { type ChatProviderClient, DeepSeekClient } from "../client.js";
import type {
  ModelProfileConfig,
  MultiAgentCandidateConfig,
  MultiAgentExperimentalConfig,
  ReasonixConfig,
} from "../config.js";
import { FLASH_MODEL_ID, PRO_MODEL_ID } from "../models.js";
import { resolveModelProfiles } from "./model-profiles.js";
import { OpenAIResponsesClient } from "./openai-responses.js";

export const DEFAULT_MULTI_AGENT_CANDIDATES: readonly MultiAgentCandidateConfig[] = [
  { id: "deepseek-flash", provider: "deepseek", model: FLASH_MODEL_ID },
  { id: "deepseek-pro", provider: "deepseek", model: PRO_MODEL_ID },
  { id: "openai-sol", provider: "openai", model: "gpt-5.6-sol" },
  { id: "openai-terra", provider: "openai", model: "gpt-5.6-terra" },
  { id: "openai-luna", provider: "openai", model: "gpt-5.6-luna" },
];

export interface CandidateAvailability {
  candidate: MultiAgentCandidateConfig;
  available: boolean;
  keySource: string;
}

export function resolveMultiAgentConfig(cfg: ReasonixConfig): MultiAgentExperimentalConfig {
  return cfg.experimental?.multiAgent ?? {};
}

export function resolveMultiAgentCandidates(cfg: ReasonixConfig): MultiAgentCandidateConfig[] {
  const multi = resolveMultiAgentConfig(cfg);
  const shared = resolveModelProfiles(cfg);
  const sharedById = new Map(shared.map((profile) => [profile.id, profile]));
  let candidates: readonly ModelProfileConfig[];
  if (multi.candidateIds?.length) {
    candidates = multi.candidateIds.map((id) => {
      const profile = sharedById.get(id);
      if (!profile) throw new Error(`unknown multi-agent model profile: ${id}`);
      return profile;
    });
  } else if (multi.candidates?.length) {
    const legacyIds = new Set(multi.candidates.map((legacy) => legacy.id));
    candidates = [
      ...multi.candidates.map((legacy) => sharedById.get(legacy.id) ?? legacy),
      ...shared.filter(
        (profile) =>
          cfg.modelProfiles?.some((configured) => configured.id === profile.id) &&
          !legacyIds.has(profile.id),
      ),
    ];
  } else if (cfg.modelProfiles?.length) {
    candidates = shared;
  } else {
    candidates = DEFAULT_MULTI_AGENT_CANDIDATES;
  }
  const seen = new Set<string>();
  return candidates.map((candidate) => {
    const normalized = {
      ...candidate,
      id: candidate.id.trim(),
      model: candidate.model.trim(),
      apiKeyEnv: candidate.apiKeyEnv?.trim() || undefined,
      baseUrl: candidate.baseUrl?.trim() || undefined,
    };
    if (!normalized.id || !normalized.model) {
      throw new Error("multi-agent candidate id and model must be non-empty");
    }
    if (seen.has(normalized.id)) {
      throw new Error(`duplicate multi-agent candidate id: ${normalized.id}`);
    }
    seen.add(normalized.id);
    return normalized;
  });
}

function keyEnvName(candidate: MultiAgentCandidateConfig): string {
  return (
    candidate.apiKeyEnv ?? (candidate.provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY")
  );
}

function resolveApiKey(
  candidate: MultiAgentCandidateConfig,
  cfg: ReasonixConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const fromEnv = env[keyEnvName(candidate)]?.trim();
  if (fromEnv) return fromEnv;
  if (candidate.provider === "deepseek" && !candidate.apiKeyEnv) return cfg.apiKey?.trim();
  return undefined;
}

export function candidateAvailability(
  candidate: MultiAgentCandidateConfig,
  cfg: ReasonixConfig,
  env: NodeJS.ProcessEnv = process.env,
): CandidateAvailability {
  const envName = keyEnvName(candidate);
  const configFallback = candidate.provider === "deepseek" && !candidate.apiKeyEnv;
  return {
    candidate,
    available: Boolean(resolveApiKey(candidate, cfg, env)),
    keySource: configFallback ? `${envName} or ~/.carboncode/config.json` : envName,
  };
}

export function createProviderClient(
  candidate: MultiAgentCandidateConfig,
  cfg: ReasonixConfig,
  env: NodeJS.ProcessEnv = process.env,
): ChatProviderClient {
  const apiKey = resolveApiKey(candidate, cfg, env);
  if (!apiKey) {
    throw new Error(
      `missing API key for ${candidate.id}; set ${keyEnvName(candidate)} before using this candidate`,
    );
  }
  if (candidate.provider === "openai") {
    return new OpenAIResponsesClient({ apiKey, baseUrl: candidate.baseUrl });
  }
  return new DeepSeekClient({
    apiKey,
    baseUrl: candidate.baseUrl ?? cfg.baseUrl,
  });
}
