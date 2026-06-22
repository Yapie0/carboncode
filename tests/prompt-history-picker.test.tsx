import { render } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { PromptHistoryPicker, filterPromptHistory } from "../src/cli/ui/PromptHistoryPicker.js";
import {
  type KeystrokeHandler,
  KeystrokeProvider,
  type KeystrokeReader,
  makeKeyEvent,
} from "../src/cli/ui/keystroke-context.js";
import { ViewportBudgetProvider } from "../src/cli/ui/layout/viewport-budget.js";
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

async function feed(reader: FakeReader, event: Partial<KeyEvent>): Promise<void> {
  reader.feed(event);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(
  reader: FakeReader,
  onChoose: (value: string) => void,
  onCancel: () => void,
  initialQuery = "",
): Promise<ReturnType<typeof render> & { stdout: ReturnType<typeof makeFakeStdout> }> {
  const stdout = makeFakeStdout();
  const view = render(
    <KeystrokeProvider reader={reader}>
      <ViewportBudgetProvider>
        <PromptHistoryPicker
          history={["fix tests", "add dashboard", "fix tests", "release package"]}
          initialQuery={initialQuery}
          onChoose={onChoose}
          onCancel={onCancel}
        />
      </ViewportBudgetProvider>
    </KeystrokeProvider>,
    { stdout: stdout as never, stdin: makeFakeStdin() as never },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { ...view, stdout };
}

describe("filterPromptHistory", () => {
  it("returns unique matches newest-first with case-insensitive search", () => {
    expect(
      filterPromptHistory(["Fix Tests", "add dashboard", "Fix Tests", "release tests"], "TESTS"),
    ).toEqual(["release tests", "Fix Tests"]);
  });
});

describe("PromptHistoryPicker", () => {
  it("filters typed text and fills the selected prompt on Enter", async () => {
    const reader = new FakeReader();
    const chosen: string[] = [];
    const view = await mount(
      reader,
      (value) => chosen.push(value),
      () => undefined,
    );
    await feed(reader, { input: "d" });
    await feed(reader, { input: "a" });
    await feed(reader, { return: true });

    expect(chosen).toEqual(["add dashboard"]);
    view.unmount();
  });

  it("cycles to the next match with Ctrl+R", async () => {
    const reader = new FakeReader();
    const chosen: string[] = [];
    const view = await mount(
      reader,
      (value) => chosen.push(value),
      () => undefined,
    );
    await feed(reader, { input: "r", ctrl: true });
    await feed(reader, { return: true });

    expect(chosen).toEqual(["fix tests"]);
    view.unmount();
  });

  it("keeps cancellation separate from choosing", async () => {
    const reader = new FakeReader();
    const chosen: string[] = [];
    let cancelled = 0;
    const view = await mount(
      reader,
      (value) => chosen.push(value),
      () => {
        cancelled++;
      },
      "release",
    );
    await feed(reader, { escape: true });

    expect(chosen).toEqual([]);
    expect(cancelled).toBe(1);
    view.unmount();
  });
});
