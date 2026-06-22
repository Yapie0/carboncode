import { describe, expect, it, vi } from "vitest";
import { handleTurnInterrupt } from "../src/cli/ui/turn-interrupt.js";

describe("handleTurnInterrupt", () => {
  it("clears a non-empty composer on Ctrl+C before aborting an active turn", () => {
    const resetPendingModals = vi.fn();
    const stopLoop = vi.fn();
    const abort = vi.fn();
    const quitProcess = vi.fn();
    const cleanupInterruptedTurn = vi.fn();
    const clearComposer = vi.fn();
    const resetComposerCursor = vi.fn();

    const outcome = handleTurnInterrupt("ctrl-c", {
      turnActiveRef: { current: true },
      abortedThisTurn: { current: false },
      resetPendingModals,
      isLoopActive: () => true,
      stopLoop,
      loop: { abort },
      quitProcess,
      cleanupInterruptedTurn,
      composerText: "draft reply",
      clearComposer,
      resetComposerCursor,
    });

    expect(outcome).toBe("cleared-input");
    expect(clearComposer).toHaveBeenCalledTimes(1);
    expect(resetComposerCursor).toHaveBeenCalledTimes(1);
    expect(resetPendingModals).not.toHaveBeenCalled();
    expect(stopLoop).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(cleanupInterruptedTurn).not.toHaveBeenCalled();
    expect(quitProcess).not.toHaveBeenCalled();
  });

  it("clears a non-empty composer on idle Ctrl+C instead of quitting", () => {
    const clearComposer = vi.fn();
    const resetComposerCursor = vi.fn();
    const quitProcess = vi.fn();

    const outcome = handleTurnInterrupt("ctrl-c", {
      turnActiveRef: { current: false },
      abortedThisTurn: { current: false },
      resetPendingModals: vi.fn(),
      isLoopActive: () => false,
      stopLoop: vi.fn(),
      loop: { abort: vi.fn() },
      quitProcess,
      composerText: "draft",
      clearComposer,
      resetComposerCursor,
    });

    expect(outcome).toBe("cleared-input");
    expect(clearComposer).toHaveBeenCalledTimes(1);
    expect(resetComposerCursor).toHaveBeenCalledTimes(1);
    expect(quitProcess).not.toHaveBeenCalled();
  });

  it("aborts an active Ctrl+C turn without quitting the process", () => {
    const resetPendingModals = vi.fn();
    const stopLoop = vi.fn();
    const abort = vi.fn();
    const quitProcess = vi.fn();
    const cleanupInterruptedTurn = vi.fn();
    const controller = {
      turnActiveRef: { current: true },
      abortedThisTurn: { current: false },
      resetPendingModals,
      isLoopActive: () => true,
      stopLoop,
      loop: { abort },
      quitProcess,
      cleanupInterruptedTurn,
    };

    expect(handleTurnInterrupt("ctrl-c", controller)).toBe("aborted");
    expect(handleTurnInterrupt("ctrl-c", controller)).toBe("already-aborted");
    expect(resetPendingModals).toHaveBeenCalledTimes(1);
    expect(stopLoop).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(cleanupInterruptedTurn).toHaveBeenCalledTimes(1);
    expect(quitProcess).not.toHaveBeenCalled();
  });

  it("quits on Ctrl+C when no model turn is active", () => {
    const resetPendingModals = vi.fn();
    const abort = vi.fn();
    const quitProcess = vi.fn();

    const outcome = handleTurnInterrupt("ctrl-c", {
      turnActiveRef: { current: false },
      abortedThisTurn: { current: false },
      resetPendingModals,
      isLoopActive: () => true,
      stopLoop: vi.fn(),
      loop: { abort },
      quitProcess,
    });

    expect(outcome).toBe("quit");
    expect(quitProcess).toHaveBeenCalledTimes(1);
    expect(resetPendingModals).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it("stops an idle auto-loop on Esc without aborting the next turn", () => {
    const resetPendingModals = vi.fn();
    const stopLoop = vi.fn();
    const abort = vi.fn();
    const quitProcess = vi.fn();

    const outcome = handleTurnInterrupt("escape", {
      turnActiveRef: { current: false },
      abortedThisTurn: { current: false },
      resetPendingModals,
      isLoopActive: () => true,
      stopLoop,
      loop: { abort },
      quitProcess,
    });

    expect(outcome).toBe("stopped-loop");
    expect(stopLoop).toHaveBeenCalledTimes(1);
    expect(resetPendingModals).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(quitProcess).not.toHaveBeenCalled();
  });

  it("ignores Esc during unrelated UI busy work", () => {
    const resetPendingModals = vi.fn();
    const abort = vi.fn();
    const quitProcess = vi.fn();

    const outcome = handleTurnInterrupt("escape", {
      turnActiveRef: { current: false },
      abortedThisTurn: { current: false },
      resetPendingModals,
      isLoopActive: () => false,
      stopLoop: vi.fn(),
      loop: { abort },
      quitProcess,
    });

    expect(outcome).toBe("idle");
    expect(resetPendingModals).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
    expect(quitProcess).not.toHaveBeenCalled();
  });
});
