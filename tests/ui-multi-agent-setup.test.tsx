import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { MaskedInput } from "../src/cli/ui/MaskedInput.js";
import { MultiAgentSetup } from "../src/cli/ui/MultiAgentSetup.js";

describe("MultiAgentSetup", () => {
  it("starts with guided official and relay choices", () => {
    const { lastFrame, unmount } = render(
      <MultiAgentSetup configured={false} onClose={() => undefined} onSaved={() => undefined} />,
    );
    const frame = lastFrame() ?? "";
    unmount();

    expect(frame).toContain("OpenAI 官方");
    expect(frame).toContain("Responses 兼容中转站");
    expect(frame).toContain("自定义 Base URL 和模型");
  });

  it("can render a visible unmasked setup field", () => {
    const { lastFrame, unmount } = render(
      <MaskedInput
        value="https://relay.example/v1"
        onChange={() => undefined}
        onSubmit={() => undefined}
        mask=""
      />,
    );
    const frame = lastFrame() ?? "";
    unmount();

    expect(frame).toContain("https://relay.example/v1");
  });
});
