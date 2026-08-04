import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSlash } from "../src/cli/ui/slash/dispatch.js";
import { readConfig } from "../src/config.js";
import { hydrateProviderApiKeys, saveProviderApiKey } from "../src/providers/credentials.js";
import { upsertModelProfile } from "../src/providers/model-profiles.js";

describe("/model profile management", () => {
  let root: string;
  let configPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "carbon-model-slash-"));
    configPath = join(root, "config.json");
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, "COMPANY_KEY");
    rmSync(root, { recursive: true, force: true });
  });

  it("opens the shared setup wizard for add and update", () => {
    upsertModelProfile({ id: "company-gpt", provider: "openai", model: "gpt-5.5" }, configPath);
    expect(handleSlash("model", ["add"], {} as never, { configPath })).toEqual({
      openModelSetup: {},
    });
    expect(handleSlash("model", ["update", "company-gpt"], {} as never, { configPath })).toEqual({
      openModelSetup: { profileId: "company-gpt" },
    });
  });

  it("lists provider metadata and removes an inactive profile", () => {
    upsertModelProfile(
      {
        id: "company-gpt",
        provider: "openai",
        model: "gpt-5.5",
        baseUrl: "https://relay.example/v1",
        apiKeyEnv: "COMPANY_KEY",
      },
      configPath,
    );
    const listed = handleSlash("model", ["list"], {} as never, { configPath });
    expect(listed.info).toContain("company-gpt: openai/gpt-5.5");
    expect(listed.info).toContain("https://relay.example/v1");
    expect(
      handleSlash("model", ["remove", "company-gpt"], {} as never, { configPath }).info,
    ).toContain("已删除");
    expect(readConfig(configPath).modelProfiles).toBeUndefined();
  });

  it("reports a persisted key as ready after restart hydration", () => {
    upsertModelProfile(
      {
        id: "company-gpt",
        provider: "openai",
        model: "gpt-5.5",
        baseUrl: "https://relay.example/v1",
        apiKeyEnv: "COMPANY_KEY",
      },
      configPath,
    );
    saveProviderApiKey("COMPANY_KEY", "sk-persisted-key", configPath);
    Reflect.deleteProperty(process.env, "COMPANY_KEY");

    expect(hydrateProviderApiKeys(configPath)).toEqual(["COMPANY_KEY"]);
    const listed = handleSlash("model", ["list"], {} as never, { configPath });
    expect(listed.info).toContain("company-gpt: openai/gpt-5.5 · 自定义 · Key 就绪");
  });

  it("delegates profile switching to the live provider runtime", () => {
    const switchModelProfile = vi.fn(() => ({
      matched: true,
      ok: true,
      info: "model: company-gpt · openai/gpt-5.5",
    }));
    const result = handleSlash("model", ["company-gpt"], {} as never, {
      configPath,
      switchModelProfile,
    });
    expect(switchModelProfile).toHaveBeenCalledWith("company-gpt");
    expect(result.info).toContain("openai/gpt-5.5");
  });

  it("clears a stale active profile when selecting a raw model id", () => {
    const clearActiveModelProfile = vi.fn();
    const loop = {
      model: "deepseek-v4-pro",
      configure: vi.fn(function (this: { model: string }, update: { model: string }) {
        this.model = update.model;
      }),
    };

    handleSlash("model", ["gpt-standalone"], loop as never, {
      clearActiveModelProfile,
      switchModelProfile: () => ({ matched: false, ok: false, info: "" }),
    });

    expect(clearActiveModelProfile).toHaveBeenCalledOnce();
  });
});
