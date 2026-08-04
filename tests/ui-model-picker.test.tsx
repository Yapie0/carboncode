import { render } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { ModelPicker, type ModelPickerOutcome } from "../src/cli/ui/ModelPicker.js";
import {
  type KeystrokeHandler,
  KeystrokeProvider,
  type KeystrokeReader,
  makeKeyEvent,
} from "../src/cli/ui/keystroke-context.js";
import type { KeyEvent } from "../src/cli/ui/stdin-reader.js";
import { makeFakeStdin, makeFakeStdout } from "./helpers/ink-stdio.js";

class FakeReader implements KeystrokeReader {
  private readonly handlers = new Set<KeystrokeHandler>();

  start(): void {
    // no-op
  }

  subscribe(handler: KeystrokeHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  feed(event: Partial<KeyEvent>): void {
    for (const handler of [...this.handlers]) handler(makeKeyEvent(event));
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function renderPicker(props: {
  models: ReadonlyArray<string> | null;
  current: string;
  profiles?: ReadonlyArray<{
    id: string;
    provider: "deepseek" | "openai";
    model: string;
    baseUrl?: string;
  }>;
  activeProfileId?: string;
  currentEffort?: "high" | "max";
  currentAutoEscalate?: boolean;
}): string {
  const stdout = makeFakeStdout();
  const { unmount } = render(
    React.createElement(ModelPicker, {
      models: props.models,
      profiles: props.profiles,
      activeProfileId: props.activeProfileId,
      current: props.current,
      currentEffort: props.currentEffort ?? "max",
      currentAutoEscalate: props.currentAutoEscalate ?? true,
      onChoose: () => {},
    }),
    { stdout: stdout as never, stdin: makeFakeStdin() as never },
  );
  unmount();
  return stdout.text();
}

describe("ModelPicker (#371)", () => {
  it("moves exactly one option for one Down keypress", async () => {
    const reader = new FakeReader();
    const outcomes: ModelPickerOutcome[] = [];
    const stdout = makeFakeStdout();
    const view = render(
      <KeystrokeProvider reader={reader}>
        <ModelPicker
          models={["deepseek-v4-flash"]}
          current="deepseek-v4-flash"
          currentEffort="max"
          currentAutoEscalate={true}
          onChoose={(outcome) => outcomes.push(outcome)}
        />
      </KeystrokeProvider>,
      { stdout: stdout as never, stdin: makeFakeStdin() as never },
    );
    await flush();

    reader.feed({ downArrow: true });
    await flush();
    reader.feed({ return: true });
    await flush();

    expect(outcomes).toEqual([{ kind: "preset", name: "flash" }]);
    view.unmount();
  });

  it("lists current API models and hides retired aliases", () => {
    const text = renderPicker({
      models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-reasoner"],
      current: "deepseek-v4-flash",
    });
    expect(text).toContain("deepseek-v4-flash");
    expect(text).toContain("deepseek-v4-pro");
    expect(text).not.toContain("deepseek-reasoner");
  });

  it("lists the three presets above the model list", () => {
    const text = renderPicker({
      models: ["deepseek-v4-flash"],
      current: "deepseek-v4-flash",
    });
    expect(text).toContain("PRESETS");
    expect(text).toContain("auto");
    expect(text).toContain("flash");
    expect(text).toContain("pro");
  });

  it("lists configured provider profiles and marks the active profile", () => {
    const text = renderPicker({
      models: ["gpt-5.5"],
      current: "gpt-5.5",
      profiles: [
        {
          id: "company-gpt",
          provider: "openai",
          model: "gpt-5.5",
          baseUrl: "https://relay.example/v1",
        },
      ],
      activeProfileId: "company-gpt",
    });
    expect(text).toContain("CONFIGURED PROFILES");
    expect(text).toContain("company-gpt");
    expect(text).toContain("openai/gpt-5.5");
    expect(text).toMatch(/company-gpt[\s\S]*current/);
  });

  it("marks the active preset with `current` when loop config matches", () => {
    const text = renderPicker({
      models: ["deepseek-v4-flash"],
      current: "deepseek-v4-flash",
      currentEffort: "max",
      currentAutoEscalate: true,
    });
    expect(text).toMatch(/auto[\s\S]*current/);
  });

  it("falls back to model `current` tag when loop config doesn't match any preset", () => {
    const text = renderPicker({
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      current: "deepseek-v4-pro",
      currentEffort: "high",
      currentAutoEscalate: true,
    });
    expect(text).toMatch(/deepseek-v4-pro[\s\S]*current/);
  });

  it("shows loading hint when catalog is null", () => {
    const text = renderPicker({ models: null, current: "deepseek-v4-flash" });
    expect(text).toContain("loading catalog");
  });

  it("falls back to the known DeepSeek ids when catalog is null so the picker isn't empty on first open", () => {
    const text = renderPicker({ models: null, current: "deepseek-v4-flash" });
    expect(text).toContain("deepseek-v4-flash");
    expect(text).toContain("deepseek-v4-pro");
  });

  it("shows the explicit empty hint when catalog loaded but is empty", () => {
    const text = renderPicker({ models: [], current: "deepseek-v4-flash" });
    expect(text).toContain("catalog empty");
  });

  it("includes the current id in the list even when API didn't return it (handles stale catalog)", () => {
    const text = renderPicker({
      models: ["deepseek-v4-flash"],
      current: "deepseek-experimental-x",
    });
    expect(text).toContain("deepseek-experimental-x");
  });

  it("renders the keybind hint footer", () => {
    const text = renderPicker({
      models: ["deepseek-v4-flash"],
      current: "deepseek-v4-flash",
    });
    expect(text).toContain("↑↓");
    expect(text).toContain("⏎");
    expect(text).toContain("esc");
  });
});
