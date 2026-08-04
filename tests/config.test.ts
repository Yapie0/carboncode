import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addProjectPathAllowed,
  addProjectShellAllowed,
  clearProjectPathAllowed,
  clearProjectShellAllowed,
  defaultConfigPath,
  editModeHintShown,
  isPlausibleKey,
  loadApiKey,
  loadBaseUrl,
  loadDesktopOpenTabs,
  loadEditMode,
  loadIndexConfig,
  loadIndexUserConfig,
  loadMcpToolProfile,
  loadModel,
  loadPricingOverride,
  loadProjectPathAllowed,
  loadProjectShellAllowed,
  loadRateLimit,
  loadReasoningEffort,
  loadSemanticEmbeddingUserConfig,
  loadTheme,
  loadThemeEnv,
  markEditModeHintShown,
  readConfig,
  redactKey,
  redactSemanticEmbeddingConfig,
  removeProjectPathAllowed,
  removeProjectShellAllowed,
  resolveSemanticEmbeddingConfig,
  resolveThemePreference,
  saveApiKey,
  saveBaseUrl,
  saveDesktopOpenTabs,
  saveEditMode,
  saveIndexConfig,
  saveModel,
  savePreset,
  saveReasoningEffort,
  saveSemanticEmbeddingConfig,
  saveTheme,
  searchEnabled,
  webSearchEndpoint,
  webSearchEngine,
  writeConfig,
} from "../src/config.js";

describe("config", () => {
  let dir: string;
  let path: string;
  const originalEnv = process.env.DEEPSEEK_API_KEY;
  const originalCarbonSearch = process.env.CARBONCODE_SEARCH;
  const originalSearch = process.env.REASONIX_SEARCH;
  const originalCarbonWebSearchEngine = process.env.CARBONCODE_WEB_SEARCH_ENGINE;
  const originalReasonixWebSearchEngine = process.env.REASONIX_WEB_SEARCH_ENGINE;
  const originalCarbonWebSearchEndpoint = process.env.CARBONCODE_WEB_SEARCH_ENDPOINT;
  const originalReasonixWebSearchEndpoint = process.env.REASONIX_WEB_SEARCH_ENDPOINT;
  const originalBaseUrl = process.env.DEEPSEEK_BASE_URL;
  const originalCarbonEmbedModel = process.env.CARBONCODE_EMBED_MODEL;
  const originalReasonixEmbedModel = process.env.REASONIX_EMBED_MODEL;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reasonix-test-"));
    path = join(dir, "config.json");
    // biome-ignore lint/performance/noDelete: the string "undefined" leaks into process.env otherwise
    delete process.env.DEEPSEEK_API_KEY;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.CARBONCODE_SEARCH;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.REASONIX_SEARCH;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.CARBONCODE_WEB_SEARCH_ENGINE;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.REASONIX_WEB_SEARCH_ENGINE;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.CARBONCODE_WEB_SEARCH_ENDPOINT;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.REASONIX_WEB_SEARCH_ENDPOINT;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.DEEPSEEK_BASE_URL;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.CARBONCODE_EMBED_MODEL;
    // biome-ignore lint/performance/noDelete: same reason
    delete process.env.REASONIX_EMBED_MODEL;
  });

  it("persists an explicit chat model", () => {
    saveModel(" custom-chat-model ", path);
    expect(loadModel(path)).toBe("custom-chat-model");
    expect(readConfig(path).model).toBe("custom-chat-model");
  });

  it("clears an explicit model when a preset is selected", () => {
    writeConfig({ model: "custom-chat-model", preset: "auto" }, path);
    savePreset("pro", path);
    expect(loadModel(path)).toBeUndefined();
    expect(readConfig(path).preset).toBe("pro");
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      // biome-ignore lint/performance/noDelete: same reason as beforeEach
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalEnv;
    }
    if (originalCarbonSearch === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.CARBONCODE_SEARCH;
    } else {
      process.env.CARBONCODE_SEARCH = originalCarbonSearch;
    }
    if (originalSearch === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.REASONIX_SEARCH;
    } else {
      process.env.REASONIX_SEARCH = originalSearch;
    }
    if (originalCarbonWebSearchEngine === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.CARBONCODE_WEB_SEARCH_ENGINE;
    } else {
      process.env.CARBONCODE_WEB_SEARCH_ENGINE = originalCarbonWebSearchEngine;
    }
    if (originalReasonixWebSearchEngine === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.REASONIX_WEB_SEARCH_ENGINE;
    } else {
      process.env.REASONIX_WEB_SEARCH_ENGINE = originalReasonixWebSearchEngine;
    }
    if (originalCarbonWebSearchEndpoint === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.CARBONCODE_WEB_SEARCH_ENDPOINT;
    } else {
      process.env.CARBONCODE_WEB_SEARCH_ENDPOINT = originalCarbonWebSearchEndpoint;
    }
    if (originalReasonixWebSearchEndpoint === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.REASONIX_WEB_SEARCH_ENDPOINT;
    } else {
      process.env.REASONIX_WEB_SEARCH_ENDPOINT = originalReasonixWebSearchEndpoint;
    }
    if (originalBaseUrl === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.DEEPSEEK_BASE_URL;
    } else {
      process.env.DEEPSEEK_BASE_URL = originalBaseUrl;
    }
    if (originalCarbonEmbedModel === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.CARBONCODE_EMBED_MODEL;
    } else {
      process.env.CARBONCODE_EMBED_MODEL = originalCarbonEmbedModel;
    }
    if (originalReasonixEmbedModel === undefined) {
      // biome-ignore lint/performance/noDelete: same reason
      delete process.env.REASONIX_EMBED_MODEL;
    } else {
      process.env.REASONIX_EMBED_MODEL = originalReasonixEmbedModel;
    }
  });

  it("readConfig returns {} when file is missing", () => {
    expect(readConfig(path)).toEqual({});
  });

  it("defaultConfigPath lives under ~/.carboncode", () => {
    expect(defaultConfigPath()).toMatch(/[/\\]\.carboncode[/\\]config\.json$/);
    expect(defaultConfigPath()).not.toContain(".reasonix");
  });

  it("writeConfig + readConfig round-trip", () => {
    writeConfig({ apiKey: "sk-test123abcdefghijkl" }, path);
    expect(readConfig(path).apiKey).toBe("sk-test123abcdefghijkl");
  });

  it("saveApiKey trims whitespace", () => {
    saveApiKey("  sk-test123abcdefghijkl  ", path);
    expect(readConfig(path).apiKey).toBe("sk-test123abcdefghijkl");
  });

  it("loadApiKey prefers env var over config file", () => {
    saveApiKey("sk-fromfile1234567890ab", path);
    process.env.DEEPSEEK_API_KEY = "sk-fromenv1234567890abcd";
    expect(loadApiKey(path)).toBe("sk-fromenv1234567890abcd");
  });

  it("loadApiKey falls back to config file when env unset", () => {
    saveApiKey("sk-fromfile1234567890ab", path);
    expect(loadApiKey(path)).toBe("sk-fromfile1234567890ab");
  });

  it("loadApiKey returns undefined when nothing set", () => {
    expect(loadApiKey(path)).toBeUndefined();
  });

  it("isPlausibleKey accepts DeepSeek-shaped keys", () => {
    expect(isPlausibleKey("sk-1234567890abcdef")).toBe(true);
    expect(isPlausibleKey("sk-abcDEF_123-456789012")).toBe(true);
  });

  it("isPlausibleKey accepts non-sk tokens for self-hosted endpoints (issue #502)", () => {
    expect(isPlausibleKey("token-1234567890abcdef")).toBe(true);
    expect(isPlausibleKey("c8f5a3e2d1b9876543210fedcba98765")).toBe(true);
    expect(isPlausibleKey("Bearer_self_hosted_token_value_123")).toBe(true);
  });

  it("isPlausibleKey rejects empty / too-short / whitespace inputs", () => {
    expect(isPlausibleKey("")).toBe(false);
    expect(isPlausibleKey("hello")).toBe(false);
    expect(isPlausibleKey("sk-short")).toBe(false);
    expect(isPlausibleKey("has whitespace in the middle")).toBe(false);
  });

  it("loadBaseUrl prefers env var over config", () => {
    saveBaseUrl("https://from-config.example.com", path);
    process.env.DEEPSEEK_BASE_URL = "https://from-env.example.com";
    try {
      expect(loadBaseUrl(path)).toBe("https://from-env.example.com");
    } finally {
      // biome-ignore lint/performance/noDelete: restore exact env state
      delete process.env.DEEPSEEK_BASE_URL;
    }
  });

  it("loadBaseUrl falls back to config when env unset", () => {
    saveBaseUrl("https://self-hosted.example.com", path);
    expect(loadBaseUrl(path)).toBe("https://self-hosted.example.com");
  });

  it("loadBaseUrl returns undefined when nothing set", () => {
    expect(loadBaseUrl(path)).toBeUndefined();
  });

  it("saveBaseUrl with empty string clears the field", () => {
    saveBaseUrl("https://self-hosted.example.com", path);
    saveBaseUrl("", path);
    expect(loadBaseUrl(path)).toBeUndefined();
  });

  it("loads pricingOverride with valid non-negative fields", () => {
    writeConfig(
      {
        pricingOverride: {
          "third-party-model": { inputCacheHit: 0, inputCacheMiss: 1.5, output: 3 },
          invalid: { inputCacheHit: -1, inputCacheMiss: "bad" as unknown as number },
        },
      },
      path,
    );
    expect(loadPricingOverride(path)).toEqual({
      "third-party-model": { inputCacheHit: 0, inputCacheMiss: 1.5, output: 3 },
    });
  });

  it("loads positive integer rateLimit rpm only", () => {
    writeConfig({ rateLimit: { rpm: 30 } }, path);
    expect(loadRateLimit(path)).toEqual({ rpm: 30 });
    writeConfig({ rateLimit: { rpm: 0 } }, path);
    expect(loadRateLimit(path)).toBeUndefined();
    writeConfig({ rateLimit: { rpm: 1.5 } }, path);
    expect(loadRateLimit(path)).toBeUndefined();
  });

  it("redactKey hides the middle", () => {
    expect(redactKey("sk-1234567890abcdefghij")).toBe("sk-123…ghij");
    expect(redactKey("short")).toBe("****");
    expect(redactKey("")).toBe("");
  });

  it("round-trips the full ReasonixConfig (preset, mcp, session, setupCompleted)", () => {
    writeConfig(
      {
        apiKey: "sk-test123abcdefghijkl",
        preset: "smart",
        mcp: [
          "filesystem=npx -y @modelcontextprotocol/server-filesystem /tmp/safe",
          "memory=npx -y @modelcontextprotocol/server-memory",
        ],
        session: "work",
        setupCompleted: true,
      },
      path,
    );
    const loaded = readConfig(path);
    expect(loaded.preset).toBe("smart");
    expect(loaded.mcp).toHaveLength(2);
    expect(loaded.session).toBe("work");
    expect(loaded.setupCompleted).toBe(true);
  });

  it("uses the lean code-mode MCP profile by default and allows an explicit full override", () => {
    expect(loadMcpToolProfile(path)).toBe("auto");
    writeConfig({ mcpToolProfile: "full" }, path);
    expect(loadMcpToolProfile(path)).toBe("full");
    writeConfig({ mcpToolProfile: "invalid" as "full" }, path);
    expect(loadMcpToolProfile(path)).toBe("auto");
  });

  it("session: null in the config means the user opted out of persistence", () => {
    writeConfig({ apiKey: "sk-xxxxxxxxxxxxxxxxxxxx", session: null }, path);
    const loaded = readConfig(path);
    expect(loaded.session).toBeNull();
  });

  it("searchEnabled defaults to true with no config and no env", () => {
    expect(searchEnabled(path)).toBe(true);
  });

  it("searchEnabled honours `search: false` in the config file", () => {
    writeConfig({ apiKey: "sk-test123abcdefghijkl", search: false }, path);
    expect(searchEnabled(path)).toBe(false);
  });

  it("searchEnabled honours CARBONCODE_SEARCH=off/false/0", () => {
    process.env.CARBONCODE_SEARCH = "off";
    expect(searchEnabled(path)).toBe(false);
    process.env.CARBONCODE_SEARCH = "false";
    expect(searchEnabled(path)).toBe(false);
    process.env.CARBONCODE_SEARCH = "0";
    expect(searchEnabled(path)).toBe(false);
  });

  it("searchEnabled normalizes CARBONCODE_SEARCH before checking opt-out values", () => {
    process.env.CARBONCODE_SEARCH = " OFF ";
    expect(searchEnabled(path)).toBe(false);
  });

  it("searchEnabled keeps REASONIX_SEARCH as a legacy opt-out", () => {
    process.env.REASONIX_SEARCH = "off";
    expect(searchEnabled(path)).toBe(false);
  });

  it("searchEnabled normalizes legacy REASONIX_SEARCH opt-out values", () => {
    process.env.REASONIX_SEARCH = " False ";
    expect(searchEnabled(path)).toBe(false);
  });

  it("searchEnabled lets CARBONCODE_SEARCH override legacy REASONIX_SEARCH", () => {
    process.env.CARBONCODE_SEARCH = "on";
    process.env.REASONIX_SEARCH = "off";
    expect(searchEnabled(path)).toBe(true);
  });

  it("searchEnabled stays true for unrelated env values", () => {
    process.env.CARBONCODE_SEARCH = "on";
    expect(searchEnabled(path)).toBe(true);
  });

  it("env off beats config true", () => {
    writeConfig({ apiKey: "sk-test123abcdefghijkl", search: true }, path);
    process.env.CARBONCODE_SEARCH = "off";
    expect(searchEnabled(path)).toBe(false);
  });

  it("webSearchEngine lets CARBONCODE_WEB_SEARCH_ENGINE override config", () => {
    writeConfig({ webSearchEngine: "mojeek" }, path);
    process.env.CARBONCODE_WEB_SEARCH_ENGINE = " metaso ";
    expect(webSearchEngine(path)).toBe("metaso");
  });

  it("webSearchEngine keeps REASONIX_WEB_SEARCH_ENGINE as a legacy override", () => {
    writeConfig({ webSearchEngine: "mojeek" }, path);
    process.env.REASONIX_WEB_SEARCH_ENGINE = "searxng";
    expect(webSearchEngine(path)).toBe("searxng");
  });

  it("webSearchEngine lets CARBONCODE_WEB_SEARCH_ENGINE override legacy env", () => {
    process.env.CARBONCODE_WEB_SEARCH_ENGINE = "metaso";
    process.env.REASONIX_WEB_SEARCH_ENGINE = "searxng";
    expect(webSearchEngine(path)).toBe("metaso");
  });

  it("webSearchEngine ignores invalid env values", () => {
    writeConfig({ webSearchEngine: "searxng" }, path);
    process.env.CARBONCODE_WEB_SEARCH_ENGINE = "unknown";
    expect(webSearchEngine(path)).toBe("searxng");
  });

  it("webSearchEndpoint lets CARBONCODE_WEB_SEARCH_ENDPOINT override config", () => {
    writeConfig({ webSearchEndpoint: "http://configured.local:8080" }, path);
    process.env.CARBONCODE_WEB_SEARCH_ENDPOINT = " http://env.local:8888 ";
    expect(webSearchEndpoint(path)).toBe("http://env.local:8888");
  });

  it("loadProjectShellAllowed returns [] when nothing stored", () => {
    expect(loadProjectShellAllowed("/some/project", path)).toEqual([]);
  });

  it("addProjectShellAllowed persists and dedups per project", () => {
    addProjectShellAllowed("/a", "npm install", path);
    addProjectShellAllowed("/a", "git commit", path);
    addProjectShellAllowed("/a", "npm install", path); // dedup
    addProjectShellAllowed("/b", "cargo add", path);
    expect(loadProjectShellAllowed("/a", path)).toEqual(["npm install", "git commit"]);
    expect(loadProjectShellAllowed("/b", path)).toEqual(["cargo add"]);
  });

  it("addProjectShellAllowed ignores empty / whitespace prefixes", () => {
    addProjectShellAllowed("/a", "", path);
    addProjectShellAllowed("/a", "   ", path);
    expect(loadProjectShellAllowed("/a", path)).toEqual([]);
  });

  it("removeProjectShellAllowed drops one entry by exact match", () => {
    addProjectShellAllowed("/a", "npm install", path);
    addProjectShellAllowed("/a", "git commit", path);
    expect(removeProjectShellAllowed("/a", "npm install", path)).toBe(true);
    expect(loadProjectShellAllowed("/a", path)).toEqual(["git commit"]);
  });

  it("removeProjectShellAllowed returns false when prefix isn't stored", () => {
    addProjectShellAllowed("/a", "npm install", path);
    expect(removeProjectShellAllowed("/a", "git commit", path)).toBe(false);
    expect(loadProjectShellAllowed("/a", path)).toEqual(["npm install"]);
  });

  it("removeProjectShellAllowed doesn't prefix-match (literal only)", () => {
    addProjectShellAllowed("/a", "git push origin main", path);
    expect(removeProjectShellAllowed("/a", "git push", path)).toBe(false);
    expect(loadProjectShellAllowed("/a", path)).toEqual(["git push origin main"]);
  });

  it("removeProjectShellAllowed scoped to project (doesn't leak across roots)", () => {
    addProjectShellAllowed("/a", "lint", path);
    addProjectShellAllowed("/b", "lint", path);
    expect(removeProjectShellAllowed("/a", "lint", path)).toBe(true);
    expect(loadProjectShellAllowed("/a", path)).toEqual([]);
    expect(loadProjectShellAllowed("/b", path)).toEqual(["lint"]);
  });

  it("clearProjectShellAllowed wipes one project, returns count, leaves others alone", () => {
    addProjectShellAllowed("/a", "lint", path);
    addProjectShellAllowed("/a", "test", path);
    addProjectShellAllowed("/b", "build", path);
    expect(clearProjectShellAllowed("/a", path)).toBe(2);
    expect(loadProjectShellAllowed("/a", path)).toEqual([]);
    expect(loadProjectShellAllowed("/b", path)).toEqual(["build"]);
  });

  it("clearProjectShellAllowed returns 0 when nothing stored", () => {
    expect(clearProjectShellAllowed("/empty", path)).toBe(0);
  });

  it("pathAllowed CRUD mirrors shellAllowed (load/add/dedup/remove/clear)", () => {
    expect(loadProjectPathAllowed("/a", path)).toEqual([]);
    addProjectPathAllowed("/a", "/Users/foo/Documents", path);
    addProjectPathAllowed("/a", "/etc", path);
    addProjectPathAllowed("/a", "/Users/foo/Documents", path); // dedup
    addProjectPathAllowed("/b", "/var/log", path);
    expect(loadProjectPathAllowed("/a", path)).toEqual(["/Users/foo/Documents", "/etc"]);
    expect(loadProjectPathAllowed("/b", path)).toEqual(["/var/log"]);
    expect(removeProjectPathAllowed("/a", "/etc", path)).toBe(true);
    expect(removeProjectPathAllowed("/a", "/etc", path)).toBe(false);
    expect(loadProjectPathAllowed("/a", path)).toEqual(["/Users/foo/Documents"]);
    expect(clearProjectPathAllowed("/a", path)).toBe(1);
    expect(loadProjectPathAllowed("/a", path)).toEqual([]);
    expect(loadProjectPathAllowed("/b", path)).toEqual(["/var/log"]);
  });

  it("pathAllowed coexists with shellAllowed on the same project entry", () => {
    addProjectShellAllowed("/proj", "npm install", path);
    addProjectPathAllowed("/proj", "/Users/foo", path);
    expect(loadProjectShellAllowed("/proj", path)).toEqual(["npm install"]);
    expect(loadProjectPathAllowed("/proj", path)).toEqual(["/Users/foo"]);
  });

  it.runIf(process.platform === "win32")(
    "matches project keys case-insensitively on Windows so cross-shell rootDir casing doesn't lose entries (#402)",
    () => {
      addProjectShellAllowed("F:\\Reasonix", "gh", path);
      expect(loadProjectShellAllowed("f:\\reasonix", path)).toContain("gh");
      expect(loadProjectShellAllowed("F:\\REASONIX", path)).toContain("gh");
      // Mutations through any-cased rootDir consolidate onto the original key.
      addProjectShellAllowed("f:\\reasonix", "deploy", path);
      expect(loadProjectShellAllowed("F:\\Reasonix", path)).toEqual(["gh", "deploy"]);
      expect(Object.keys(readConfig(path).projects ?? {})).toEqual(["F:\\Reasonix"]);
      expect(removeProjectShellAllowed("f:\\REASONIX", "gh", path)).toBe(true);
      expect(loadProjectShellAllowed("F:\\Reasonix", path)).toEqual(["deploy"]);
      expect(clearProjectShellAllowed("F:\\REASONIX", path)).toBe(1);
      expect(loadProjectShellAllowed("F:\\Reasonix", path)).toEqual([]);
    },
  );

  it.runIf(process.platform !== "win32")(
    "keeps project key matching case-sensitive on non-Windows platforms",
    () => {
      addProjectShellAllowed("/home/foo/repo", "gh", path);
      expect(loadProjectShellAllowed("/home/foo/repo", path)).toContain("gh");
      expect(loadProjectShellAllowed("/home/FOO/repo", path)).toEqual([]);
    },
  );

  it("loadEditMode defaults to 'review' when unset", () => {
    expect(loadEditMode(path)).toBe("review");
  });

  it("saveEditMode + loadEditMode round-trip 'auto'", () => {
    saveEditMode("auto", path);
    expect(loadEditMode(path)).toBe("auto");
    // Doesn't clobber other fields in the config.
    expect(readConfig(path).editMode).toBe("auto");
  });

  it("saveEditMode + loadEditMode round-trip 'yolo' (issue #644)", () => {
    saveEditMode("yolo", path);
    expect(loadEditMode(path)).toBe("yolo");
    expect(readConfig(path).editMode).toBe("yolo");
  });

  it("loadEditMode coerces unknown values back to 'review'", () => {
    writeConfig({ editMode: "garbage" as any }, path);
    expect(loadEditMode(path)).toBe("review");
  });

  it("loadReasoningEffort defaults to 'max' when unset", () => {
    expect(loadReasoningEffort(path)).toBe("max");
  });

  it("saveReasoningEffort + loadReasoningEffort round-trip 'high'", () => {
    saveReasoningEffort("high", path);
    expect(loadReasoningEffort(path)).toBe("high");
    expect(readConfig(path).reasoningEffort).toBe("high");
  });

  it("loadReasoningEffort coerces unknown values back to 'max'", () => {
    writeConfig({ reasoningEffort: "turbo" as any }, path);
    expect(loadReasoningEffort(path)).toBe("max");
  });

  it("saveReasoningEffort doesn't clobber other persisted fields", () => {
    saveEditMode("auto", path);
    saveReasoningEffort("high", path);
    expect(loadEditMode(path)).toBe("auto");
    expect(loadReasoningEffort(path)).toBe("high");
  });

  it("saveTheme + loadTheme round-trip a registered theme", () => {
    saveTheme("tokyo-night", path);
    expect(loadTheme(path)).toBe("tokyo-night");
    expect(readConfig(path).theme).toBe("tokyo-night");
  });

  it("saveTheme + loadTheme round-trip auto", () => {
    saveTheme("auto", path);
    expect(loadTheme(path)).toBe("auto");
    expect(readConfig(path).theme).toBe("auto");
  });

  it("loadTheme returns undefined for invalid runtime values", () => {
    const invalidValues = ["unknown", null, false, 123, [], { name: "github-light" }];

    for (const theme of invalidValues) {
      writeConfig({ theme } as never, path);
      expect(loadTheme(path)).toBeUndefined();
    }
  });

  it("resolveThemePreference lets env override auto but not registered config themes", () => {
    expect(resolveThemePreference("auto", "github-light")).toBe("github-light");
    expect(resolveThemePreference(undefined, "tokyo-night")).toBe("tokyo-night");
    expect(resolveThemePreference("github-dark", "github-light")).toBe("github-dark");
    expect(resolveThemePreference("auto", "unknown")).toBe("github-dark");
  });

  it("loadThemeEnv prefers Carbon Code theme env over the legacy Reasonix env", () => {
    expect(loadThemeEnv({ CARBONCODE_THEME: "tokyo-night", REASONIX_THEME: "github-dark" })).toBe(
      "tokyo-night",
    );
    expect(loadThemeEnv({ REASONIX_THEME: "github-dark" })).toBe("github-dark");
    expect(loadThemeEnv({})).toBeUndefined();
  });

  it("saveTheme doesn't clobber other persisted fields", () => {
    saveEditMode("auto", path);
    saveTheme("github-light", path);
    expect(loadEditMode(path)).toBe("auto");
    expect(loadTheme(path)).toBe("github-light");
  });

  it("editModeHintShown defaults to false and toggles on markEditModeHintShown", () => {
    expect(editModeHintShown(path)).toBe(false);
    markEditModeHintShown(path);
    expect(editModeHintShown(path)).toBe(true);
    // Idempotent — calling again doesn't rewrite or clobber other fields.
    saveEditMode("auto", path);
    markEditModeHintShown(path);
    expect(editModeHintShown(path)).toBe(true);
    expect(loadEditMode(path)).toBe("auto");
  });

  it("round-trips semantic embedding config", () => {
    saveSemanticEmbeddingConfig(
      {
        provider: "openai-compat",
        openaiCompat: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-openai1234567890abcd",
          model: "text-embedding-3-small",
          extraBody: { user: "reasonix" },
        },
      },
      path,
    );
    const loaded = loadSemanticEmbeddingUserConfig(path);
    expect(loaded.provider).toBe("openai-compat");
    expect(loaded.openaiCompat?.baseUrl).toBe("https://api.openai.com/v1");
    expect(loaded.openaiCompat?.extraBody).toEqual({ user: "reasonix" });
  });

  it("resolves ollama by default when semantic config is absent", () => {
    const resolved = resolveSemanticEmbeddingConfig(path);
    expect(resolved.provider).toBe("ollama");
    expect(resolved.baseUrl).toBe("http://localhost:11434");
    expect(resolved.model).toBe("nomic-embed-text");
  });

  it("resolves ollama defaults from an existing empty config file", () => {
    writeConfig({}, path);
    const resolved = resolveSemanticEmbeddingConfig(path);
    expect(resolved.provider).toBe("ollama");
    expect(resolved.baseUrl).toBe("http://localhost:11434");
    expect(resolved.model).toBe("nomic-embed-text");
  });

  it("resolves ollama defaults when semantic.provider is missing", () => {
    writeConfig(
      {
        semantic: {
          ollama: {
            model: "",
          },
          openaiCompat: {
            baseUrl: "https://api.example.com/v1/embeddings",
            apiKey: "sk-openai1234567890abcd",
            model: "bge-m3",
          },
        },
      },
      path,
    );
    const resolved = resolveSemanticEmbeddingConfig(path);
    expect(resolved.provider).toBe("ollama");
    expect(resolved.baseUrl).toBe("http://localhost:11434");
    expect(resolved.model).toBe("nomic-embed-text");
  });

  it("prefers CARBONCODE_EMBED_MODEL for semantic ollama model env", () => {
    process.env.CARBONCODE_EMBED_MODEL = "bge-m3-carbon";
    process.env.REASONIX_EMBED_MODEL = "bge-m3-legacy";

    const resolved = resolveSemanticEmbeddingConfig(path);

    expect(resolved.provider).toBe("ollama");
    expect(resolved.model).toBe("bge-m3-carbon");
  });

  it("keeps REASONIX_EMBED_MODEL as a legacy semantic ollama model fallback", () => {
    // biome-ignore lint/performance/noDelete: the string "undefined" leaks into process.env otherwise
    delete process.env.CARBONCODE_EMBED_MODEL;
    process.env.REASONIX_EMBED_MODEL = "bge-m3-legacy";

    const resolved = resolveSemanticEmbeddingConfig(path);
    const view = redactSemanticEmbeddingConfig(loadSemanticEmbeddingUserConfig(path));

    expect(resolved.model).toBe("bge-m3-legacy");
    expect(view.ollama.model).toBe("bge-m3-legacy");
  });

  it("accepts semantic API URLs that already include /embeddings", () => {
    saveSemanticEmbeddingConfig(
      {
        provider: "openai-compat",
        openaiCompat: {
          baseUrl: "https://api.openai.com/v1/embeddings",
          apiKey: "sk-openai1234567890abcd",
          model: "text-embedding-3-small",
        },
      },
      path,
    );
    const resolved = resolveSemanticEmbeddingConfig(path);
    expect(resolved.provider).toBe("openai-compat");
    expect(resolved.baseUrl).toBe("https://api.openai.com/v1/embeddings");
  });

  it("redacts openai-compatible api keys in semantic config views", () => {
    saveSemanticEmbeddingConfig(
      {
        provider: "openai-compat",
        openaiCompat: {
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-openai1234567890abcd",
          model: "text-embedding-3-small",
        },
      },
      path,
    );
    const view = redactSemanticEmbeddingConfig(loadSemanticEmbeddingUserConfig(path));
    expect(view.openaiCompat.apiKeySet).toBe(true);
    expect(view.openaiCompat.apiKey).not.toBe("sk-openai1234567890abcd");
    expect(view.openaiCompat.apiKey).toContain("…");
  });

  it("rejects non-object semantic extraBody", () => {
    expect(() =>
      saveSemanticEmbeddingConfig(
        {
          provider: "openai-compat",
          openaiCompat: {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-openai1234567890abcd",
            model: "text-embedding-3-small",
            extraBody: [] as unknown as Record<string, unknown>,
          },
        },
        path,
      ),
    ).toThrow(/JSON object/);
  });

  describe("desktopOpenTabs — issue #933", () => {
    it("returns [] when unset", () => {
      expect(loadDesktopOpenTabs(path)).toEqual([]);
    });

    it("round-trips an ordered list", () => {
      saveDesktopOpenTabs(["/a", "/b", "/c"], path);
      expect(loadDesktopOpenTabs(path)).toEqual(["/a", "/b", "/c"]);
    });

    it("filters out empty / non-string entries on read", () => {
      writeConfig({ desktopOpenTabs: ["/a", "", null as unknown as string, "/b"] }, path);
      expect(loadDesktopOpenTabs(path)).toEqual(["/a", "/b"]);
    });

    it("clears the key when saving an empty list", () => {
      saveDesktopOpenTabs(["/a"], path);
      saveDesktopOpenTabs([], path);
      expect(readConfig(path).desktopOpenTabs).toBeUndefined();
    });

    it("preserves order across multiple saves (tab reordering)", () => {
      saveDesktopOpenTabs(["/a", "/b", "/c"], path);
      saveDesktopOpenTabs(["/c", "/a", "/b"], path);
      expect(loadDesktopOpenTabs(path)).toEqual(["/c", "/a", "/b"]);
    });
  });
});
