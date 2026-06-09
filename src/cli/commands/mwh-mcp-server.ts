import { createInterface } from "node:readline";
import { MCP_PROTOCOL_VERSION } from "../../mcp/types.js";
import {
  checkInstalledMwhModules,
  checkMwhUpdates,
  deleteMwhModule,
  installMwhModule,
  listInstalledMwhModules,
  listMwhModules,
  mwhRoot,
  readMwhModule,
  searchMwhModules,
  updateMwhModule,
  writeMwhModule,
} from "../../mwh/index.js";
import type { MwhInstallOptions, MwhModule } from "../../mwh/types.js";
import { VERSION } from "../../version.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

type JsonRpcMessage =
  | { jsonrpc: "2.0"; id: string | number; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const TOOLS = [
  tool("mwh_list_modules", "R: list available reusable middleware modules.", {}),
  tool(
    "mwh_search_modules",
    "R: search available MWH modules by id, title, summary, source, or tags.",
    {
      query: { type: "string" },
    },
  ),
  tool("mwh_read_module", "R: read one MWH module. Installed local modules take precedence.", {
    id: { type: "string" },
  }),
  tool("mwh_list_installed", "R: list installed local MWH reference packages.", {}),
  tool("mwh_check_installed", "R: verify installed module hashes and detect local edits.", {}),
  tool("mwh_update_check", "R/U: dry-run update check. Does not mutate files.", {}),
  tool(
    "mwh_install_module",
    "C: install an available built-in/provider module into .carboncode/mwh.",
    {
      id: { type: "string" },
    },
  ),
  tool("mwh_create_module", "C: create a custom local MWH module reference package.", {
    id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    version: { type: "string" },
    content: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    sourceLabel: { type: "string" },
    sourceUrl: { type: "string" },
  }),
  tool("mwh_update_module", "U: update an installed MWH module reference package.", {
    id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    version: { type: "string" },
    content: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    sourceLabel: { type: "string" },
    sourceUrl: { type: "string" },
  }),
  tool("mwh_delete_module", "D: delete an installed MWH module. Requires confirm: true.", {
    id: { type: "string" },
    confirm: { type: "boolean" },
  }),
];

export interface MwhMcpServerOptions extends MwhInstallOptions {}

export function runMwhMcpServer(opts: MwhMcpServerOptions = {}): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    handleRequest(req, opts)
      .then((resp) => {
        if (resp) send(resp);
      })
      .catch((err) => {
        send({
          jsonrpc: "2.0",
          id: req.id ?? null,
          error: { code: -32603, message: `internal: ${(err as Error).message}` },
        });
      });
  });
  rl.on("close", () => process.exit(0));
}

async function handleRequest(
  req: JsonRpcRequest,
  opts: MwhMcpServerOptions,
): Promise<JsonRpcMessage | null> {
  const id = req.id ?? null;
  switch (req.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id: id ?? 0,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: "carboncode-mwh", version: VERSION },
          capabilities: { tools: { listChanged: false }, resources: {} },
          instructions:
            "Middlewave Hub exposes reusable middleware reference modules. CRUD tools only affect .carboncode/mwh, not project source code.",
        },
      };
    case "notifications/initialized":
      return null;
    case "tools/list":
      return { jsonrpc: "2.0", id: id ?? 0, result: { tools: TOOLS } };
    case "tools/call": {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const result = callMwhTool(params.name ?? "", params.arguments ?? {}, opts);
      return {
        jsonrpc: "2.0",
        id: id ?? 0,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    }
    case "resources/list":
      return {
        jsonrpc: "2.0",
        id: id ?? 0,
        result: {
          resources: listMwhModules().map((module) => ({
            uri: `mwh://modules/${module.id}`,
            name: module.id,
            description: module.summary,
            mimeType: "text/markdown",
          })),
        },
      };
    case "resources/read": {
      const uri = ((req.params ?? {}) as { uri?: string }).uri ?? "";
      const prefix = "mwh://modules/";
      if (!uri.startsWith(prefix)) {
        return {
          jsonrpc: "2.0",
          id: id ?? 0,
          result: { contents: [] },
        };
      }
      const module = readMwhModule(uri.slice(prefix.length), opts);
      return {
        jsonrpc: "2.0",
        id: id ?? 0,
        result: {
          contents: module ? [{ uri, mimeType: "text/markdown", text: module.content }] : [],
        },
      };
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${req.method}` },
      };
  }
}

function callMwhTool(
  name: string,
  args: Record<string, unknown>,
  opts: MwhMcpServerOptions,
): unknown {
  switch (name) {
    case "mwh_list_modules":
      return { root: mwhRoot(opts), modules: listMwhModules() };
    case "mwh_search_modules":
      return { modules: searchMwhModules(stringArg(args.query)) };
    case "mwh_read_module":
      return { module: readMwhModule(requiredString(args.id, "id"), opts) };
    case "mwh_list_installed":
      return { root: mwhRoot(opts), modules: listInstalledMwhModules(opts) };
    case "mwh_check_installed":
      return { root: mwhRoot(opts), results: checkInstalledMwhModules(opts) };
    case "mwh_update_check":
      return { root: mwhRoot(opts), results: checkMwhUpdates(opts) };
    case "mwh_install_module":
      return installMwhModule(requiredString(args.id, "id"), opts);
    case "mwh_create_module":
      return writeMwhModule(moduleFromArgs(args), opts);
    case "mwh_update_module":
      return updateMwhModule(requiredString(args.id, "id"), patchFromArgs(args), opts);
    case "mwh_delete_module":
      return deleteMwhModule(requiredString(args.id, "id"), {
        ...opts,
        confirm: args.confirm === true,
      });
    default:
      return { error: `unknown MWH MCP tool: ${name}` };
  }
}

function moduleFromArgs(args: Record<string, unknown>): MwhModule {
  return {
    id: requiredString(args.id, "id"),
    title: requiredString(args.title, "title"),
    summary: requiredString(args.summary, "summary"),
    version: requiredString(args.version, "version"),
    tags: arrayArg(args.tags),
    source: {
      kind: "external",
      label: stringArg(args.sourceLabel) || "MWH MCP",
      ...(stringArg(args.sourceUrl) ? { url: stringArg(args.sourceUrl) } : {}),
    },
    content: requiredString(args.content, "content"),
  };
}

function patchFromArgs(args: Record<string, unknown>): Partial<Omit<MwhModule, "id">> {
  return {
    ...(typeof args.title === "string" ? { title: args.title } : {}),
    ...(typeof args.summary === "string" ? { summary: args.summary } : {}),
    ...(typeof args.version === "string" ? { version: args.version } : {}),
    ...(Array.isArray(args.tags) ? { tags: arrayArg(args.tags) } : {}),
    ...(typeof args.content === "string" ? { content: args.content } : {}),
    ...(typeof args.sourceLabel === "string" || typeof args.sourceUrl === "string"
      ? {
          source: {
            kind: "external" as const,
            label: stringArg(args.sourceLabel) || "MWH MCP",
            ...(stringArg(args.sourceUrl) ? { url: stringArg(args.sourceUrl) } : {}),
          },
        }
      : {}),
  };
}

function tool(name: string, description: string, properties: Record<string, unknown>): unknown {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required: Object.entries(properties)
        .filter(([key]) => !["tags", "sourceLabel", "sourceUrl", "confirm"].includes(key))
        .map(([key]) => key),
    },
  };
}

function send(msg: JsonRpcMessage): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayArg(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
