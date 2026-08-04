import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultProviderCredentialsPath,
  hasStoredProviderApiKey,
  hydrateProviderApiKeys,
  saveProviderApiKey,
} from "../src/providers/credentials.js";

describe("provider credential store", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "carbon-provider-credentials-"));
    configPath = join(tmp, "config.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("stores keys beside user config without writing them into config.json", () => {
    writeFileSync(configPath, '{"modelProfiles":[]}\n', "utf8");
    saveProviderApiKey("CARBONCODE_MODEL_COMPANY_API_KEY", "sk-secret-value", configPath);

    expect(hasStoredProviderApiKey("CARBONCODE_MODEL_COMPANY_API_KEY", configPath)).toBe(true);
    expect(readFileSync(configPath, "utf8")).not.toContain("sk-secret-value");
    expect(readFileSync(defaultProviderCredentialsPath(configPath), "utf8")).toContain(
      "sk-secret-value",
    );
  });

  it("hydrates missing variables without overriding explicit environment values", () => {
    saveProviderApiKey("OPENAI_API_KEY", "stored-key", configPath);
    saveProviderApiKey("CARBONCODE_OPENAI_RELAY_KEY", "stored-relay-key", configPath);
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "shell-key" };

    expect(hydrateProviderApiKeys(configPath, env)).toEqual(["CARBONCODE_OPENAI_RELAY_KEY"]);
    expect(env.OPENAI_API_KEY).toBe("shell-key");
    expect(env.CARBONCODE_OPENAI_RELAY_KEY).toBe("stored-relay-key");
  });

  it.runIf(process.platform !== "win32")("uses owner-only permissions", () => {
    saveProviderApiKey("OPENAI_API_KEY", "stored-key", configPath);
    const mode = statSync(defaultProviderCredentialsPath(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("ignores malformed stores instead of injecting untrusted values", () => {
    writeFileSync(
      defaultProviderCredentialsPath(configPath),
      JSON.stringify({ version: 999, apiKeys: { OPENAI_API_KEY: "bad" } }),
      "utf8",
    );
    const env: NodeJS.ProcessEnv = {};

    expect(hydrateProviderApiKeys(configPath, env)).toEqual([]);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
