import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, arch as nodeArch, platform as nodePlatform } from "node:os";
import { join } from "node:path";
import {
  loadDiagnosticsEnabled,
  loadDiagnosticsEndpoint,
  saveDiagnosticsEnabled,
} from "./config.js";
import { VERSION } from "./version.js";

const SCHEMA_VERSION = 1;
const MAX_PENDING_EVENTS = 200;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_EVENTS = 20;
const MAX_MESSAGE_BYTES = 2 * 1024;
const MAX_STACK_BYTES = 12 * 1024;
const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 5 * 60_000;

const ALLOWED_CONTEXT_KEYS = new Set([
  "operation",
  "phase",
  "http_method",
  "http_status",
  "endpoint",
  "exit_code",
  "signal",
  "runtime_state",
  "error_origin",
  "panel",
  "retryable",
]);

export type DiagnosticSource = "cli" | "desktop";
export type DiagnosticSeverity = "error" | "fatal";

export interface DiagnosticReportInput {
  source?: DiagnosticSource;
  severity?: DiagnosticSeverity;
  category: string;
  component: string;
  errorCode?: string;
  error?: unknown;
  message?: string;
  stack?: string;
  context?: Record<string, unknown>;
}

interface QueuedDiagnosticEvent {
  event_id: string;
  occurred_at: string;
  source: DiagnosticSource;
  app_version: string;
  release_channel: string;
  os: string;
  arch: string;
  runtime: string;
  severity: DiagnosticSeverity;
  category: string;
  component: string;
  error_code: string;
  message: string;
  stack: string;
  context: Record<string, string | number | boolean | null>;
}

let flushInFlight: Promise<void> | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let retryDelayMs = INITIAL_RETRY_DELAY_MS;
let processHooksInstalled = false;

function diagnosticsEnabled(): boolean {
  const override = process.env.CARBONCODE_DIAGNOSTICS?.trim().toLowerCase();
  const explicitlyEnabled = override === "1" || override === "true" || override === "on";
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    if (!explicitlyEnabled) return false;
    const endpoint = process.env.CARBONCODE_DIAGNOSTICS_ENDPOINT?.trim();
    if (!endpoint) return false;
    try {
      if (new URL(endpoint).hostname.toLowerCase() === "code.ai6666.com") return false;
    } catch {
      return false;
    }
  }
  return loadDiagnosticsEnabled();
}

function diagnosticsRoot(): string {
  return (
    process.env.CARBONCODE_DIAGNOSTICS_DIR?.trim() || join(homedir(), ".carboncode", "diagnostics")
  );
}

function pendingDir(): string {
  return join(diagnosticsRoot(), "pending");
}

function installationIDPath(): string {
  return join(diagnosticsRoot(), "installation-id");
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not expose POSIX mode bits; the user profile ACL remains authoritative.
  }
}

function installationID(): string {
  const path = installationIDPath();
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
    ) {
      return existing;
    }
  } catch {
    // First run or a damaged identifier: replace it with a random pseudonymous ID.
  }
  ensurePrivateDirectory(diagnosticsRoot());
  const value = randomUUID();
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${value}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(temporary, path);
  } catch {
    rmSync(temporary, { force: true });
    try {
      const winner = readFileSync(path, "utf8").trim();
      if (winner) return winner;
    } catch {
      // Fall through and use this process's random value for the current upload.
    }
  }
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return value;
}

function normalizedOS(): string {
  switch (nodePlatform()) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    default:
      return nodePlatform();
  }
}

function normalizeIdentifier(value: string | undefined, fallback: string, max: number): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, max);
  return normalized || fallback;
}

function truncateUTF8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;
  return bytes
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\uFFFD+$/g, "");
}

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
}

function redactDiagnosticText(raw: unknown, maxBytes: number): string {
  let value =
    typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");
  const home = homedir();
  const cwd = process.cwd();
  for (const [needle, replacement] of [
    [home, "<home>"],
    [cwd, "<workspace>"],
  ] as const) {
    if (needle) value = value.split(needle).join(replacement);
  }
  value = stripControlCharacters(
    value
      .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
        const queryIndex = url.search(/[?#]/);
        return queryIndex >= 0 ? `${url.slice(0, queryIndex)}?<redacted>` : url;
      })
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***")
      .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/g, "<api-key>")
      .replace(
        /\b(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi,
        "$1=***",
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<email>")
      .replace(/[A-Z]:\\[^\r\n\t)]+/gi, "<local-path>")
      .replace(/(?:^|[\s(])\/(?:Users|home|tmp|var|opt|workspace)\/[^\r\n\t )]+/g, " <local-path>"),
  ).trim();
  return truncateUTF8(value, maxBytes);
}

function normalizeContext(
  input: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  if (!input) return output;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim().toLowerCase();
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    if (typeof rawValue === "string") output[key] = redactDiagnosticText(rawValue, 256);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === "boolean" || rawValue === null) output[key] = rawValue;
  }
  return output;
}

function eventFromInput(input: DiagnosticReportInput): QueuedDiagnosticEvent {
  const error = input.error instanceof Error ? input.error : undefined;
  const source = input.source ?? "cli";
  const desktopVersion = process.env.CARBONCODE_DESKTOP_VERSION?.trim();
  const message = redactDiagnosticText(
    input.message ?? error?.message ?? input.error,
    MAX_MESSAGE_BYTES,
  );
  const stack = redactDiagnosticText(input.stack ?? error?.stack ?? "", MAX_STACK_BYTES);
  return {
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    source,
    app_version: normalizeIdentifier(
      source === "desktop" && desktopVersion ? desktopVersion : VERSION,
      "unknown",
      64,
    ),
    release_channel: "stable",
    os: normalizeIdentifier(normalizedOS(), "unknown", 32),
    arch: normalizeIdentifier(nodeArch(), "unknown", 32),
    runtime: normalizeIdentifier(
      source === "desktop" && desktopVersion
        ? `desktop-cli-${VERSION}-node-${process.versions.node}`
        : `node-${process.versions.node}`,
      "node",
      64,
    ),
    severity: input.severity ?? "error",
    category: normalizeIdentifier(input.category, "unknown", 32),
    component: normalizeIdentifier(input.component, "unknown", 64),
    error_code: normalizeIdentifier(input.errorCode, "", 64),
    message: message || "An error occurred",
    stack,
    context: normalizeContext(input.context),
  };
}

function pendingFiles(): string[] {
  try {
    return readdirSync(pendingDir())
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}

function enforceQueueBounds(): void {
  const files = pendingFiles();
  let totalBytes = 0;
  const sized = files.map((name) => {
    const path = join(pendingDir(), name);
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      // A concurrent process already consumed it.
    }
    totalBytes += size;
    return { path, size };
  });
  while (sized.length > MAX_PENDING_EVENTS || totalBytes > MAX_PENDING_BYTES) {
    const oldest = sized.shift();
    if (!oldest) break;
    removePendingPath(oldest.path);
    totalBytes -= oldest.size;
  }
}

function queueEvent(event: QueuedDiagnosticEvent): void {
  ensurePrivateDirectory(pendingDir());
  const stamp = String(Date.now()).padStart(13, "0");
  const finalPath = join(pendingDir(), `${stamp}-${event.event_id}.json`);
  const temporary = `${finalPath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(event), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, finalPath);
  enforceQueueBounds();
}

function removePendingPath(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Multiple CLI/Desktop processes share the spool. On Windows another
    // process or antivirus may hold the file briefly; leaving it queued is
    // safe because the next flush is idempotent by event_id.
  }
}

function deletePendingFiles(files: readonly string[]): void {
  for (const file of files) removePendingPath(join(pendingDir(), file));
}

export function clearPendingDiagnostics(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryDelayMs = INITIAL_RETRY_DELAY_MS;
  deletePendingFiles(pendingFiles());
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = retryDelayMs;
  retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, retryDelayMs * 2);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushDiagnostics();
  }, delay);
  retryTimer.unref?.();
}

function resetRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryDelayMs = INITIAL_RETRY_DELAY_MS;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDiagnostics();
  }, 250);
  flushTimer.unref?.();
}

export function reportDiagnosticError(input: DiagnosticReportInput): string | null {
  if (!diagnosticsEnabled()) return null;
  try {
    const event = eventFromInput(input);
    queueEvent(event);
    scheduleFlush();
    return event.event_id;
  } catch {
    return null;
  }
}

export async function flushDiagnostics(timeoutMs = 5_000): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (flushInFlight) return flushInFlight;
  flushInFlight = flushDiagnosticsOnce(timeoutMs).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function flushDiagnosticsOnce(timeoutMs: number): Promise<void> {
  if (!diagnosticsEnabled()) {
    clearPendingDiagnostics();
    return;
  }
  while (true) {
    const files = pendingFiles().slice(0, MAX_BATCH_EVENTS);
    if (files.length === 0) {
      resetRetry();
      return;
    }
    const events: QueuedDiagnosticEvent[] = [];
    const validFiles: string[] = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(pendingDir(), file), "utf8"));
        if (parsed && typeof parsed === "object" && typeof parsed.event_id === "string") {
          events.push(parsed as QueuedDiagnosticEvent);
          validFiles.push(file);
        } else {
          removePendingPath(join(pendingDir(), file));
        }
      } catch {
        removePendingPath(join(pendingDir(), file));
      }
    }
    if (events.length === 0) continue;

    let response: Response;
    try {
      response = await fetch(loadDiagnosticsEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schema_version: SCHEMA_VERSION,
          installation_id: installationID(),
          events,
        }),
        signal: AbortSignal.timeout(Math.max(250, timeoutMs)),
      });
    } catch {
      scheduleRetry();
      return;
    }
    if (
      !(response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429))
    ) {
      scheduleRetry();
      return;
    }
    deletePendingFiles(validFiles);
    if (validFiles.some((file) => pendingFiles().includes(file))) {
      scheduleRetry();
      return;
    }
    resetRetry();
  }
}

export function setDiagnosticsEnabled(enabled: boolean): void {
  saveDiagnosticsEnabled(enabled);
  if (!enabled) clearPendingDiagnostics();
  else scheduleFlush();
}

export function installProcessDiagnostics(): void {
  if (processHooksInstalled) return;
  processHooksInstalled = true;
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    reportDiagnosticError({
      severity: "fatal",
      category: "process",
      component: "cli",
      errorCode: "UNCAUGHT_EXCEPTION",
      error,
      context: { error_origin: origin },
    });
  });
  void flushDiagnostics();
}
