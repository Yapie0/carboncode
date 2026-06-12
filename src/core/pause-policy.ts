/** Shared editMode → auto-resolve rules so CLI TUI + Tauri desktop don't drift. */

import type { EditMode } from "../config.js";
import type { PauseRequest } from "./pause-gate.js";

/** Mirrors shell.ts's allowAll bypass: only review still pauses on checkpoints. */
export function shouldAutoResolveCheckpoint(editMode: EditMode): boolean {
  return editMode === "auto" || editMode === "yolo";
}

/** null = surface to user; non-null = resolve gate immediately with this verdict. */
export function autoResolveVerdict(req: PauseRequest, editMode: EditMode): unknown | null {
  if (req.kind === "plan_checkpoint" && shouldAutoResolveCheckpoint(editMode)) {
    return { type: "continue" };
  }
  // YOLO is a runtime bypass, not an allowlist mutation. Resolve as
  // run_once so it never pollutes on-disk permissions with transient
  // shell commands or paths.
  if (
    editMode === "yolo" &&
    (req.kind === "run_command" || req.kind === "run_background" || req.kind === "path_access")
  ) {
    return { type: "run_once" };
  }
  return null;
}
