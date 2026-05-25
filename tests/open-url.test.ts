import { afterEach, describe, expect, it } from "vitest";
import { openUrl } from "../src/cli/ui/open-url.js";

describe("openUrl", () => {
  const originalCi = process.env.CI;
  const originalCarbonNoOpen = process.env.CARBONCODE_NO_OPEN;
  const originalReasonixNoOpen = process.env.REASONIX_NO_OPEN;

  afterEach(() => {
    if (originalCi === undefined) Reflect.deleteProperty(process.env, "CI");
    else process.env.CI = originalCi;
    if (originalCarbonNoOpen === undefined)
      Reflect.deleteProperty(process.env, "CARBONCODE_NO_OPEN");
    else process.env.CARBONCODE_NO_OPEN = originalCarbonNoOpen;
    if (originalReasonixNoOpen === undefined)
      Reflect.deleteProperty(process.env, "REASONIX_NO_OPEN");
    else process.env.REASONIX_NO_OPEN = originalReasonixNoOpen;
  });

  it("does not open URLs in CI", () => {
    process.env.CI = "1";

    expect(openUrl("https://example.com")).toEqual({ opened: false, reason: "ci" });
  });

  it("respects CARBONCODE_NO_OPEN", () => {
    Reflect.deleteProperty(process.env, "CI");
    process.env.CARBONCODE_NO_OPEN = "1";

    expect(openUrl("https://example.com")).toEqual({ opened: false, reason: "disabled" });
  });

  it("keeps legacy REASONIX_NO_OPEN compatibility", () => {
    Reflect.deleteProperty(process.env, "CI");
    Reflect.deleteProperty(process.env, "CARBONCODE_NO_OPEN");
    process.env.REASONIX_NO_OPEN = "1";

    expect(openUrl("https://example.com")).toEqual({ opened: false, reason: "disabled" });
  });
});
