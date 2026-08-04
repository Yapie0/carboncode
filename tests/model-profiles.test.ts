import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "../src/config.js";
import {
  activateModelProfile,
  configuredModelProfiles,
  findModelProfile,
  modelProfileKeyEnv,
  removeModelProfile,
  resolveModelProfiles,
  suggestModelProfileId,
  upsertModelProfile,
  userModelProfiles,
} from "../src/providers/model-profiles.js";
import { resolveMultiAgentCandidates } from "../src/providers/registry.js";

describe("shared model profiles", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function configPath(): string {
    const root = mkdtempSync(join(tmpdir(), "carbon-model-profile-"));
    roots.push(root);
    return join(root, "config.json");
  }

  it("upserts reusable profiles without storing a raw key", () => {
    const path = configPath();
    upsertModelProfile(
      {
        id: "company-gpt",
        provider: "openai",
        model: "gpt-5.5",
        baseUrl: "https://relay.example/v1/",
        apiKeyEnv: "COMPANY_OPENAI_KEY",
      },
      path,
    );

    expect(configuredModelProfiles(readConfig(path))).toEqual([
      {
        id: "company-gpt",
        provider: "openai",
        model: "gpt-5.5",
        baseUrl: "https://relay.example/v1",
        apiKeyEnv: "COMPANY_OPENAI_KEY",
      },
    ]);
  });

  it("activates and removes a custom profile", () => {
    const path = configPath();
    upsertModelProfile({ id: "company-gpt", provider: "openai", model: "gpt-5.5" }, path);
    activateModelProfile("company-gpt", "gpt-5.5", path);
    expect(readConfig(path)).toMatchObject({
      activeModelProfile: "company-gpt",
      model: "gpt-5.5",
    });
    expect(removeModelProfile("company-gpt", path)).toBe(true);
    expect(readConfig(path).activeModelProfile).toBeUndefined();
  });

  it("lets top-level profiles override legacy inline multi-agent candidates", () => {
    const path = configPath();
    writeConfig(
      {
        modelProfiles: [{ id: "relay", provider: "openai", model: "new-model" }],
        experimental: {
          multiAgent: {
            candidates: [{ id: "relay", provider: "openai", model: "old-model" }],
          },
        },
      },
      path,
    );
    const cfg = readConfig(path);
    expect(findModelProfile(cfg, "relay")?.model).toBe("new-model");
    expect(resolveMultiAgentCandidates(cfg)).toEqual([
      expect.objectContaining({ id: "relay", model: "new-model" }),
    ]);
  });

  it("exposes and removes legacy inline candidates through the shared profile API", () => {
    const path = configPath();
    writeConfig(
      {
        experimental: {
          multiAgent: {
            candidates: [
              {
                id: "legacy-relay",
                provider: "openai",
                model: "gpt-legacy",
                baseUrl: "https://legacy.example/v1",
              },
            ],
          },
        },
      },
      path,
    );
    expect(userModelProfiles(readConfig(path))).toEqual([
      expect.objectContaining({ id: "legacy-relay", model: "gpt-legacy" }),
    ]);
    expect(removeModelProfile("legacy-relay", path)).toBe(true);
    expect(readConfig(path).experimental?.multiAgent?.candidates).toBeUndefined();
  });

  it("includes built-in DeepSeek profiles and creates stable ids/env names", () => {
    expect(resolveModelProfiles({}).map((profile) => profile.id)).toEqual([
      "deepseek-flash",
      "deepseek-pro",
    ]);
    expect(suggestModelProfileId("openai", "GPT 5.5 Preview")).toBe("openai-gpt-5-5-preview");
    expect(modelProfileKeyEnv("company-gpt.5")).toBe("CARBONCODE_MODEL_COMPANY_GPT_5_API_KEY");
  });
});
