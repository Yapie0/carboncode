import { parseMcpSpec } from "./spec.js";

export type McpToolProfile = "auto" | "full";

export interface McpToolProfileSelection {
  active: string[];
  skipped: string[];
}

const REDUNDANT_CODE_SERVER_NAMES = new Set(["filesystem", "everything"]);
const REDUNDANT_CODE_PACKAGES = new Set([
  "@modelcontextprotocol/server-filesystem",
  "@modelcontextprotocol/server-everything",
]);

/**
 * Code mode already owns a richer native filesystem surface. Its auto profile
 * also excludes the MCP SDK's everything test server. Full keeps every
 * configured server for compatibility and diagnostics.
 */
export function selectCodeMcpToolProfile(
  specs: readonly string[],
  profile: McpToolProfile = "auto",
): McpToolProfileSelection {
  if (profile === "full") return { active: [...specs], skipped: [] };

  const active: string[] = [];
  const skipped: string[] = [];
  for (const raw of specs) {
    if (isRedundantCodeServer(raw)) {
      skipped.push(mcpDisplayName(raw));
    } else {
      active.push(raw);
    }
  }
  return { active, skipped };
}

function isRedundantCodeServer(raw: string): boolean {
  try {
    const spec = parseMcpSpec(raw);
    if (spec.name && REDUNDANT_CODE_SERVER_NAMES.has(spec.name.toLowerCase())) return true;
    if (spec.transport !== "stdio") return false;
    return spec.args.some((arg) => REDUNDANT_CODE_PACKAGES.has(arg.toLowerCase()));
  } catch {
    return false;
  }
}

function mcpDisplayName(raw: string): string {
  try {
    const spec = parseMcpSpec(raw);
    if (spec.name) return spec.name;
    if (spec.transport === "stdio") {
      const pkg = spec.args.find((arg) => REDUNDANT_CODE_PACKAGES.has(arg.toLowerCase()));
      if (pkg)
        return (
          pkg
            .split("/")
            .at(-1)
            ?.replace(/^server-/, "") ?? pkg
        );
    }
  } catch {
    // Keep invalid specs visible to the normal MCP validation path.
  }
  return raw;
}
