/** Plain-text (not Ink) — must work when everything else is broken. fail → exit 1; warn → exit 0. */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DeepSeekClient, pickPrimaryBalance } from "../../client.js";
import {
  defaultConfigPath,
  loadActiveModelProvider,
  readConfig,
  resolveSemanticEmbeddingConfig,
  resolveSemanticOllamaModelEnv,
} from "../../config.js";
import { loadDotenv } from "../../env.js";
import { loadHooks } from "../../hooks.js";
import { t } from "../../i18n/index.js";
import {
  INDEX_DIR_NAME,
  LEGACY_INDEX_DIR_NAME,
  indexExists,
} from "../../index/semantic/builder.js";
import { checkOllamaStatus } from "../../index/semantic/ollama-launcher.js";
import { listSessions } from "../../memory/session.js";
import { detectProxyUrl } from "../../net/proxy.js";
import { providerClientOptions } from "../../provider-client-options.js";
import { resolveDataPath } from "../../tokenizer.js";
import { VERSION } from "../../version.js";

export type DoctorLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  level: DoctorLevel;
  detail: string;
  /** Actionable "how to fix" hint, set for warn/fail checks (see remediationFor). */
  remediation?: string;
}

// Map a warn/fail check id to a concrete next step. ok checks get none.
function remediationFor(c: DoctorCheck): string | undefined {
  if (c.level === "ok") return undefined;
  switch (c.id) {
    case "apiKey":
      return t("doctorRemediation.apiKey");
    case "config":
      return t("doctorRemediation.config");
    case "apiReach":
      return t("doctorRemediation.apiReach");
    case "tokenizer":
      return t("doctorRemediation.tokenizer");
    case "sessions":
      return t("doctorRemediation.sessions");
    case "semantic":
      return t("doctorRemediation.semantic");
    case "hooks":
      return t("doctorRemediation.hooks");
    case "project":
      return t("doctorRemediation.project");
    default:
      return undefined;
  }
}

export interface DoctorOptions {
  json?: boolean;
}

type Level = DoctorLevel;
type Check = DoctorCheck;
type DoctorLabelKey =
  | "apiKey"
  | "config"
  | "proxy"
  | "apiReach"
  | "tokenizer"
  | "sessions"
  | "hooks"
  | "semantic"
  | "project";

export async function runDoctorChecks(projectRoot: string): Promise<DoctorCheck[]> {
  const checks = await Promise.all([
    checkApiKey(),
    checkConfig(),
    checkProxy(),
    checkApiReach(),
    checkTokenizer(),
    checkSessions(),
    checkHooks(projectRoot),
    checkOllama(projectRoot),
    checkProject(projectRoot),
  ]);
  return checks.map((c) => {
    const remediation = remediationFor(c);
    return remediation ? { ...c, remediation } : c;
  });
}

function checkProxy(): Check {
  const url = detectProxyUrl();
  if (!url) {
    return {
      id: "proxy",
      label: doctorLabel("proxy"),
      level: "ok",
      detail: t("doctorReport.details.proxyDirect"),
    };
  }
  let redacted = url;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
      redacted = u.toString();
    }
  } catch {
    /* not a URL — leave raw */
  }
  return {
    id: "proxy",
    label: doctorLabel("proxy"),
    level: "ok",
    detail: t("doctorReport.details.proxyRouting", { url: redacted }),
  };
}

const TTY = process.stdout.isTTY && process.env.TERM !== "dumb";

function color(text: string, code: string): string {
  if (!TTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function badge(level: Level): string {
  if (level === "ok") return color("✓", "32");
  if (level === "warn") return color("⚠", "33");
  return color("✗", "31");
}

function tail4(s: string): string {
  return s.length <= 4 ? s : `…${s.slice(-4)}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function doctorLabel(key: DoctorLabelKey): string {
  return t(`doctorReport.labels.${key}`).padEnd(12);
}

async function checkApiKey(): Promise<Check> {
  const fromEnv = process.env.DEEPSEEK_API_KEY;
  if (fromEnv) {
    return {
      id: "api-key",
      label: doctorLabel("apiKey"),
      level: "ok",
      detail: t("doctorReport.details.apiKeyEnv", { tail: tail4(fromEnv) }),
    };
  }
  try {
    const cfg = readConfig();
    if (cfg.apiKey) {
      return {
        id: "api-key",
        label: doctorLabel("apiKey"),
        level: "ok",
        detail: t("doctorReport.details.apiKeyConfig", {
          path: defaultConfigPath(),
          tail: tail4(cfg.apiKey),
        }),
      };
    }
  } catch {
    /* fall through */
  }
  return {
    id: "api-key",
    label: doctorLabel("apiKey"),
    level: "fail",
    detail: t("doctorReport.details.apiKeyMissing"),
  };
}

async function checkConfig(): Promise<Check> {
  const path = defaultConfigPath();
  if (!existsSync(path)) {
    return {
      id: "config",
      label: doctorLabel("config"),
      level: "warn",
      detail: t("doctorReport.details.configMissing"),
    };
  }
  try {
    const cfg = readConfig(path);
    const parts: string[] = [];
    if (cfg.preset) parts.push(`preset=${cfg.preset}`);
    if (cfg.editMode) parts.push(`editMode=${cfg.editMode}`);
    if (cfg.mcp && cfg.mcp.length > 0) parts.push(`mcp=${cfg.mcp.length}`);
    return {
      id: "config",
      label: doctorLabel("config"),
      level: "ok",
      detail: `${path}${parts.length ? ` (${parts.join(", ")})` : ""}`,
    };
  } catch (err) {
    return {
      id: "config",
      label: doctorLabel("config"),
      level: "fail",
      detail: t("doctorErrors.unreadable", { path, message: (err as Error).message }),
    };
  }
}

async function checkApiReach(): Promise<Check> {
  const provider = loadActiveModelProvider();
  const key = provider.apiKey;
  if (!key) {
    return {
      id: "api-reach",
      label: doctorLabel("apiReach"),
      level: "warn",
      detail: t("doctorReport.details.apiReachSkipped"),
    };
  }
  try {
    const client = new DeepSeekClient(providerClientOptions(provider, { apiKey: key }));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8_000);
    if (provider.kind === "custom") {
      try {
        const catalog = await client.listModels({ signal: ctl.signal });
        if (!catalog || catalog.data.length === 0) {
          return {
            id: "api-reach",
            label: doctorLabel("apiReach"),
            level: "fail",
            detail: `${provider.name}: model catalog is unavailable or empty.`,
          };
        }
        return {
          id: "api-reach",
          label: doctorLabel("apiReach"),
          level: "ok",
          detail: `${provider.name}: ${catalog.data.length} models available.`,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    let balance: Awaited<ReturnType<DeepSeekClient["getBalance"]>>;
    try {
      balance = await client.getBalance({ signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!balance) {
      return {
        id: "api-reach",
        label: doctorLabel("apiReach"),
        level: "fail",
        detail: t("doctorReport.details.apiReachNull"),
      };
    }
    const summary = summarizeBalances(balance.balance_infos);
    if (!balance.is_available) {
      return {
        id: "api-reach",
        label: doctorLabel("apiReach"),
        level: "warn",
        detail: t("doctorReport.details.apiReachUnavailable", { summary }),
      };
    }
    return {
      id: "api-reach",
      label: doctorLabel("apiReach"),
      level: "ok",
      detail: summary
        ? t("doctorReport.details.apiReachOkWithBalance", { summary })
        : t("doctorReport.details.apiReachOk"),
    };
  } catch (err) {
    return {
      id: "api-reach",
      label: doctorLabel("apiReach"),
      level: "fail",
      detail: `${(err as Error).message}`,
    };
  }
}

function summarizeBalances(
  infos: ReadonlyArray<{ currency: string; total_balance: string }>,
): string {
  if (infos.length === 0) return "";
  const primary = pickPrimaryBalance(infos);
  if (infos.length === 1 || !primary)
    return primary ? `${primary.total_balance} ${primary.currency}` : "";
  const rest = infos.filter((i) => i !== primary).map((i) => `${i.total_balance} ${i.currency}`);
  return `${primary.total_balance} ${primary.currency} + ${rest.join(" + ")}`;
}

async function checkTokenizer(): Promise<Check> {
  // Reuse the runtime's resolver so the doctor never disagrees with what
  // the tokenizer actually loads — three candidates including a global
  // npm install probe via createRequire.
  const path = resolveDataPath();
  if (existsSync(path)) {
    try {
      const stat = statSync(path);
      return {
        id: "tokenizer",
        label: doctorLabel("tokenizer"),
        level: "ok",
        detail: `${path} (${fmtBytes(stat.size)})`,
      };
    } catch {
      /* fall through to warn */
    }
  }
  return {
    id: "tokenizer",
    label: doctorLabel("tokenizer"),
    level: "warn",
    detail: t("doctorReport.details.tokenizerMissing"),
  };
}

async function checkSessions(): Promise<Check> {
  try {
    const list = listSessions();
    if (list.length === 0) {
      return {
        id: "sessions",
        label: doctorLabel("sessions"),
        level: "ok",
        detail: t("doctorReport.details.sessionsZero"),
      };
    }
    const totalBytes = list.reduce((s, e) => s + e.size, 0);
    const oldest = list[list.length - 1]!;
    const ageDays = Math.floor((Date.now() - oldest.mtime.getTime()) / (24 * 60 * 60 * 1000));
    const stale = list.filter(
      (e) => Date.now() - e.mtime.getTime() >= 90 * 24 * 60 * 60 * 1000,
    ).length;
    const detail = t("doctorReport.details.sessionsSummary", {
      count: list.length,
      size: fmtBytes(totalBytes),
      days: ageDays,
    });
    if (stale > 0) {
      return {
        id: "sessions",
        label: doctorLabel("sessions"),
        level: "warn",
        detail: t("doctorReport.details.sessionsStale", { detail, stale }),
      };
    }
    return { id: "sessions", label: doctorLabel("sessions"), level: "ok", detail };
  } catch (err) {
    return {
      id: "sessions",
      label: doctorLabel("sessions"),
      level: "warn",
      detail: t("doctorErrors.cannotList", { message: (err as Error).message }),
    };
  }
}

async function checkHooks(projectRoot: string): Promise<Check> {
  try {
    const all = loadHooks({ projectRoot });
    const global = all.filter((h) => h.scope === "global").length;
    const project = all.filter((h) => h.scope === "project").length;
    return {
      id: "hooks",
      label: doctorLabel("hooks"),
      level: "ok",
      detail: t("doctorReport.details.hooksSummary", { global, project }),
    };
  } catch (err) {
    return {
      id: "hooks",
      label: doctorLabel("hooks"),
      level: "warn",
      detail: t("doctorErrors.parseFailed", { message: (err as Error).message }),
    };
  }
}

async function checkOllama(projectRoot: string): Promise<Check> {
  let exists = false;
  try {
    exists = await indexExists(projectRoot);
  } catch {
    /* treat as no index */
  }
  if (!exists) {
    return {
      id: "semantic",
      label: doctorLabel("semantic"),
      level: "ok",
      detail: t("doctorReport.details.semanticNoIndex"),
    };
  }
  const meta = readSemanticMeta(projectRoot);
  if (meta?.provider === "openai-compat") {
    const resolved = resolveSemanticEmbeddingConfig();
    if (resolved.provider !== "openai-compat") {
      return {
        id: "semantic",
        label: doctorLabel("semantic"),
        level: "warn",
        detail: t("doctorReport.details.semanticMismatch", {
          indexProvider: "openai-compat",
          indexModel: meta.model,
          configProvider: resolved.provider,
          configModel: resolved.model,
        }),
      };
    }
    return {
      id: "semantic",
      label: doctorLabel("semantic"),
      level: "ok",
      detail: t("doctorReport.details.semanticOpenaiOk", {
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      }),
    };
  }
  try {
    const model = meta?.model || resolveSemanticOllamaModelEnv() || "nomic-embed-text";
    const status = await checkOllamaStatus(model);
    if (!status.binaryFound) {
      return {
        id: "semantic",
        label: doctorLabel("semantic"),
        level: "warn",
        detail: t("doctorReport.details.semanticOllamaMissing"),
      };
    }
    if (!status.daemonRunning) {
      return {
        id: "semantic",
        label: doctorLabel("semantic"),
        level: "warn",
        detail: t("doctorReport.details.semanticOllamaStopped"),
      };
    }
    if (!status.modelPulled) {
      return {
        id: "semantic",
        label: doctorLabel("semantic"),
        level: "warn",
        detail: t("doctorReport.details.semanticOllamaModelMissing", {
          model: status.modelName,
        }),
      };
    }
    return {
      id: "semantic",
      label: doctorLabel("semantic"),
      level: "ok",
      detail: t("doctorReport.details.semanticOllamaReady", { model: status.modelName }),
    };
  } catch (err) {
    return {
      id: "semantic",
      label: doctorLabel("semantic"),
      level: "warn",
      detail: t("doctorErrors.probeFailed", { message: (err as Error).message }),
    };
  }
}

function readSemanticMeta(
  projectRoot: string,
): { provider: "ollama" | "openai-compat"; model: string } | null {
  for (const dir of [INDEX_DIR_NAME, LEGACY_INDEX_DIR_NAME]) {
    try {
      const raw = readFileSync(join(projectRoot, dir, "index.meta.json"), "utf8");
      const parsed = JSON.parse(raw) as { provider?: string; model?: string };
      return {
        provider: parsed.provider === "openai-compat" ? "openai-compat" : "ollama",
        model: typeof parsed.model === "string" ? parsed.model : "",
      };
    } catch {
      /* try the next known index directory */
    }
  }
  return null;
}

async function checkProject(projectRoot: string): Promise<Check> {
  // Heuristic: a "real" project has either .git, AGENTS.md/CARBON.md, or
  // package.json. Lacking all three, `carboncode code` still works but
  // @-mentions and the project-memory pin won't surface much.
  const markers = [
    ".git",
    "AGENTS.md",
    "CARBON.md",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
  ];
  const found = markers.filter((m) => existsSync(join(projectRoot, m)));
  if (found.length === 0) {
    return {
      id: "project",
      label: doctorLabel("project"),
      level: "warn",
      detail: t("doctorReport.details.projectMissing", {
        path: projectRoot,
        markers: markers.slice(0, 3).join(", "),
      }),
    };
  }
  return {
    id: "project",
    label: doctorLabel("project"),
    level: "ok",
    detail: t("doctorReport.details.projectOk", { path: projectRoot, markers: found.join(", ") }),
  };
}

export function formatDoctorJson(checks: DoctorCheck[], version: string): string {
  const ok = checks.filter((c) => c.level === "ok").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  const fail = checks.filter((c) => c.level === "fail").length;
  return JSON.stringify({
    version,
    summary: { ok, warn, fail },
    checks: checks.map((c) => ({
      id: c.id,
      status: c.level,
      message: c.detail,
      ...(c.remediation ? { remediation: c.remediation } : {}),
    })),
  });
}

export async function doctorCommand(opts: DoctorOptions = {}): Promise<void> {
  loadDotenv();

  const projectRoot = resolve(process.cwd());
  const json = !!opts.json;

  if (!json) {
    console.log(`${color(`carboncode ${VERSION}  ·  doctor`, "1")}  (cwd: ${projectRoot})`);
    console.log(`  home: ${homedir()}`);
    console.log("");
  }

  // Run independent checks in parallel — saves ~5s when api-reach has
  // to time out. Each handler swallows its own throws into a `fail`
  // result so a thrown promise can't kill the whole report.
  const checks = await runDoctorChecks(projectRoot);

  const ok = checks.filter((c) => c.level === "ok").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  const fail = checks.filter((c) => c.level === "fail").length;

  if (json) {
    console.log(formatDoctorJson(checks, VERSION));
    if (fail > 0) process.exit(1);
    return;
  }

  for (const c of checks) {
    console.log(`  ${badge(c.level)}  ${c.label}  ${c.detail}`);
    if (c.remediation) console.log(`     ${color(`→ ${c.remediation}`, "2")}`);
  }

  console.log("");
  const summary = `${ok} ok · ${warn} warn · ${fail} fail`;
  if (fail > 0) {
    console.log(color(summary, "31"));
    process.exit(1);
  } else if (warn > 0) {
    console.log(color(summary, "33"));
  } else {
    console.log(color(summary, "32"));
  }
}
