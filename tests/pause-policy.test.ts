import { describe, expect, it } from "vitest";
import { autoResolveVerdict } from "../src/core/pause-policy.js";

describe("pause auto-resolve policy", () => {
  it("auto-runs shell gates in yolo without persisting allowlist entries", () => {
    expect(
      autoResolveVerdict(
        { id: 1, kind: "run_command", payload: { command: "git push origin main" } },
        "yolo",
      ),
    ).toEqual({ type: "run_once" });
    expect(
      autoResolveVerdict(
        { id: 2, kind: "run_background", payload: { command: "npm run dev" } },
        "yolo",
      ),
    ).toEqual({ type: "run_once" });
  });

  it("keeps shell gates visible outside yolo", () => {
    expect(
      autoResolveVerdict(
        { id: 1, kind: "run_command", payload: { command: "git push origin main" } },
        "auto",
      ),
    ).toBeNull();
    expect(
      autoResolveVerdict(
        { id: 2, kind: "run_background", payload: { command: "npm run dev" } },
        "review",
      ),
    ).toBeNull();
  });
});
