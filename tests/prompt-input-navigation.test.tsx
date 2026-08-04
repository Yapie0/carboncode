import { render } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { PromptInput } from "../src/cli/ui/PromptInput.js";
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

async function mountInput(
  reader: FakeReader,
  arrowKeysHandledExternally: boolean,
  onHistoryPrev: () => void,
  onHistoryNext: () => void,
): Promise<ReturnType<typeof render>> {
  const view = render(
    <KeystrokeProvider reader={reader}>
      <PromptInput
        value="/model "
        onChange={() => undefined}
        onSubmit={() => undefined}
        onHistoryPrev={onHistoryPrev}
        onHistoryNext={onHistoryNext}
        arrowKeysHandledExternally={arrowKeysHandledExternally}
      />
    </KeystrokeProvider>,
    { stdout: makeFakeStdout() as never, stdin: makeFakeStdin() as never },
  );
  await flush();
  return view;
}

describe("PromptInput completion navigation", () => {
  it("does not forward arrows when a completion menu already owns them", async () => {
    const reader = new FakeReader();
    let previousCalls = 0;
    let nextCalls = 0;
    const view = await mountInput(
      reader,
      true,
      () => previousCalls++,
      () => nextCalls++,
    );

    reader.feed({ upArrow: true });
    reader.feed({ downArrow: true });
    await flush();

    expect(previousCalls).toBe(0);
    expect(nextCalls).toBe(0);
    view.unmount();
  });

  it("keeps Ctrl+P/Ctrl+N handoff while external arrow navigation is active", async () => {
    const reader = new FakeReader();
    let previousCalls = 0;
    let nextCalls = 0;
    const view = await mountInput(
      reader,
      true,
      () => previousCalls++,
      () => nextCalls++,
    );

    reader.feed({ input: "p", ctrl: true });
    reader.feed({ input: "n", ctrl: true });
    await flush();

    expect(previousCalls).toBe(1);
    expect(nextCalls).toBe(1);
    view.unmount();
  });

  it("still hands arrows to prompt history when no completion menu is visible", async () => {
    const reader = new FakeReader();
    let previousCalls = 0;
    let nextCalls = 0;
    const view = await mountInput(
      reader,
      false,
      () => previousCalls++,
      () => nextCalls++,
    );

    reader.feed({ upArrow: true });
    reader.feed({ downArrow: true });
    await flush();

    expect(previousCalls).toBe(1);
    expect(nextCalls).toBe(1);
    view.unmount();
  });
});
