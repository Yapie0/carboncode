import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  detectSystemLanguage,
  getSupportedLanguages,
} from "../src/i18n/index.js";

describe("default language", () => {
  it("defaults new installs to Simplified Chinese", () => {
    expect(DEFAULT_LANGUAGE).toBe("zh-CN");
  });

  it("lists Simplified Chinese before English everywhere", () => {
    expect(getSupportedLanguages()).toEqual(["zh-CN", "EN"]);
  });
});

describe("detectSystemLanguage", () => {
  it("maps zh-CN to zh-CN", () => {
    expect(detectSystemLanguage("zh-CN")).toBe("zh-CN");
  });

  it("maps any zh-* variant to zh-CN", () => {
    expect(detectSystemLanguage("zh-TW")).toBe("zh-CN");
    expect(detectSystemLanguage("zh-HK")).toBe("zh-CN");
    expect(detectSystemLanguage("zh")).toBe("zh-CN");
  });

  it("maps en-* variants to EN", () => {
    expect(detectSystemLanguage("en-US")).toBe("EN");
    expect(detectSystemLanguage("en-GB")).toBe("EN");
    expect(detectSystemLanguage("en")).toBe("EN");
  });

  it("returns null for unsupported locales", () => {
    expect(detectSystemLanguage("ja-JP")).toBeNull();
    expect(detectSystemLanguage("fr-FR")).toBeNull();
    expect(detectSystemLanguage("de")).toBeNull();
    expect(detectSystemLanguage("")).toBeNull();
  });

  it("default arg reads from Intl — returns a valid LanguageCode or null", () => {
    const result = detectSystemLanguage();
    expect(result === null || result === "EN" || result === "zh-CN").toBe(true);
  });
});
