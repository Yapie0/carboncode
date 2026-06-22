export type TurnInterruptKey = "escape" | "ctrl-c";
export type TurnInterruptOutcome =
  | "cleared-input"
  | "aborted"
  | "already-aborted"
  | "stopped-loop"
  | "idle"
  | "quit";

export interface TurnInterruptController {
  turnActiveRef: { readonly current: boolean };
  abortedThisTurn: { current: boolean };
  resetPendingModals: () => void;
  cleanupInterruptedTurn?: () => void;
  isLoopActive: () => boolean;
  stopLoop: () => void;
  loop: { abort: () => void };
  quitProcess: () => void;
  composerText?: string;
  clearComposer?: () => void;
  resetComposerCursor?: () => void;
}

export function handleTurnInterrupt(
  key: TurnInterruptKey,
  {
    turnActiveRef,
    abortedThisTurn,
    resetPendingModals,
    cleanupInterruptedTurn,
    isLoopActive,
    stopLoop,
    loop,
    quitProcess,
    composerText,
    clearComposer,
    resetComposerCursor,
  }: TurnInterruptController,
): TurnInterruptOutcome {
  if (key === "ctrl-c" && composerText && composerText.length > 0) {
    clearComposer?.();
    resetComposerCursor?.();
    return "cleared-input";
  }

  if (turnActiveRef.current) {
    if (abortedThisTurn.current) return "already-aborted";
    abortedThisTurn.current = true;
    resetPendingModals();
    cleanupInterruptedTurn?.();
    if (isLoopActive()) stopLoop();
    loop.abort();
    return "aborted";
  }

  if (key === "escape" && isLoopActive()) {
    stopLoop();
    return "stopped-loop";
  }

  if (key === "ctrl-c") {
    quitProcess();
    return "quit";
  }

  return "idle";
}
