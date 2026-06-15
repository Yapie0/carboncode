import { describe, expect, it } from "vitest";
import { DeepSeekClient } from "../src/client.js";
import { CacheFirstLoop } from "../src/loop.js";
import { ImmutablePrefix } from "../src/memory/runtime.js";

describe("CacheFirstLoop client reload", () => {
  it("replaces the provider client without rebuilding loop state", () => {
    const initial = new DeepSeekClient({ apiKey: "sk-initial" });
    const replacement = new DeepSeekClient({
      apiKey: "sk-replacement",
      baseUrl: "https://provider.example.com/",
    });
    const loop = new CacheFirstLoop({
      client: initial,
      prefix: new ImmutablePrefix({ system: "test" }),
      session: null,
    });
    loop.appendAndPersist({ role: "user", content: "keep me" });

    loop.replaceClient(replacement);

    expect(loop.client).toBe(replacement);
    expect(loop.client.baseUrl).toBe("https://provider.example.com");
    expect(loop.log.entries).toEqual([{ role: "user", content: "keep me" }]);
  });
});
