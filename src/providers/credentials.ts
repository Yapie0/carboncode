import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultConfigPath } from "../config.js";

interface ProviderCredentialStore {
  version: 1;
  apiKeys: Record<string, string>;
}

const EMPTY_STORE: ProviderCredentialStore = { version: 1, apiKeys: {} };
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function defaultProviderCredentialsPath(configPath = defaultConfigPath()): string {
  return join(dirname(configPath), "credentials.json");
}

function normalizeEnvName(raw: string): string {
  const envName = raw.trim();
  if (!ENV_NAME_RE.test(envName)) throw new Error(`invalid credential environment name: ${raw}`);
  return envName;
}

function readStore(configPath?: string): ProviderCredentialStore {
  try {
    const raw = readFileSync(defaultProviderCredentialsPath(configPath), "utf8");
    const parsed = JSON.parse(raw) as Partial<ProviderCredentialStore>;
    if (parsed.version !== 1 || !parsed.apiKeys || typeof parsed.apiKeys !== "object") {
      return EMPTY_STORE;
    }
    const apiKeys: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.apiKeys)) {
      if (ENV_NAME_RE.test(name) && typeof value === "string" && value.trim()) {
        apiKeys[name] = value.trim();
      }
    }
    return { version: 1, apiKeys };
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(store: ProviderCredentialStore, configPath?: string): void {
  const path = defaultProviderCredentialsPath(configPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows applies the current user's profile ACL; chmod may be unavailable.
  }
}

/** Save a validated provider key outside config.json and project/session data. */
export function saveProviderApiKey(envName: string, rawKey: string, configPath?: string): void {
  const name = normalizeEnvName(envName);
  const key = rawKey.trim();
  if (!key) throw new Error("provider API key must be non-empty");
  const store = readStore(configPath);
  writeStore({ version: 1, apiKeys: { ...store.apiKeys, [name]: key } }, configPath);
}

/** Populate only missing process variables so explicit shell/.env values keep precedence. */
export function hydrateProviderApiKeys(
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const hydrated: string[] = [];
  for (const [name, key] of Object.entries(readStore(configPath).apiKeys)) {
    if (env[name]?.trim()) continue;
    env[name] = key;
    hydrated.push(name);
  }
  return hydrated;
}

/** Test/diagnostic seam that reports presence without exposing secret values. */
export function hasStoredProviderApiKey(envName: string, configPath?: string): boolean {
  const name = normalizeEnvName(envName);
  return Boolean(readStore(configPath).apiKeys[name]);
}
