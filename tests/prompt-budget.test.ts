import { describe, expect, it } from "vitest";
import { codeSystemBase } from "../src/code/prompt.js";
import { FLASH_MODEL_ID } from "../src/models.js";
import { countTokensBounded } from "../src/tokenizer.js";

describe("code system prompt budget", () => {
  it("keeps the stable cached policy prompt below its regression budget", () => {
    const prompt = codeSystemBase(FLASH_MODEL_ID);
    const estimatedTokens = countTokensBounded(prompt);

    expect(estimatedTokens).toBeLessThan(12_000);
    expect(prompt).not.toContain("deepseek-chat");
    expect(prompt).not.toContain("deepseek-reasoner");
  });
});
