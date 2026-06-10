import { execSync } from "node:child_process";
import type { ApiResult } from "../router.js";

// TODO(#618): Source is git diff HEAD — includes user's pre-session
// uncommitted changes. Read-only safe, but any "restore working tree to
// HEAD" feature must route through CheckpointStore so it doesn't clobber
// user's own changes.

export interface FileDiff {
  file: string;
  additions: number;
  deletions: number;
  patch?: string;
  status: "added" | "deleted" | "modified";
}

export function parseGitDiff(stdout: string): FileDiff[] {
  const files: FileDiff[] = [];
  // Split on diff --git headers
  const blocks = stdout.split(/\ndiff --git /).filter(Boolean);
  for (const block of blocks) {
    const fullBlock = block.startsWith("diff --git ") ? block : `diff --git ${block}`;
    // Extract file path from b/... line
    const bPath = fullBlock.match(/^diff --git a\/.+ b\/(.+)$/m)?.[1];
    if (!bPath) continue;

    // Extract the patch content (everything between diff --git and next diff --git, or EOF)
    // If split by \ndiff --git, the block content is already scoped
    const patchContent = block;

    // Count additions/deletions (skip +++/--- header lines)
    const additions = (patchContent.match(/^\+[^+]/gm) || []).length;
    const deletions = (patchContent.match(/^-[^-]/gm) || []).length;

    // Determine status (multiline flag so ^ matches start of any line)
    const isNew = /^new file mode/m.test(patchContent);
    const isDeleted = /^deleted file mode/m.test(patchContent);
    const status = isNew ? "added" : isDeleted ? "deleted" : "modified";

    files.push({
      file: bPath,
      additions,
      deletions,
      patch: fullBlock,
      status,
    });
  }
  return files;
}

export async function handleGitDiffs(
  method: string,
  _rest: string[],
  _body: string,
  _ctx: unknown,
): Promise<ApiResult> {
  if (method !== "GET") return { status: 405, body: { error: "GET only" } };

  let diffStdout: string;
  let stagedStdout: string;
  let untracked: string;
  try {
    diffStdout = execSync("git diff --no-color --unified=3 HEAD", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    stagedStdout = execSync("git diff --no-color --unified=3 --cached", {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    untracked = execSync("git ls-files --others --exclude-standard", {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    return { status: 200, body: [] };
  }

  const seen = new Set<string>();
  const allDiffs: FileDiff[] = [];

  // Parse modified diffs (working tree + staged)
  const combined = diffStdout + (stagedStdout ? `\n${stagedStdout}` : "");
  for (const f of parseGitDiff(combined)) {
    if (!seen.has(f.file)) {
      seen.add(f.file);
      allDiffs.push(f);
    }
  }

  // Add untracked files
  for (const file of untracked.split("\n").filter(Boolean)) {
    if (!seen.has(file)) {
      seen.add(file);
      allDiffs.push({
        file,
        additions: 0,
        deletions: 0,
        status: "added",
      });
    }
  }

  return { status: 200, body: allDiffs };
}
