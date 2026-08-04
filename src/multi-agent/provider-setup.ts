import { type ModelProfileConfig, readConfig } from "../config.js";
import { saveProviderApiKey } from "../providers/credentials.js";
import {
  modelProfileKeyEnv,
  suggestModelProfileId,
  upsertModelProfile,
  userModelProfiles,
} from "../providers/model-profiles.js";
import { DEFAULT_MULTI_AGENT_CANDIDATES } from "../providers/registry.js";
import { setOpenAIKeyForSession } from "./openai-key.js";

export const OPENAI_RELAY_CANDIDATE_ID = "openai-relay";
export const OPENAI_RELAY_KEY_ENV = "CARBONCODE_OPENAI_RELAY_KEY";

export type OpenAIProviderSetup =
  | { kind: "official"; model?: string; profileId?: string }
  | { kind: "relay"; baseUrl: string; model: string; profileId?: string };

export type OpenAIProviderSetupResult =
  | {
      ok: true;
      profileId: string;
      /** Backward-compatible name used by the first multi-agent implementation. */
      candidateId: string;
      modelCount: number;
      syncedProfileIds: string[];
      baseUrl?: string;
      model: string;
    }
  | { ok: false; error: string };

export function normalizeRelayBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL 无效，请填写完整的 http:// 或 https:// 地址。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL 只支持 http:// 或 https://。");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function profileIdFor(setup: OpenAIProviderSetup, model: string): string {
  return (
    setup.profileId?.trim() ||
    (setup.kind === "relay" ? OPENAI_RELAY_CANDIDATE_ID : suggestModelProfileId("openai", model))
  );
}

function syncDiscoveredRelayProfiles(
  modelIds: readonly string[],
  baseUrl: string,
  apiKeyEnv: string,
  configPath?: string,
): string[] {
  if (modelIds.length === 0) return [];
  const availableModels = new Set(modelIds);
  const configured = userModelProfiles(readConfig(configPath));
  const byId = new Map<string, ModelProfileConfig>();
  for (const profile of DEFAULT_MULTI_AGENT_CANDIDATES) byId.set(profile.id, profile);
  for (const profile of configured) byId.set(profile.id, profile);

  const synced: string[] = [];
  for (const profile of byId.values()) {
    if (
      profile.provider !== "openai" ||
      profile.baseUrl ||
      profile.apiKeyEnv ||
      !availableModels.has(profile.model)
    ) {
      continue;
    }
    upsertModelProfile({ ...profile, baseUrl, apiKeyEnv }, configPath);
    synced.push(profile.id);
  }
  return synced;
}

export async function configureOpenAIProvider(
  key: string,
  setup: OpenAIProviderSetup,
  options: { configPath?: string; fetch?: typeof fetch } = {},
): Promise<OpenAIProviderSetupResult> {
  const model = setup.model?.trim() || "gpt-5.5";
  const profileId = profileIdFor(setup, model);
  if (setup.kind === "official") {
    const result = await setOpenAIKeyForSession(key, { fetch: options.fetch });
    if (!result.ok) return result;
    saveProviderApiKey("OPENAI_API_KEY", key, options.configPath);
    upsertModelProfile(
      { id: profileId, provider: "openai", model, apiKeyEnv: "OPENAI_API_KEY" },
      options.configPath,
    );
    return {
      ok: true,
      profileId,
      candidateId: profileId,
      modelCount: result.modelCount,
      syncedProfileIds: [],
      model,
    };
  }

  let baseUrl: string;
  try {
    baseUrl = normalizeRelayBaseUrl(setup.baseUrl);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!model) return { ok: false, error: "模型 ID 不能为空。" };

  const envName =
    userModelProfiles(readConfig(options.configPath)).find(
      (profile) => profile.provider === "openai" && profile.baseUrl === baseUrl,
    )?.apiKeyEnv ??
    (profileId === OPENAI_RELAY_CANDIDATE_ID
      ? OPENAI_RELAY_KEY_ENV
      : modelProfileKeyEnv(profileId));

  const result = await setOpenAIKeyForSession(key, {
    fetch: options.fetch,
    baseUrl,
    envName,
    validationModel: model,
  });
  if (!result.ok) return result;
  saveProviderApiKey(envName, key, options.configPath);

  const profile: ModelProfileConfig = {
    id: profileId,
    provider: "openai",
    model,
    baseUrl,
    apiKeyEnv: envName,
  };
  upsertModelProfile(profile, options.configPath);
  const syncedProfileIds = syncDiscoveredRelayProfiles(
    result.modelIds,
    baseUrl,
    envName,
    options.configPath,
  ).filter((id) => id !== profileId);
  return {
    ok: true,
    profileId,
    candidateId: profileId,
    modelCount: result.modelCount,
    syncedProfileIds,
    baseUrl,
    model,
  };
}

/** @deprecated Use configureOpenAIProvider; kept for the first experimental API. */
export const configureOpenAIProviderForSession = configureOpenAIProvider;
