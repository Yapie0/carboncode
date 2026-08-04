import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../src/config.js";
import {
  OPENAI_RELAY_KEY_ENV,
  configureOpenAIProviderForSession,
  normalizeRelayBaseUrl,
} from "../src/multi-agent/provider-setup.js";
import {
  defaultProviderCredentialsPath,
  hasStoredProviderApiKey,
  hydrateProviderApiKeys,
} from "../src/providers/credentials.js";
import { candidateAvailability } from "../src/providers/registry.js";

function modelsResponse(): Response {
  return new Response(
    JSON.stringify({
      object: "list",
      data: [{ id: "gpt-5.5", object: "model", owned_by: "relay" }],
    }),
    { status: 200 },
  );
}

function relayCatalogResponse(): Response {
  return new Response(
    JSON.stringify({
      object: "list",
      data: [
        { id: "gpt-5.5", object: "model", owned_by: "relay" },
        { id: "gpt-5.6-sol", object: "model", owned_by: "relay" },
        { id: "gpt-5.6-terra", object: "model", owned_by: "relay" },
        { id: "gpt-5.6-luna", object: "model", owned_by: "relay" },
      ],
    }),
    { status: 200 },
  );
}

describe("multi-agent provider setup", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "carbon-provider-setup-"));
    configPath = join(tmp, "config.json");
    vi.stubEnv(OPENAI_RELAY_KEY_ENV, "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("normalizes compatible relay URLs", () => {
    expect(normalizeRelayBaseUrl(" https://relay.example/v1/ ")).toBe("https://relay.example/v1");
    expect(() => normalizeRelayBaseUrl("relay.example")).toThrow(/Base URL/);
    expect(() => normalizeRelayBaseUrl("file:///tmp/api")).toThrow(/http/);
  });

  it("validates a relay and stores metadata separately from its credential", async () => {
    const fetchMock = vi.fn(async () => modelsResponse()) as typeof fetch;
    const rawKey = "sk-relay-1234567890abcdef";

    const result = await configureOpenAIProviderForSession(
      rawKey,
      { kind: "relay", baseUrl: "https://relay.example/v1/", model: "gpt-5.5" },
      { configPath, fetch: fetchMock },
    );

    expect(result).toMatchObject({
      ok: true,
      candidateId: "openai-relay",
      baseUrl: "https://relay.example/v1",
      model: "gpt-5.5",
      syncedProfileIds: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example/v1/models",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${rawKey}` },
      }),
    );
    expect(process.env[OPENAI_RELAY_KEY_ENV]).toBe(rawKey);

    const saved = readConfig(configPath);
    expect(saved.modelProfiles).toContainEqual({
      id: "openai-relay",
      provider: "openai",
      model: "gpt-5.5",
      baseUrl: "https://relay.example/v1",
      apiKeyEnv: OPENAI_RELAY_KEY_ENV,
    });
    expect(readFileSync(configPath, "utf8")).not.toContain(rawKey);
    expect(hasStoredProviderApiKey(OPENAI_RELAY_KEY_ENV, configPath)).toBe(true);
    expect(readFileSync(defaultProviderCredentialsPath(configPath), "utf8")).toContain(rawKey);
  });

  it("persists official model metadata and its user-level credential separately", async () => {
    const rawKey = "sk-official-1234567890abcdef";
    const result = await configureOpenAIProviderForSession(
      rawKey,
      { kind: "official" },
      { configPath, fetch: vi.fn(async () => modelsResponse()) as typeof fetch },
    );

    expect(result).toMatchObject({
      ok: true,
      profileId: "openai-gpt-5-5",
      model: "gpt-5.5",
    });
    expect(process.env.OPENAI_API_KEY).toBe(rawKey);
    expect(readConfig(configPath).modelProfiles).toContainEqual({
      id: "openai-gpt-5-5",
      provider: "openai",
      model: "gpt-5.5",
      apiKeyEnv: "OPENAI_API_KEY",
    });
    expect(readFileSync(configPath, "utf8")).not.toContain(rawKey);
    expect(hasStoredProviderApiKey("OPENAI_API_KEY", configPath)).toBe(true);
  });

  it("hydrates a persisted relay key after a simulated process restart", async () => {
    const rawKey = "sk-persisted-1234567890abcdef";
    await configureOpenAIProviderForSession(
      rawKey,
      { kind: "relay", baseUrl: "https://relay.example/v1", model: "gpt-5.5" },
      { configPath, fetch: vi.fn(async () => modelsResponse()) as typeof fetch },
    );
    delete process.env[OPENAI_RELAY_KEY_ENV];

    expect(hydrateProviderApiKeys(configPath)).toEqual([OPENAI_RELAY_KEY_ENV]);
    const config = readConfig(configPath);
    const profile = config.modelProfiles?.[0];
    expect(profile).toBeDefined();
    expect(candidateAvailability(profile!, config).available).toBe(true);
    expect(process.env[OPENAI_RELAY_KEY_ENV]).toBe(rawKey);
  });

  it("falls back to a minimal Responses call when a relay omits /models", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_test",
            status: "completed",
            output: [],
            usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
          }),
          { status: 200 },
        ),
      ) as typeof fetch;

    const result = await configureOpenAIProviderForSession(
      "sk-relay-1234567890abcdef",
      { kind: "relay", baseUrl: "https://relay.example", model: "gpt-5.5" },
      { configPath, fetch: fetchMock },
    );

    expect(result).toMatchObject({ ok: true, candidateId: "openai-relay", modelCount: 0 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://relay.example/models",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://relay.example/responses",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reuses one relay credential environment for multiple models on the same endpoint", async () => {
    const fetchMock = vi.fn(async () => modelsResponse()) as typeof fetch;
    await configureOpenAIProviderForSession(
      "sk-shared-1234567890abcdef",
      {
        kind: "relay",
        profileId: "company-design",
        baseUrl: "https://relay.example/v1",
        model: "gpt-design",
      },
      { configPath, fetch: fetchMock },
    );
    await configureOpenAIProviderForSession(
      "sk-shared-1234567890abcdef",
      {
        kind: "relay",
        profileId: "company-code",
        baseUrl: "https://relay.example/v1",
        model: "gpt-code",
      },
      { configPath, fetch: fetchMock },
    );

    const profiles = readConfig(configPath).modelProfiles ?? [];
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.apiKeyEnv).toBe("CARBONCODE_MODEL_COMPANY_DESIGN_API_KEY");
    expect(profiles[1]?.apiKeyEnv).toBe(profiles[0]?.apiKeyEnv);
  });

  it("binds discovered unconfigured multi-agent profiles to the validated relay", async () => {
    const result = await configureOpenAIProviderForSession(
      "sk-shared-1234567890abcdef",
      { kind: "relay", baseUrl: "https://relay.example/v1", model: "gpt-5.5" },
      {
        configPath,
        fetch: vi.fn(async () => relayCatalogResponse()) as typeof fetch,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      modelCount: 4,
      syncedProfileIds: ["openai-sol", "openai-terra", "openai-luna"],
    });
    const profiles = readConfig(configPath).modelProfiles ?? [];
    for (const id of ["openai-sol", "openai-terra", "openai-luna"]) {
      expect(profiles).toContainEqual(
        expect.objectContaining({
          id,
          baseUrl: "https://relay.example/v1",
          apiKeyEnv: OPENAI_RELAY_KEY_ENV,
        }),
      );
    }
  });

  it("does not overwrite an explicitly configured official profile during relay discovery", async () => {
    writeConfig(
      {
        modelProfiles: [
          {
            id: "openai-sol",
            provider: "openai",
            model: "gpt-5.6-sol",
            apiKeyEnv: "OPENAI_API_KEY",
          },
        ],
      },
      configPath,
    );

    const result = await configureOpenAIProviderForSession(
      "sk-shared-1234567890abcdef",
      { kind: "relay", baseUrl: "https://relay.example/v1", model: "gpt-5.5" },
      {
        configPath,
        fetch: vi.fn(async () => relayCatalogResponse()) as typeof fetch,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      syncedProfileIds: ["openai-terra", "openai-luna"],
    });
    expect(readConfig(configPath).modelProfiles).toContainEqual({
      id: "openai-sol",
      provider: "openai",
      model: "gpt-5.6-sol",
      apiKeyEnv: "OPENAI_API_KEY",
    });
  });

  it("does not write config or expose a rejected relay key", async () => {
    const result = await configureOpenAIProviderForSession(
      "sk-rejected-1234567890abcdef",
      { kind: "relay", baseUrl: "https://relay.example", model: "gpt-5.5" },
      {
        configPath,
        fetch: vi.fn(async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
      },
    );

    expect(result).toMatchObject({ ok: false });
    expect(process.env[OPENAI_RELAY_KEY_ENV]).toBe("");
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(defaultProviderCredentialsPath(configPath))).toBe(false);
  });
});
