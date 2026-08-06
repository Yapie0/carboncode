import type { ToolCallContext, ToolRegistry } from "../tools.js";
import type { JSONSchema } from "../types.js";
import type { McpTool } from "./types.js";

export const MCP_DIRECTORY_TOOL_NAME = "mcp_tools";

interface DirectoryEntry {
  name: string;
  originalName: string;
  server: string;
  category: string;
  description: string;
  parameters: JSONSchema;
}

interface DirectoryArgs {
  action: "list" | "search" | "describe" | "call";
  server?: string;
  category?: string;
  query?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

const DIRECTORY_PARAMETERS: JSONSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["list", "search", "describe", "call"],
      description:
        "list shows the server/category tree; search finds tools; describe returns one schema; call invokes an exact tool name.",
    },
    server: { type: "string", description: "Optional MCP server filter." },
    category: { type: "string", description: "Optional category filter for list/search." },
    query: { type: "string", description: "Search text for action=search." },
    name: { type: "string", description: "Exact qualified tool name for describe/call." },
    arguments: {
      type: "object",
      description: "Arguments passed to the selected MCP tool for action=call.",
      additionalProperties: true,
    },
    limit: { type: "integer", minimum: 1, maximum: 20, description: "Result page size." },
    offset: { type: "integer", minimum: 0, description: "Result page offset." },
  },
  required: ["action"],
};

const GENERIC_VERBS = new Set([
  "add",
  "call",
  "close",
  "create",
  "delete",
  "fetch",
  "find",
  "get",
  "list",
  "open",
  "read",
  "remove",
  "run",
  "search",
  "set",
  "update",
  "write",
]);

// Keeps the full MCP catalog callable behind one stable model-facing tool,
// avoiding provider tool-count limits and prefix-cache churn.
export class McpToolDirectory {
  private readonly entries = new Map<string, DirectoryEntry>();
  private attached = false;

  constructor(readonly registry: ToolRegistry) {}

  get size(): number {
    return this.entries.size;
  }

  /** Register the single model-facing directory tool. Returns true on first attach. */
  ensureAttached(): boolean {
    if (this.attached && this.registry.has(MCP_DIRECTORY_TOOL_NAME)) return false;
    this.registry.register<DirectoryArgs, unknown>({
      name: MCP_DIRECTORY_TOOL_NAME,
      description:
        "Discover and invoke MCP tools without loading every tool schema. Use list/search, then describe an exact tool, then call it. Prefer this for GitHub, browser automation, memory, and other MCP-server capabilities.",
      parameters: DIRECTORY_PARAMETERS,
      readOnlyCheck: (args) => args.action !== "call",
      fn: (args, ctx) => this.execute(args, ctx),
    });
    this.attached = true;
    return true;
  }

  /** Add searchable metadata for a hidden bridged tool. */
  record(tool: McpTool, qualifiedName: string, server: string): boolean {
    if (!tool.name || qualifiedName === MCP_DIRECTORY_TOOL_NAME) return false;
    const previous = this.entries.get(qualifiedName);
    if (previous) this.entries.delete(qualifiedName);
    this.entries.set(qualifiedName, {
      name: qualifiedName,
      originalName: tool.name,
      server,
      category: inferCategory(tool.name),
      description: tool.description ?? "",
      parameters: tool.inputSchema as JSONSchema,
    });
    return true;
  }

  unregister(name: string): boolean {
    const removed = this.entries.delete(name);
    this.registry.unregister(name);
    return removed;
  }

  /** Remove the model-facing entry when no MCP tools remain. */
  detachIfEmpty(): boolean {
    if (this.entries.size > 0 || !this.attached) return false;
    this.attached = false;
    return this.registry.unregister(MCP_DIRECTORY_TOOL_NAME);
  }

  private async execute(args: DirectoryArgs, ctx?: ToolCallContext): Promise<unknown> {
    switch (args.action) {
      case "list":
        return this.list(args);
      case "search":
        return this.search(args);
      case "describe":
        return this.describe(args.name);
      case "call":
        return this.call(args.name, args.arguments, ctx);
      default:
        return { error: `unknown action: ${String(args.action)}` };
    }
  }

  private list(args: DirectoryArgs): unknown {
    const entries = this.filtered(args.server, args.category);
    if (!args.server) {
      const servers = new Map<string, Map<string, number>>();
      for (const entry of entries) {
        const categories = servers.get(entry.server) ?? new Map<string, number>();
        categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
        servers.set(entry.server, categories);
      }
      return {
        total_tools: entries.length,
        servers: [...servers.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([server, categories]) => ({
            server,
            count: [...categories.values()].reduce((sum, count) => sum + count, 0),
            categories: [...categories.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, count]) => ({ category, count })),
          })),
        next: "Call list with server, optionally category, to browse tool names; or search by task.",
      };
    }
    return this.page(entries, args);
  }

  private search(args: DirectoryArgs): unknown {
    const query = args.query?.trim().toLowerCase();
    if (!query) return { error: "query is required for action=search" };
    const terms = query.split(/\s+/).filter(Boolean);
    const ranked = this.filtered(args.server, args.category)
      .map((entry) => ({ entry, score: scoreEntry(entry, query, terms) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
      .map((item) => item.entry);
    return this.page(ranked, args, query);
  }

  private describe(name: string | undefined): unknown {
    if (!name) return { error: "name is required for action=describe" };
    const entry = this.entries.get(name);
    if (!entry) return this.unknownName(name);
    return {
      name: entry.name,
      server: entry.server,
      category: entry.category,
      description: entry.description,
      parameters: entry.parameters,
      next: `Call ${MCP_DIRECTORY_TOOL_NAME} with action=call, name=${JSON.stringify(entry.name)}, and arguments matching parameters.`,
    };
  }

  private async call(
    name: string | undefined,
    args: Record<string, unknown> | undefined,
    ctx?: ToolCallContext,
  ): Promise<string | unknown> {
    if (!name) return { error: "name is required for action=call" };
    if (!this.entries.has(name)) return this.unknownName(name);
    const result = await this.registry.dispatch(name, args ?? {}, {
      signal: ctx?.signal,
      confirmationGate: ctx?.confirmationGate,
      onInteractiveWait: ctx?.onInteractiveWait,
    });
    return `MCP tool ${name} result:\n${result}`;
  }

  private filtered(server?: string, category?: string): DirectoryEntry[] {
    const serverNeedle = server?.trim().toLowerCase();
    const categoryNeedle = category?.trim().toLowerCase();
    return [...this.entries.values()].filter(
      (entry) =>
        (!serverNeedle || entry.server.toLowerCase() === serverNeedle) &&
        (!categoryNeedle || entry.category.toLowerCase() === categoryNeedle),
    );
  }

  private page(entries: DirectoryEntry[], args: DirectoryArgs, query?: string): unknown {
    const offset = clampInteger(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const limit = clampInteger(args.limit, 1, 20, 8);
    const page = entries.slice(offset, offset + limit);
    const nextOffset = offset + page.length < entries.length ? offset + page.length : null;
    return {
      ...(query ? { query } : {}),
      total: entries.length,
      offset,
      next_offset: nextOffset,
      tools: page.map((entry) => ({
        name: entry.name,
        server: entry.server,
        category: entry.category,
        description: entry.description,
        argument_keys: Object.keys(entry.parameters.properties ?? {}),
      })),
      next: page.length
        ? `Use action=describe with an exact name before action=call.${nextOffset === null ? "" : ` Continue with offset=${nextOffset}.`}`
        : "Try a broader query or list the server tree.",
    };
  }

  private unknownName(name: string): unknown {
    const query = name.toLowerCase();
    const suggestions = [...this.entries.values()]
      .map((entry) => ({ entry, score: scoreEntry(entry, query, [query]) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map((item) => item.entry.name);
    return { error: `unknown MCP tool: ${name}`, suggestions };
  }
}

function inferCategory(name: string): string {
  const parts = name
    .toLowerCase()
    .split(/[_./:-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "other";
  const index = GENERIC_VERBS.has(parts[0]!) && parts.length > 1 ? 1 : 0;
  if (parts[index] === "pull" && parts[index + 1] === "request") return "pull_request";
  if (parts[index] === "web" && parts[index + 1] === "page") return "web_page";
  return parts[index] ?? "other";
}

function scoreEntry(entry: DirectoryEntry, query: string, terms: string[]): number {
  const name = entry.name.toLowerCase();
  const original = entry.originalName.toLowerCase();
  const description = entry.description.toLowerCase();
  const server = entry.server.toLowerCase();
  const category = entry.category.toLowerCase();
  if (name === query || original === query) return 0;
  if (name.startsWith(query) || original.startsWith(query)) return 10;
  if (name.includes(query) || original.includes(query)) return 20;
  const haystack = `${name} ${original} ${server} ${category} ${description}`;
  if (!terms.every((term) => haystack.includes(term))) return Number.POSITIVE_INFINITY;
  let score = 100;
  for (const term of terms) {
    if (name.includes(term) || original.includes(term)) score -= 10;
    else if (server.includes(term) || category.includes(term)) score -= 5;
  }
  return score;
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}
