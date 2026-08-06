import { render } from "ink";
import React, { useMemo, useState } from "react";
import {
  loadApiKey,
  loadMcpToolProfile,
  readConfig,
  searchEnabled,
  webSearchEndpoint,
  webSearchEngine,
} from "../../config.js";
import { loadDotenv } from "../../env.js";
import { t } from "../../i18n/index.js";
import { McpToolDirectory } from "../../mcp/tool-directory.js";
import { selectCodeMcpToolProfile } from "../../mcp/tool-profile.js";
import {
  deleteSession,
  freshSessionName,
  listSessionsForWorkspace,
  renameSession,
  resolveSession,
} from "../../memory/session.js";
import { DEEPSEEK_MAX_TOOLS, type ThinkingPreference, migrateRetiredModel } from "../../models.js";
import { QQChannel } from "../../qq/channel.js";
import { ToolRegistry } from "../../tools.js";
import { registerChoiceTool } from "../../tools/choice.js";
import { registerMemoryTools } from "../../tools/memory.js";
import { registerWebTools } from "../../tools/web.js";
import { stopAndSaveCpuProfile } from "../cpu-prof.js";
import { markPhase } from "../startup-profile.js";
import { createStartupUpdateCheck } from "../startup-update.js";
import { App } from "../ui/App.js";
import { SessionPicker } from "../ui/SessionPicker.js";
import { Setup } from "../ui/Setup.js";
import { drainTtyResponses } from "../ui/drain-tty.js";
import { KeystrokeProvider } from "../ui/keystroke-context.js";
import { collectStartupRuleFiles, formatRuleSummary } from "../ui/rule-summary.js";
import type { McpServerSummary } from "../ui/slash.js";
import {
  type McpLifecycleNotice,
  type McpLifecycleSink,
  type McpRuntime,
  type ProgressInfo,
  createMcpRuntime,
} from "./mcp-runtime.js";

export type { McpLifecycleNotice, McpLifecycleSink, McpRuntime, ProgressInfo };

export interface ChatOptions {
  model: string;
  /** Initial thinking preference, primarily used while migrating retired model aliases. */
  thinkingMode?: ThinkingPreference;
  system: string;
  /** Re-runs the prompt builder on /new so project-rule edits don't need a restart. Should produce the same string `system` was built from. */
  rebuildSystem?: () => string;
  transcript?: string;
  /**
   * Soft USD cap on session spend. Undefined → no cap (default).
   * The loop warns once at 80% and refuses to start a new turn at
   * 100%. Users can bump or clear via `/budget <usd>` / `/budget off`
   * mid-session.
   */
  budgetUsd?: number;
  session?: string;
  /** Zero or more MCP server specs. Each: `"name=cmd args..."` or `"cmd args..."`. */
  mcp?: string[];
  /** Global prefix — only used when a single anonymous server is given. */
  mcpPrefix?: string;
  /** MCP servers omitted by the active tool profile, surfaced once at startup. */
  mcpProfileSkipped?: string[];
  /**
   * Pre-built ToolRegistry used as a seed. MCP bridges (if any) are
   * layered on top of whatever's already registered. Used by
   * `carboncode code` to register native filesystem tools in place of
   * the old `npx -y @modelcontextprotocol/server-filesystem` subprocess.
   */
  seedTools?: ToolRegistry;
  /**
   * Enable SEARCH/REPLACE edit-block processing after each assistant turn.
   * Set by `carboncode code`; plain `carboncode chat` leaves this off.
   */
  codeMode?: {
    rootDir: string;
    jobs?: import("../../tools/jobs.js").JobRegistry;
    /**
     * `/cwd <path>` callback — re-registers every rootDir-dependent
     * native tool against the new path. Optional so embedders that
     * don't want live cwd switching can omit it (the slash command
     * then falls back to non-tool updates only).
     */
    reregisterTools?: (rootDir: string) => void;
    /** Async tail of `/cwd` — re-probe the new dir for a semantic index. */
    reBootstrapSemantic?: (rootDir: string) => Promise<{ enabled: boolean }>;
    /** Notify the launcher that the workspace root just changed — lets the rebuildSystem closure see the new dir. */
    onRootChange?: (newRoot: string) => void;
    /** `/add-dir <path>` — register an extra allowed root for file + shell tools. Returns the full root list or an error. */
    addDir?: (dir: string) => { roots: string[] } | { error: string };
    /** Current workspace roots (primary first, then /add-dir roots). */
    listRoots?: () => string[];
  };
  /** Skip the session picker — assume "Resume" (backwards-compatible auto-continue). */
  forceResume?: boolean;
  /** Skip the session picker — assume "New" (wipe the session file and start fresh). */
  forceNew?: boolean;
  /**
   * When true, suppress auto-launch of the embedded web dashboard.
   * Default behavior (false/undefined) is to boot it on mount so the
   * URL is visible in the status bar.
   */
  noDashboard?: boolean;
  /** When true and the dashboard is enabled, open its URL in the system default browser as soon as the server is ready. */
  openDashboard?: boolean;
  /** Pin the dashboard to a fixed port. `undefined` keeps ephemeral assignment. */
  dashboardPort?: number;
  /** Dashboard bind address (#968). `undefined` keeps the default 127.0.0.1. */
  dashboardHost?: string;
  /** Stable dashboard URL token (#968). `undefined` mints a fresh per-boot token. */
  dashboardToken?: string;
}

interface RootProps extends ChatOptions {
  initialKey: string | undefined;
  tools: ToolRegistry | undefined;
  mcpSpecs: string[];
  mcpServers: McpServerSummary[];
  /** App.tsx writes its progress handler here on mount so MCP frames flow into OngoingToolRow. */
  progressSink: { current: ((info: ProgressInfo) => void) | null };
  /** Show the SessionPicker (full list) when no --session was specified and saved sessions exist. */
  showPicker: boolean;
  /** Hot-reload runtime — passed through to App so /mcp browse + dashboard can bridge after install. */
  mcpRuntime: McpRuntime;
  /** One-time startup info rows shown after App mounts. */
  startupInfoHints: string[];
  /** Non-blocking startup update; App invokes it after first paint (auto-installs + streams notices). */
  startupUpdateCheck?: (notify: (message: string) => void) => Promise<void>;
  /** Pre-created QQ channel (started before TUI mounts). */
  qqChannel?: QQChannel;
  /** App fills this ref on mount so QQ messages flow into the TUI input queue. */
  qqSubmitRef: { current: ((text: string) => void) | null };
  /** App fills this ref on mount so QQ errors appear in the TUI log. */
  qqErrorRef: { current: ((msg: string) => void) | null };
}

function Root({
  initialKey,
  tools,
  mcpSpecs,
  mcpServers,
  progressSink,
  showPicker,
  mcpRuntime,
  startupInfoHints,
  startupUpdateCheck,
  ...appProps
}: RootProps) {
  const [key, setKey] = useState<string | undefined>(initialKey);
  const [pickerOpen, setPickerOpen] = useState(showPicker);
  const [activeSession, setActiveSession] = useState<string | undefined>(appProps.session);
  const [activeRoot, setActiveRoot] = useState<string>(
    () => appProps.codeMode?.rootDir ?? process.cwd(),
  );
  const workspaceRoot = activeRoot;
  const [sessions, setSessions] = useState(() => listSessionsForWorkspace(workspaceRoot));
  const codeMode = useMemo(() => {
    if (!appProps.codeMode) return undefined;
    return {
      ...appProps.codeMode,
      rootDir: activeRoot,
      onRootChange: (newRoot: string) => {
        appProps.codeMode?.onRootChange?.(newRoot);
        setActiveRoot(newRoot);
        setSessions(listSessionsForWorkspace(newRoot));
      },
    };
  }, [appProps.codeMode, activeRoot]);

  if (!key) {
    return (
      <KeystrokeProvider>
        <Setup
          onReady={(k) => {
            process.env.DEEPSEEK_API_KEY = k;
            setKey(k);
          }}
        />
      </KeystrokeProvider>
    );
  }
  process.env.DEEPSEEK_API_KEY = key;

  if (pickerOpen) {
    return (
      <KeystrokeProvider>
        <SessionPicker
          sessions={sessions}
          workspace={workspaceRoot}
          onChoose={(outcome) => {
            if (outcome.kind === "open") {
              setActiveSession(outcome.name);
              setPickerOpen(false);
              return;
            }
            if (outcome.kind === "new") {
              setActiveSession(freshSessionName(activeSession));
              setPickerOpen(false);
              return;
            }
            if (outcome.kind === "delete") {
              deleteSession(outcome.name);
              setSessions(listSessionsForWorkspace(workspaceRoot));
              return;
            }
            if (outcome.kind === "rename") {
              renameSession(outcome.name, outcome.newName);
              setSessions(listSessionsForWorkspace(workspaceRoot));
              return;
            }
            if (outcome.kind === "quit") {
              void (async () => {
                await stopAndSaveCpuProfile();
                process.exit(0);
              })();
            }
          }}
        />
      </KeystrokeProvider>
    );
  }

  return (
    <KeystrokeProvider>
      <App
        key={activeSession ?? "__new__"}
        model={appProps.model}
        thinkingMode={appProps.thinkingMode}
        system={appProps.system}
        rebuildSystem={appProps.rebuildSystem}
        transcript={appProps.transcript}
        budgetUsd={appProps.budgetUsd}
        session={activeSession}
        tools={tools}
        mcpSpecs={mcpSpecs}
        mcpServers={mcpServers}
        mcpRuntime={mcpRuntime}
        progressSink={progressSink}
        startupInfoHints={startupInfoHints}
        startupUpdateCheck={startupUpdateCheck}
        codeMode={codeMode}
        noDashboard={appProps.noDashboard}
        openDashboard={appProps.openDashboard}
        dashboardPort={appProps.dashboardPort}
        dashboardHost={appProps.dashboardHost}
        dashboardToken={appProps.dashboardToken}
        qqChannel={appProps.qqChannel}
        qqSubmitRef={appProps.qqSubmitRef}
        qqErrorRef={appProps.qqErrorRef}
        onSwitchSession={setActiveSession}
      />
    </KeystrokeProvider>
  );
}

export async function chatCommand(opts: ChatOptions): Promise<void> {
  markPhase("chat_command_enter");
  const migratedModel = migrateRetiredModel(opts.model);
  const runtimeOpts: ChatOptions = {
    ...opts,
    model: migratedModel.model,
    thinkingMode: migratedModel.thinking ?? opts.thinkingMode,
  };
  loadDotenv();
  const initialKey = loadApiKey();
  markPhase("config_loaded");

  const requestedSpecs = runtimeOpts.mcp ?? [];
  // Shared progress sink: the bridge's onProgress callback writes
  // through `progressSink.current`, which App.tsx sets to its UI
  // updater on mount. Started null so early progress frames (before
  // the App has mounted) are dropped rather than buffered.
  const progressSink: { current: ((info: ProgressInfo) => void) | null } = { current: null };
  // Seed registry from the caller (e.g. carboncode code's native
  // filesystem tools) — MCP bridges layer on top rather than
  // replacing. When no seed AND no MCP, tools stays undefined and
  // the loop runs as a bare chat.
  let tools: ToolRegistry | undefined = runtimeOpts.seedTools;
  if (requestedSpecs.length > 0 && !tools) tools = new ToolRegistry();
  let mcpDirectory: McpToolDirectory | undefined;

  const runtime = createMcpRuntime({
    getTools: () => tools,
    getMcpPrefix: () => runtimeOpts.mcpPrefix,
    getRequestedCount: () => requestedSpecs.length,
    selectConfiguredSpecs: runtimeOpts.codeMode
      ? (specs) => selectCodeMcpToolProfile(specs, loadMcpToolProfile()).active
      : undefined,
    maxTools: DEEPSEEK_MAX_TOOLS,
    getDirectory: () => {
      if (!tools) return undefined;
      mcpDirectory ??= new McpToolDirectory(tools);
      return mcpDirectory;
    },
    progressSink,
  });

  // MCP bridging deferred to App.tsx mount — handshakes are 100ms–2s each
  // and we don't want the alt-screen UI to block on the slowest one.
  const mcpSpecs = [...requestedSpecs];
  const mcpServers: McpServerSummary[] = [];
  const cfg = readConfig();
  const startupInfoHints: string[] = [];
  if (runtimeOpts.mcpProfileSkipped && runtimeOpts.mcpProfileSkipped.length > 0) {
    startupInfoHints.push(
      t("mcpLifecycle.profileSkipped", {
        servers: runtimeOpts.mcpProfileSkipped.join(", "),
      }),
    );
  }
  const startupUpdateCheck = createStartupUpdateCheck(cfg);

  // Register web search/fetch tools unless explicitly disabled. DDG
  // backs them with no key required; the model invokes them whenever
  // a question needs info fresher than its training data.
  if (searchEnabled()) {
    if (!tools) tools = new ToolRegistry();
    registerWebTools(tools, {
      webSearchEngine: webSearchEngine(),
      webSearchEndpoint: webSearchEndpoint(),
    });
  }

  // Memory tools — available in every session, not just code mode.
  // Chat-mode callers get global scope only; project scope requires
  // the seedTools path from `carboncode code` (which registers its own
  // MemoryStore bound to rootDir before chatCommand runs).
  // `run_skill` is registered later in App.tsx (where the client
  // exists) so it can wire the subagent runner for runAs:subagent
  // skills.
  if (!runtimeOpts.seedTools) {
    if (!tools) tools = new ToolRegistry();
    registerMemoryTools(tools, {});
    // `ask_choice` — branching primitive, useful in chat too (stylistic
    // preferences, doc language, library picks). Independent of plan
    // mode, which chat doesn't have anyway.
    registerChoiceTool(tools);
  }

  // resolveSession handles --new (timestamped name, old session preserved)
  // and --resume (latest prefixed). Default falls through to the latest
  // prefixed-or-base.
  const { resolved: resolvedSession } = resolveSession(
    runtimeOpts.session,
    runtimeOpts.forceNew,
    runtimeOpts.forceResume,
  );
  const launchWorkspace = runtimeOpts.codeMode?.rootDir ?? process.cwd();
  if (runtimeOpts.codeMode) {
    const ruleSummary = formatRuleSummary(
      launchWorkspace,
      collectStartupRuleFiles(launchWorkspace),
    );
    if (ruleSummary) startupInfoHints.push(`▸ ${ruleSummary}`);
  }
  const showPicker =
    !runtimeOpts.session &&
    !runtimeOpts.forceResume &&
    listSessionsForWorkspace(launchWorkspace).length > 0;

  markPhase("ink_render_call");

  // Create QQ channel before the TUI mounts so connection setup stays
  // outside React lifecycle timing and the WebSocket handshake remains
  // deterministic.
  const qqSubmitRef: { current: ((text: string) => void) | null } = { current: null };
  const qqErrorRef: { current: ((msg: string) => void) | null } = { current: null };
  const qqRequested = cfg.qq?.enabled === true;
  let qqChannel: QQChannel | undefined;
  if (qqRequested) {
    const channel = new QQChannel({
      onSubmitMessage: (text) => qqSubmitRef.current?.(text),
      onError: (msg) => qqErrorRef.current?.(msg),
    });
    process.stderr.write("Connecting QQ bot...\n");
    try {
      await channel.start();
      qqChannel = channel;
      process.stderr.write("QQ bot connected\n");
    } catch (err) {
      process.stderr.write(`QQ bot failed: ${(err as Error).message}\n`);
    }
  }

  // One stdout `resize` listener per card (Ink's useBoxMetrics); long
  // chats legitimately hold hundreds, so Node's default cap of 10 fires
  // a spurious MaxListenersExceededWarning. Raise the ceiling.
  process.stdout.setMaxListeners(1000);

  const { waitUntilExit } = render(
    <Root
      initialKey={initialKey}
      tools={tools}
      mcpSpecs={mcpSpecs}
      mcpServers={mcpServers}
      mcpRuntime={runtime}
      progressSink={progressSink}
      startupInfoHints={startupInfoHints}
      startupUpdateCheck={startupUpdateCheck}
      showPicker={showPicker}
      {...runtimeOpts}
      session={resolvedSession}
      qqChannel={qqChannel}
      qqSubmitRef={qqSubmitRef}
      qqErrorRef={qqErrorRef}
    />,
    { exitOnCtrlC: true },
  );
  try {
    await waitUntilExit();
  } finally {
    await runtime.closeAll();
    qqChannel?.stop();
    await drainTtyResponses();
  }
}
