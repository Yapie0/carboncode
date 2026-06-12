import { resolve } from "node:path";
import { dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReasonixConfig } from "../config.js";
import { parseMcpSpec, specToRaw } from "../mcp/spec.js";

export const MIDDLEWAVE_HUB_MCP_NAME = "MiddlewaveHub";

export function appendBuiltinMwhMcpSpec(
  specs: readonly string[] | undefined,
  cfg: Pick<ReasonixConfig, "mcpDisabled">,
  projectRoot: string,
  entrypoint?: string,
): string[] {
  const out = [...(specs ?? [])];
  if (cfg.mcpDisabled?.some((name) => isBuiltinMwhMcpName(name))) return out;
  if (out.some((raw) => isBuiltinMwhMcpName(mcpSpecName(raw)))) return out;
  out.push(buildBuiltinMwhMcpSpec(projectRoot, entrypoint));
  return out;
}

export function buildBuiltinMwhMcpSpec(projectRoot: string, entrypoint?: string): string {
  void projectRoot;
  const entry = resolve(entrypoint ?? resolveCliEntrypoint());
  const args = entry.endsWith(".ts")
    ? ["--import", "tsx", entry, "mwh", "mcp-server"]
    : [entry, "mwh", "mcp-server"];
  return specToRaw({
    transport: "stdio",
    name: MIDDLEWAVE_HUB_MCP_NAME,
    command: process.execPath,
    args,
  });
}

function resolveCliEntrypoint(): string {
  const here = fileURLToPath(import.meta.url);
  const ext = extname(here) || ".js";
  return resolve(dirname(here), "..", "cli", `index${ext}`);
}

function isBuiltinMwhMcpName(name: string | null | undefined): boolean {
  return name === "mwh" || name === MIDDLEWAVE_HUB_MCP_NAME;
}

function mcpSpecName(raw: string): string | null {
  try {
    return parseMcpSpec(raw).name;
  } catch {
    return null;
  }
}
