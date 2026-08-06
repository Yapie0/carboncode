import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const initializeMock = vi.fn(async () => undefined);
  const closeMock = vi.fn(async () => undefined);
  const bridgeMcpToolsMock = vi.fn(async (_client: unknown, opts: any) => ({
    registeredNames: [],
    skipped: [],
    env: {
      registry: opts.registry,
      host: opts.host,
      prefix: opts.namePrefix ?? "",
      maxResultChars: 32_000,
      tracker: null,
    },
  }));
  const inspectMcpServerMock = vi.fn(async () => ({
    protocolVersion: "2024-11-05",
    serverInfo: { name: "fake", version: "1.0.0" },
    capabilities: { tools: {} },
    tools: { supported: true as const, items: [] },
    resources: { supported: false as const, reason: "method not found" },
    prompts: { supported: false as const, reason: "method not found" },
    elapsedMs: 1,
  }));
  const readConfigMock = vi.fn(() => ({ mcpDisabled: [] as string[] }));

  class FakeMcpClient {
    protocolVersion = "2024-11-05";
    serverInfo = { name: "fake", version: "1.0.0" };
    serverCapabilities = { tools: {} };
    async initialize() {
      return initializeMock();
    }
    async close() {
      return closeMock();
    }
  }

  class FakeTransport {}

  return {
    initializeMock,
    closeMock,
    bridgeMcpToolsMock,
    inspectMcpServerMock,
    readConfigMock,
    FakeMcpClient,
    FakeTransport,
  };
});

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return { ...actual, readConfig: mocks.readConfigMock };
});

vi.mock("../src/mcp/client.js", () => ({ McpClient: mocks.FakeMcpClient }));
vi.mock("../src/mcp/inspect.js", () => ({ inspectMcpServer: mocks.inspectMcpServerMock }));
vi.mock("../src/mcp/registry.js", () => ({ bridgeMcpTools: mocks.bridgeMcpToolsMock }));
vi.mock("../src/mcp/sse.js", () => ({ SseTransport: mocks.FakeTransport }));
vi.mock("../src/mcp/stdio.js", () => ({ StdioTransport: mocks.FakeTransport }));
vi.mock("../src/mcp/streamable-http.js", () => ({
  StreamableHttpTransport: mocks.FakeTransport,
}));

describe("createMcpRuntime — failure tracking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.initializeMock.mockReset();
    mocks.bridgeMcpToolsMock.mockClear();
    mocks.readConfigMock.mockReset();
  });

  async function buildRuntime(
    overrides: Partial<import("../src/cli/commands/mcp-runtime.js").RuntimeContext> = {},
  ) {
    const [{ createMcpRuntime }, { ToolRegistry }] = await Promise.all([
      import("../src/cli/commands/mcp-runtime.js"),
      import("../src/tools.js"),
    ]);
    const tools = new ToolRegistry();
    return createMcpRuntime({
      getTools: () => tools,
      getMcpPrefix: () => undefined,
      getRequestedCount: () => 1,
      progressSink: { current: null },
      ...overrides,
    });
  }

  it("forwards the provider tool budget to every MCP bridge", async () => {
    mocks.readConfigMock.mockReturnValue({ mcpDisabled: [] });
    const runtime = await buildRuntime({ maxTools: 128 });

    await runtime.addSpec("ctx7=streamable+https://example.test/mcp");

    expect(mocks.bridgeMcpToolsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxTools: 128 }),
    );
  });

  it("applies the configured server selector during reload", async () => {
    mocks.readConfigMock.mockReturnValue({
      mcp: ["keep=streamable+https://keep.test/mcp", "drop=streamable+https://drop.test/mcp"],
    });
    const runtime = await buildRuntime({
      selectConfiguredSpecs: (specs) => specs.filter((spec) => spec.startsWith("keep=")),
    });

    await runtime.reloadFromConfig();

    expect(runtime.specs()).toEqual(["keep=streamable+https://keep.test/mcp"]);
  });

  it("records a failure entry when initialize() throws", async () => {
    mocks.readConfigMock.mockReturnValue({ mcpDisabled: [] });
    mocks.initializeMock.mockImplementation(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:1");
    });
    const runtime = await buildRuntime();
    const spec = "ctx7=streamable+https://server.smithery.ai/@example/ctx7";

    const result = await runtime.addSpec(spec);

    expect(result.ok).toBe(false);
    expect(runtime.failures()).toEqual([
      expect.objectContaining({
        spec,
        name: "ctx7",
        reason: "ECONNREFUSED 127.0.0.1:1",
      }),
    ]);
  });

  it("clears a prior failure when a later addSpec succeeds", async () => {
    mocks.readConfigMock.mockReturnValue({ mcpDisabled: [] });
    mocks.initializeMock.mockImplementationOnce(async () => {
      throw new Error("transient");
    });
    mocks.initializeMock.mockImplementation(async () => undefined);
    const runtime = await buildRuntime();
    const spec = "ctx7=streamable+https://example.test/mcp";

    const firstResult = await runtime.addSpec(spec);
    expect(firstResult.ok).toBe(false);
    expect(runtime.failures()).toHaveLength(1);

    const secondResult = await runtime.addSpec(spec);
    expect(secondResult.ok).toBe(true);
    expect(runtime.failures()).toEqual([]);
  });

  it("clears a failure when removeSpec runs", async () => {
    mocks.readConfigMock.mockReturnValue({ mcpDisabled: [] });
    mocks.initializeMock.mockImplementation(async () => {
      throw new Error("boom");
    });
    const runtime = await buildRuntime();
    const spec = "ctx7=streamable+https://example.test/mcp";

    await runtime.addSpec(spec);
    expect(runtime.failures()).toHaveLength(1);

    await runtime.removeSpec(spec);
    expect(runtime.failures()).toEqual([]);
  });
});
