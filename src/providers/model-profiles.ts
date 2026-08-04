import type { ModelProfileConfig, ReasonixConfig } from "../config.js";
import { readConfig, writeConfig } from "../config.js";
import { FLASH_MODEL_ID, PRO_MODEL_ID } from "../models.js";

export const BUILTIN_MODEL_PROFILES: readonly ModelProfileConfig[] = [
  { id: "deepseek-flash", provider: "deepseek", model: FLASH_MODEL_ID },
  { id: "deepseek-pro", provider: "deepseek", model: PRO_MODEL_ID },
];

export function normalizeModelProfile(profile: ModelProfileConfig): ModelProfileConfig {
  const normalized: ModelProfileConfig = {
    id: profile.id.trim(),
    provider: profile.provider,
    model: profile.model.trim(),
    apiKeyEnv: profile.apiKeyEnv?.trim() || undefined,
    baseUrl: profile.baseUrl?.trim().replace(/\/+$/, "") || undefined,
  };
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalized.id)) {
    throw new Error("model profile id must contain only letters, numbers, '.', '_' or '-'");
  }
  if (!normalized.model) throw new Error("model profile model must be non-empty");
  if (normalized.provider !== "deepseek" && normalized.provider !== "openai") {
    throw new Error(`unsupported model provider: ${String(normalized.provider)}`);
  }
  return normalized;
}

/** Built-ins, legacy inline candidates, then top-level profiles (last write wins). */
export function resolveModelProfiles(cfg: ReasonixConfig): ModelProfileConfig[] {
  const byId = new Map<string, ModelProfileConfig>();
  for (const profile of [
    ...BUILTIN_MODEL_PROFILES,
    ...(cfg.experimental?.multiAgent?.candidates ?? []),
    ...(cfg.modelProfiles ?? []),
  ]) {
    const normalized = normalizeModelProfile(profile);
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()];
}

export function configuredModelProfiles(cfg: ReasonixConfig): ModelProfileConfig[] {
  const seen = new Set<string>();
  const profiles: ModelProfileConfig[] = [];
  for (const raw of cfg.modelProfiles ?? []) {
    const profile = normalizeModelProfile(raw);
    if (seen.has(profile.id)) throw new Error(`duplicate model profile id: ${profile.id}`);
    seen.add(profile.id);
    profiles.push(profile);
  }
  return profiles;
}

/** User-defined profiles from the new top-level catalog plus legacy inline candidates. */
export function userModelProfiles(cfg: ReasonixConfig): ModelProfileConfig[] {
  const builtins = new Set(BUILTIN_MODEL_PROFILES.map((profile) => profile.id));
  return resolveModelProfiles(cfg).filter((profile) => !builtins.has(profile.id));
}

export function findModelProfile(cfg: ReasonixConfig, id: string): ModelProfileConfig | undefined {
  const selection = id.trim();
  const profiles = resolveModelProfiles(cfg);
  return (
    profiles.find((profile) => profile.id === selection) ??
    profiles.find((profile) => profile.provider === "deepseek" && profile.model === selection)
  );
}

export function upsertModelProfile(profile: ModelProfileConfig, path?: string): ModelProfileConfig {
  const normalized = normalizeModelProfile(profile);
  const cfg = readConfig(path);
  const profiles = configuredModelProfiles(cfg).filter((item) => item.id !== normalized.id);
  cfg.modelProfiles = [...profiles, normalized];
  const multi = cfg.experimental?.multiAgent;
  if (multi?.candidates?.some((legacy) => legacy.id === normalized.id)) {
    const remaining = multi.candidates.filter((legacy) => legacy.id !== normalized.id);
    multi.candidates = remaining.length > 0 ? remaining : undefined;
  }
  writeConfig(cfg, path);
  return normalized;
}

export function removeModelProfile(id: string, path?: string): boolean {
  const cfg = readConfig(path);
  const profiles = configuredModelProfiles(cfg);
  const next = profiles.filter((profile) => profile.id !== id);
  const legacy = cfg.experimental?.multiAgent?.candidates ?? [];
  const nextLegacy = legacy.filter((profile) => profile.id !== id);
  if (next.length === profiles.length && nextLegacy.length === legacy.length) return false;
  cfg.modelProfiles = next.length > 0 ? next : undefined;
  if (cfg.activeModelProfile === id) cfg.activeModelProfile = undefined;
  const multi = cfg.experimental?.multiAgent;
  if (multi?.candidates) {
    multi.candidates = nextLegacy.length > 0 ? nextLegacy : undefined;
  }
  if (multi?.candidateIds) {
    multi.candidateIds = multi.candidateIds.filter((candidateId) => candidateId !== id);
  }
  writeConfig(cfg, path);
  return true;
}

export function activateModelProfile(id: string, model: string, path?: string): void {
  const cfg = readConfig(path);
  cfg.activeModelProfile = id;
  cfg.model = model.trim() || undefined;
  writeConfig(cfg, path);
}

export function clearActiveModelProfile(path?: string): void {
  const cfg = readConfig(path);
  cfg.activeModelProfile = undefined;
  writeConfig(cfg, path);
}

export function modelProfileKeyEnv(profileId: string): string {
  const suffix = profileId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `CARBONCODE_MODEL_${suffix || "CUSTOM"}_API_KEY`;
}

export function suggestModelProfileId(provider: string, model: string): string {
  const slug = `${provider}-${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "custom-model";
}
