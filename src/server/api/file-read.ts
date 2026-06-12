import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { DashboardContext } from "../context.js";
import type { ApiResult } from "../router.js";

const MAX_FILE_SIZE = 500 * 1024; // 500KB

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".pyc",
  ".o",
  ".obj",
]);

export async function handleFileRead(
  method: string,
  rest: string[],
  _body: string,
  ctx: DashboardContext,
): Promise<ApiResult> {
  if (method !== "GET") return { status: 405, body: { error: "GET only" } };

  let filePath: string;
  try {
    filePath = decodeURIComponent(rest.join("/"));
  } catch {
    return { status: 400, body: { error: "invalid file path encoding" } };
  }
  if (!filePath) return { status: 400, body: { error: "file path required" } };

  const cwd = ctx.getCurrentCwd?.();
  if (!cwd) return { status: 503, body: { error: "no project directory available" } };

  // Path traversal guard: normalize and ensure result stays under cwd.
  const resolved = resolve(join(cwd, filePath));
  const normalizedCwd = resolve(cwd);
  if (!resolved.startsWith(normalizedCwd + sep) && resolved !== normalizedCwd) {
    return { status: 403, body: { error: "path escapes workspace" } };
  }

  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return { status: 400, body: { error: "binary file not supported" } };
  }

  // Open once and use FD-based ops so inode is pinned — no TOCTOU window.
  let fd: number;
  try {
    fd = openSync(resolved, "r");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: 404, body: { error: `file not found: ${filePath}` } };
    }
    return { status: 500, body: { error: "cannot open file" } };
  }

  try {
    const st = fstatSync(fd);
    if (!st.isFile()) {
      return { status: 400, body: { error: "not a file" } };
    }
    if (st.size > MAX_FILE_SIZE) {
      return {
        status: 413,
        body: { error: `file too large (${st.size} bytes, max ${MAX_FILE_SIZE})` },
      };
    }
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    return { status: 200, body: { content: buf.toString("utf-8"), path: filePath, size: st.size } };
  } finally {
    closeSync(fd);
  }
}
