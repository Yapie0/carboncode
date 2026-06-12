/** Hardcoded: fetching this list at runtime would make `mcp list` flaky offline / behind proxies. */

export interface CatalogEntry {
  /** Short name, used as the namespace prefix when suggested. */
  name: string;
  /** One-line description shown in `carboncode mcp list`. */
  summary: string;
  /** Built-in entries are served by Carbon Code itself instead of `npx -y <pkg>`. */
  kind?: "npm" | "builtin";
  /** npm package id, for `npx -y <pkg>` entries. */
  package?: string;
  /** Extra args the user must supply, e.g. a directory path. */
  userArgs?: string;
  /** Notes the user needs to know, shown dimmed. */
  note?: string;
}

// Every npm entry below is verified to exist on npm as of this release.
// `fetch` and `sqlite` are deliberately absent: their reference servers are
// Python-only, so a Node user running `npx -y @modelcontextprotocol/server-fetch`
// hits a 404 from the npm registry.
export const MCP_CATALOG: CatalogEntry[] = [
  {
    name: "mwh",
    kind: "builtin",
    summary: "Carbon Code Middlewave Hub reusable middleware library",
    note: "built into Carbon Code; stores reusable module references under .carboncode/mwh",
  },
  {
    name: "filesystem",
    kind: "npm",
    summary: "read/write/search files inside a sandboxed directory",
    package: "@modelcontextprotocol/server-filesystem",
    userArgs: "<dir>",
    note: "the directory is a hard sandbox; the server refuses access outside it",
  },
  {
    name: "memory",
    kind: "npm",
    summary: "persistent key-value memory across sessions",
    package: "@modelcontextprotocol/server-memory",
  },
  {
    name: "github",
    kind: "npm",
    summary: "read issues, PRs, code search (needs GITHUB_PERSONAL_ACCESS_TOKEN)",
    package: "@modelcontextprotocol/server-github",
    note: "set GITHUB_PERSONAL_ACCESS_TOKEN in your env before spawning",
  },
  {
    name: "playwright",
    kind: "npm",
    summary: "browser automation: navigate, click, fill, screenshot",
    package: "@playwright/mcp",
    note: "first run downloads a browser engine; pass --headless to run without a window",
  },
  {
    name: "everything",
    kind: "npm",
    summary: "official test server; exercises every MCP feature",
    package: "@modelcontextprotocol/server-everything",
    note: "useful for debugging your Carbon Code setup",
  },
];

export function mcpCommandFor(entry: CatalogEntry): string {
  return `--mcp "${buildCatalogSpec(entry, entry.userArgs ? [entry.userArgs] : [])}"`;
}

export function buildCatalogSpec(
  entry: CatalogEntry,
  userArgs: readonly string[] = [],
  name = entry.kind === "builtin" && entry.name === "mwh" ? "MiddlewaveHub" : entry.name,
): string {
  if (entry.kind === "builtin") {
    if (entry.name === "mwh") {
      const root = userArgs[0];
      return root
        ? `${name}=carboncode mwh mcp-server --root ${quoteIfNeeded(root)}`
        : `${name}=carboncode mwh mcp-server`;
    }
    throw new Error(`unknown built-in MCP catalog entry: ${entry.name}`);
  }
  if (!entry.package) throw new Error(`catalog entry ${entry.name} is missing package`);
  const tail = userArgs.length > 0 ? ` ${userArgs.map(quoteIfNeeded).join(" ")}` : "";
  return `${name}=npx -y ${entry.package}${tail}`;
}

export function quoteIfNeeded(s: string): string {
  return /\s|"/.test(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s;
}
