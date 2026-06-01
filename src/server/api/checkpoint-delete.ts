import { deleteCheckpoint } from "../../code/checkpoints.js";
import type { DashboardContext } from "../context.js";
import type { ApiResult } from "../router.js";

export async function handleCheckpointDelete(
  method: string,
  _rest: string[],
  body: string,
  ctx: DashboardContext,
): Promise<ApiResult> {
  if (method !== "POST") return { status: 405, body: { error: "POST only" } };

  const rootDir = ctx.getCurrentCwd?.();
  if (!rootDir) return { status: 400, body: { error: "no active workspace" } };

  let parsed: { id?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: "invalid JSON" } };
  }
  if (typeof parsed.id !== "string" || !parsed.id) {
    return { status: 400, body: { error: "missing id" } };
  }

  const ok = deleteCheckpoint(rootDir, parsed.id);
  return ok
    ? { status: 200, body: { deleted: parsed.id } }
    : { status: 500, body: { error: "delete failed" } };
}
