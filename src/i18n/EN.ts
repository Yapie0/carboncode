import type { TranslationSchema } from "./types.js";

export const EN: TranslationSchema = {
  common: {
    error: "Error",
    warning: "Warning",
    loading: "Loading...",
    done: "Done",
    cancel: "Cancel",
    confirm: "Confirm",
    back: "Back",
    next: "Next",
    tool: "tool",
    running: "running",
    noTurns: "(no turns yet)",
  },
  cli: {
    description: "Carbon Code — Chinese-first DeepSeek coding agent for terminal workflows.",
    continue: "Resume the most recently used chat session without showing the picker.",
    setup: "Interactive wizard — API key, preset, MCP servers. Re-run any time to reconfigure.",
    code: "Code-editing chat — filesystem tools rooted at <dir> (default: cwd), coding system prompt, deepseek-v4-flash baseline.",
    chat: "Interactive Ink TUI with live cache/cost panel.",
    run: "Run a single task non-interactively, streaming output.",
    stats: "Show usage dashboard.",
    doctor: "One-command health check.",
    commit: "Draft a commit message from the staged diff.",
    sessions: "List saved chat sessions, or inspect one by name.",
    pruneSessions: "Delete saved sessions idle ≥N days (default 90). Use --dry-run to preview.",
    events: "Pretty-print the kernel event-log sidecar.",
    replay: "Interactive Ink TUI to scrub through a transcript.",
    diff: "Compare two transcripts in a split-pane Ink TUI.",
    mcp: "Model Context Protocol helpers — discover servers, test your setup.",
    version: "Print Carbon Code version.",
    update: "Check for a newer Carbon Code and install it.",
    index: "Build (or incrementally refresh) a local semantic search index.",
    init: "Analyze a project and create a concise CARBON.md guide.",
  },
  stats: {
    usageHint: "run `carboncode chat`, `carboncode code`, or `carboncode run <task>` — every turn",
    usageDetail: "appends one line to the log and `carboncode stats` will roll it up.",
  },
  run: {
    missingApiKey:
      "DEEPSEEK_API_KEY is not set and stdin is not a TTY (cannot prompt).\n" +
      "Set the env var, or run `carboncode chat` once interactively to save a key.\n",
  },
  sessions: {
    emptyHint:
      "no saved sessions yet — run `carboncode chat` (sessions are auto-saved unless --no-session).",
  },
  ui: {
    welcome: "Run `carboncode` any time to start chatting — your settings are remembered.",
    taglineChat: "terminal coding agent",
    taglineCode: "terminal coding agent",
    taglineSub: "read the repo, edit files, run validation",
    startSessionHint: "type a task to start",
    inputPlaceholder: "Ask anything... (type / for commands, @ for files)",
    busy: "Thinking...",
    thinking: "▸ thinking...",
    activityWaitingForModel: "waiting for model…",
    activityThinking: "thinking…",
    activityProcessing: "processing…",
    activityGerunds:
      "Pondering…·Cogitating…·Puzzling…·Mulling…·Noodling…·Ruminating…·Scheming…·Brewing…·Tinkering…·Untangling…",
    undo: "Undo",
    undoHint: "press u within 5s to undo",
    applied: "applied",
    rejected: "rejected",
    noDashboard: "Suppress the auto-launched embedded web dashboard.",
    openDashboardHint:
      "Open the dashboard URL in your default browser as soon as the server is ready. No-op when --no-dashboard is set.",
    dashboardPortHint:
      "Pin the dashboard to a fixed port (1–65535). Stable across restarts — required for SSH tunnels. Default: ephemeral.",
    dashboardPortInvalid:
      "▲ ignoring --dashboard-port={value} (must be an integer 1–65535) — falling back to ephemeral",
    dashboardAutoStartFailed:
      "▲ dashboard auto-start failed ({reason}) — try /dashboard, or pass --no-dashboard to silence",
    systemAppendHint:
      "Append instructions to the code system prompt. Does NOT replace the default prompt — adds after it.",
    systemAppendFileHint:
      "Append file contents to the code system prompt. Does NOT replace the default prompt. UTF-8, relative to cwd or absolute.",
    resumedSession:
      '▸ resumed session "{name}" with {count} prior messages · /new to start fresh · /sessions to manage',
    newSession: '▸ session "{name}" (new) — auto-saved as you chat · /sessions to rename or delete',
    ephemeralSession: "▸ ephemeral chat (no session persistence) — drop --no-session to enable",
    restoredEdits:
      "▸ restored {count} pending edit block(s) from an interrupted prior run — /apply to commit or /discard to drop.",
    resumedPlan: "Resumed plan · {when}{summary}",
    tipEditBindings: {
      topic: "edit-gate keybindings",
      sections: [
        {
          rows: [
            { key: "y / n", text: "accept or drop pending edits" },
            {
              key: "Shift+Tab",
              text: "cycle review → auto → plan (persisted; AUTO applies instantly)",
            },
            { key: "u", text: "undo the last auto-applied batch (within the 5s banner)" },
          ],
        },
      ],
      footer: "Current mode shown in the bottom status bar · /keys for the full reference",
    },
    tipMouseClipboard: {
      topic: "mouse + clipboard",
      sections: [
        {
          rows: [
            { key: "drag", text: "select text — terminal-native, no modifier needed" },
            {
              key: "right-click",
              text: "your terminal's native menu (paste / copy on Windows Terminal etc.)",
            },
            { key: "wheel", text: "scrolls chat history (works on web/cloud/SSH terminals too)" },
            {
              key: "↑ / ↓",
              text: "previous / next prompt history · cursor up / down in a multi-line draft",
            },
          ],
        },
      ],
      footer: "Run /keys for the full keyboard + mouse reference",
    },
    keysReference: {
      topic: "Carbon Code keys + mouse reference",
      sections: [
        {
          title: "keyboard",
          rows: [
            { key: "Enter", text: "submit the prompt" },
            { key: "Shift+Enter", text: "insert a newline in the prompt" },
            {
              key: "↑ / ↓",
              text: "previous / next prompt history · cursor up / down in a multi-line draft",
            },
            {
              key: "Ctrl+P / Ctrl+N",
              text: "same as ↑ / ↓",
            },
            { key: "Ctrl+A / Ctrl+E", text: "jump to start / end of the current line" },
            { key: "Ctrl+W", text: "delete the word before the cursor" },
            { key: "Ctrl+U", text: "clear the entire prompt buffer" },
            { key: "Tab", text: "complete @-mention · drill folder · accept slash command" },
            { key: "Shift+Tab", text: "edit-gate: cycle review → auto → plan" },
            { key: "Esc", text: "dismiss picker · abort the running model turn" },
            { key: "Ctrl+C", text: "abort the running model turn (NOT copy — see clipboard)" },
            { key: "PgUp / PgDn", text: "scroll chat history a page at a time" },
            { key: "End", text: "jump chat to the most recent line" },
          ],
        },
        {
          title: "mouse",
          rows: [
            { key: "wheel", text: "scrolls chat history (works on web/cloud/SSH terminals too)" },
            { key: "drag", text: "selects text natively — direct copy works, no modifier" },
            { key: "right-click", text: "terminal-native (paste menu on Windows Terminal etc.)" },
          ],
        },
        {
          title: "copy / paste",
          rows: [
            { key: "select text", text: "drag to select — terminal-native (no modifier needed)" },
            {
              key: "/copy",
              text: "vim/tmux-style copy mode — works in SSH/mosh/tmux where drag-select can't extend past the viewport",
            },
            {
              key: "copy",
              text: "Ctrl+Shift+C (Win/Linux) · Cmd+C (macOS) — or auto-copy-on-select if your terminal does it",
            },
            { key: "paste", text: "Ctrl+V or Ctrl+Shift+V (Win/Linux) · Cmd+V (macOS)" },
            {
              key: "bracketed paste",
              text: "multi-line pastes stay one block — no auto-submit on intermediate newlines",
            },
          ],
        },
        {
          title: "edit-gate (code mode)",
          rows: [
            { key: "y / n", text: "accept or drop pending edits in the review modal" },
            { key: "Shift+Tab", text: "cycle review → auto → plan (persisted across sessions)" },
            { key: "u", text: "undo the last auto-applied batch (within the 5s banner)" },
          ],
        },
      ],
      footer:
        "Wheel→↑/↓ via DECSET 1007 (alternate-scroll) — wheel scrolls chat on most terminals (web/cloud/SSH included) without disturbing native selection. Drag to select stays modifier-free. Pass --no-mouse to opt out.",
    },
    tipShownOnce: "shown once",
    modelOverride: "override the default model",
    noSession: "disable session persistence for this run",
    resumeHint: "force-resume the named session (even if idle)",
    newHint: "force a fresh session (ignore --session / --continue)",
    transcriptHint: "path to write the JSONL transcript",
    budgetHint: "session USD cap — warns at 80%, refuses next turn at 100%",
    modelIdHint: "DeepSeek model id (e.g. deepseek-v4-flash)",
    systemPromptHint: "override the default system prompt",
    presetHint: "model bundle — auto|flash|pro",
    sessionNameHint: "session name (default: 'default')",
    ephemeralHint: "disable session persistence for this run",
    mcpSpecHint: "MCP server spec (repeatable)",
    mcpPrefixHint: "prefix MCP tool names with this string",
    noConfigHint: "ignore ~/.carboncode/config.json for this run",
    presetHintShort: "model bundle — auto|flash|pro",
    budgetHintShort: "session USD cap",
    transcriptHintShort: "JSONL transcript path",
    mcpSpecHintShort: "MCP server spec (repeatable)",
    mcpPrefixHintShort: "MCP tool name prefix",
    dryRunHint: "show what would be installed without actually installing",
    rebuildHint: "rebuild the index from scratch",
    embedModelHint: "embedding model name",
    projectDirHint: "project root directory",
    ollamaUrlHint: "Ollama server URL",
    skipPromptsHint: "skip confirmation prompts",
    initForceHint: "overwrite an existing project rules file",
    initDryRunHint: "preview the generated rules without writing",
    initJsonHint: "output the result as JSON (requires --yes to write)",
    initYesHint: "write without an interactive confirmation",
    verboseHint: "show full session metadata",
    pruneDaysHint: "delete sessions idle this many days or more (default 90)",
    pruneDryRunHint: "list what would be deleted without removing anything",
    eventTypeHint: "filter by event type",
    eventSinceHint: "start from this event id",
    eventTailHint: "show only the last N events",
    jsonHint: "output as JSON",
    projectionHint: "show projected state at each event",
    printHint: "print to stdout instead of TUI",
    headHint: "show only the first N events",
    tailHint: "show only the last N events",
    mdReportHint: "write a markdown diff report to this path",
    printHintTable: "print a table to stdout",
    tuiHint: "open the interactive TUI",
    labelAHint: "label for the left pane",
    labelBHint: "label for the right pane",
    mcpListDescription: "browse the MCP registry (official → smithery → local fallback)",
    mcpInspectDescription: "inspect an MCP server spec (tools, resources, prompts)",
    mcpSearchDescription: "search the MCP registry for servers matching a query",
    mcpInstallDescription: "install an MCP server by name (writes its spec to your config)",
    mcpBrowseDescription: "interactive marketplace browser — type to filter, enter to install",
    mcpLocalHint: "show only the bundled offline catalog",
    mcpRefreshHint: "bypass the 24h cache and refetch",
    mcpLimitHint: "max entries to show",
    mcpPagesHint: "eagerly load this many pages (default 1)",
    mcpAllHint: "load every page (slow on first run)",
    mcpMaxPagesHint: "cap how many pages to walk while searching (default 20)",
    jsonHintCatalog: "output as JSON",
    jsonHintReport: "output the inspection report as JSON",
    modelOverrideFlash: "override the model (default: deepseek-v4-flash)",
    skipConfirmHint: "skip the confirmation prompt",
    yoloHint:
      "auto-approve plan checkpoints for this invocation (equivalent to editMode=yolo without mutating config)",
    ruleSummaryLabel: "rules",
  },
  code: {
    workspaceConflict:
      "⚠ workspace contains another agent platform's files ({platforms}). Carbon Code may read them as project content; relaunch with --dir <your-project> if that's not what you want.\n",
    systemAppendEmpty: "--system-append is empty — no prompt text will be appended\n",
    systemAppendFileReadError:
      'Error: cannot read --system-append-file "{filePath}": {errorDetails}\n',
  },
  slash: {
    help: { description: "show the full command reference" },
    copy: {
      description: "open vim/tmux-style copy mode — j/k navigate, v select, y yank to clipboard",
    },
    status: { description: "current model, flags, context, session" },
    preset: {
      description: "model bundle — auto escalates flash → pro, flash/pro lock",
      argsHint: "<auto|flash|pro>",
    },
    model: {
      description: "add, update, and switch provider/model profiles",
      argsHint: "[add|list|update|remove|<profile-or-model>]",
    },
    models: { description: "list available models fetched from DeepSeek /models" },
    thinking: {
      description: "show or set DeepSeek thinking mode",
      argsHint: "[auto|on|off]",
    },
    "max-output": {
      description: "show, cap, or clear the maximum output token count",
      argsHint: "[positive-token-count|off]",
    },
    theme: {
      description: "show or persist the terminal theme preference. Bare opens picker.",
      argsHint: "[auto|default|dark|light|tokyo-night|github-dark|github-light|high-contrast]",
    },
    language: {
      description: "switch the runtime language",
      argsHint: "<zh-CN|EN>",
      success: "Language switched to English.",
      unsupported: "Unsupported language code: {code}. Supported: {supported}.",
    },
    pro: {
      description: "arm v4-pro for the NEXT turn only (one-shot · auto-disarms after turn)",
      argsHint: "[off]",
    },
    budget: {
      description:
        "session USD cap — warns at 80%, refuses next turn at 100%. Off by default. /budget alone shows status",
      argsHint: "[usd|off]",
    },
    mcp: { description: "list MCP servers + tools attached to this session" },
    resource: {
      description: "browse + read MCP resources (no arg → list URIs; <uri> → fetch contents)",
      argsHint: "[uri]",
    },
    prompt: {
      description: "browse + fetch MCP prompts (no arg → list names; <name> → render prompt)",
      argsHint: "[name]",
    },
    memory: {
      description: "show / manage pinned memory (AGENTS.md/CARBON.md + ~/.carboncode/memory)",
      argsHint: "[list|show <name>|forget <name>|clear <scope> confirm]",
    },
    agents: {
      description: "list / scaffold subagents (custom personas in .carboncode/agents/ + built-ins)",
      argsHint: "[list|show <name>|new <name>]",
    },
    skill: {
      description: "list / run user skills (project + custom + global + builtin)",
      argsHint: "[list|paths|show <name>|<name> [args]]",
    },
    hooks: {
      description:
        "list active hooks (settings.json under .carboncode/) · reload re-reads from disk",
      argsHint: "[reload]",
    },
    permissions: {
      description:
        "show / edit shell allowlist (builtin read-only · per-project: ~/.carboncode/config.json)",
      argsHint: "[list|add <prefix>|remove <prefix|N>|clear confirm]",
    },
    dashboard: {
      description: "launch the embedded web dashboard (127.0.0.1, token-gated)",
      argsHint: "[stop]",
    },
    update: { description: "show current vs latest version + the shell command to upgrade" },
    stats: {
      description:
        "cross-session cost dashboard (today / week / month / all-time · cache hit · vs Claude)",
    },
    cost: {
      description:
        "bare → last turn's spend (Usage card); with text → estimate cost of sending it next (worst-case + likely-cache)",
      argsHint: "[text]",
    },
    doctor: { description: "health check (api / config / api-reach / index / hooks / project)" },
    "terminal-setup": { description: "detect your terminal and suggest shell-integration tweaks" },
    "output-style": { description: "reply verbosity: default / explanatory / learning" },
    statusline: { description: "status-bar density preset: minimal / default / full" },
    pricing: {
      description:
        "show model pricing used for cost math, config override example, and official reference page",
      argsHint: "[open]",
    },
    config: { description: "show every current setting + the command to change each" },
    vim: { description: "toggle vim editing in the composer (NORMAL/INSERT)" },
    context: { description: "show context-window breakdown (system / tools / log / input)" },
    collab: {
      description:
        "enter local collaboration mode and print a prompt for Codex, Claude Code, or another agent",
      argsHint: "[agent]",
    },
    mwh: {
      description: "browse reusable Middlewave Hub modules and install local references",
      argsHint: "[list|search|show|install]",
    },
    "multi-agent": {
      description: "configure and run experimental benchmark-routed multi-provider agents",
      argsHint: "[setup|models|enable|disable|benchmark|assignments|role|run]",
    },
    teams: {
      description: "manage Carbon Code Teams multi-agent orchestration",
      argsHint: "[create|status|inbox|run|dispatch]",
    },
    retry: { description: "truncate & resend your last message (fresh sample)" },
    compact: {
      description:
        "narrow oversized tool results + tool-call args in the log; cap at tokens, default 4000",
      argsHint: "[tokens]",
    },
    cwd: {
      description:
        "switch the workspace root mid-session — re-points fs / shell / memory tools, reloads project hooks, refreshes the at-mention walker",
      argsHint: "[path]",
    },
    "add-dir": {
      description: "add an extra workspace root for file + shell tools (bare = list current roots)",
      argsHint: "[path]",
    },
    stop: { description: "abort the current model turn (typed alternative to Esc)" },
    feedback: { description: "open a GitHub issue with diagnostic info copied to clipboard" },
    keys: { description: "keyboard + mouse + copy/paste reference" },
    plans: { description: "list this session's active + archived plans, newest first" },
    replay: {
      description: "load an archived plan as a read-only Time Travel snapshot (default: newest)",
      argsHint: "[N]",
    },
    resume: { description: "resume a past session — pick from recent" },
    export: {
      description: "export this session to a Markdown (or JSON) file",
      argsHint: "[json]",
    },
    sessions: { description: "list saved sessions (current marked with ▸)" },
    title: { description: "ask the model to rename this session from the conversation" },
    qq: {
      description: "connect, inspect, or disconnect the QQ channel for this session",
      argsHint: "[connect [appId appSecret [sandbox]]|status|disconnect]",
    },
    setup: { description: "reminds you to exit and run `carboncode setup`" },
    semantic: {
      description: "show semantic_search status — built? Ollama installed? how to enable",
    },
    clear: { description: "clear visible scrollback only (log/context kept)" },
    new: { description: "start a fresh conversation (clear context + scrollback)" },
    loop: {
      description:
        "auto-resubmit <prompt> every <interval> until you type something / Esc / /loop stop",
      argsHint: "<5s..6h> <prompt>  ·  stop  ·  (no args = status)",
    },
    exit: { description: "quit the TUI" },
    review: {
      description: "review the current diff (or vs a git ref) for bugs + cleanups, with file:line",
      argsHint: "[ref]",
    },
    init: {
      description:
        "scan the project and synthesize a baseline CARBON.md (model writes; review with /apply). `force` overwrites an existing file.",
      argsHint: "[force]",
    },
    apply: {
      description:
        "commit pending edit blocks to disk (no arg → all; `1`, `1,3`, or `1-4` → that subset, rest stay pending)",
      argsHint: "[N|N,M|N-M]",
    },
    discard: {
      description: "drop pending edit blocks without writing (no arg → all; indices → that subset)",
      argsHint: "[N|N,M|N-M]",
    },
    walk: {
      description:
        "step through pending edits one block at a time (git-add-p style: y/n per block, a apply rest, A flip AUTO)",
    },
    undo: { description: "roll back the last applied edit batch" },
    history: { description: "list every edit batch this session (ids for /show, undone markers)" },
    show: {
      description: "dump a stored edit diff (omit id for newest non-undone)",
      argsHint: "[id]",
    },
    commit: { description: "git add -A && git commit -m ...", argsHint: '"msg"' },
    checkpoint: {
      description:
        "snapshot every file the session has touched (Cursor-style internal store, not git). /checkpoint alone lists.",
      argsHint: "[name|list|forget <id>]",
    },
    restore: {
      description: "roll back files to a named checkpoint (see /checkpoint list)",
      argsHint: "<name|id>",
    },
    plan: {
      description: "toggle read-only plan mode (writes bounced until submit_plan + approval)",
      argsHint: "[on|off]",
    },
    mode: {
      description:
        "edit-gate: review (queue) · auto (apply+undo) · yolo (apply+auto-shell). Shift+Tab cycles review→auto→plan.",
      argsHint: "[review|auto|yolo]",
    },
    jobs: { description: "list background jobs started by run_background" },
    kill: {
      description: "stop a background job by id (SIGTERM → SIGKILL after grace)",
      argsHint: "<id>",
    },
    logs: {
      description: "tail a background job's output (default last 80 lines)",
      argsHint: "<id> [lines]",
    },
    btw: {
      description:
        "ask a quick side question — answered from a blank slate, never added to the conversation context",
      argsHint: "<question>",
    },
    "search-engine": {
      description:
        "switch web search backend — mojeek (default, no deps), searxng (self-hosted), or metaso (free quota 100/d)",
      argsHint: "<mojeek|searxng|metaso> [<endpoint>]",
    },
  },
  wizard: {
    languageTitle: "Choose your language",
    languageSubtitle: "Simplified Chinese is the default. Switch later via /language.",
    languageDetectedHint: "(detected)",
    welcomeTitle: "Welcome to Carbon Code.",
    apiKeyPrompt: "Paste your DeepSeek API key to get started.",
    apiKeyGetOne: "Get one at: https://platform.deepseek.com/api_keys",
    apiKeyOpenedBrowser:
      "Opened your browser to grab a key (didn't pop up? visit the URL below, or press Tab to reopen).",
    apiKeyOpenHint: "Press Tab to open the browser and grab a key.",
    apiKeyShownOnce: "DeepSeek shows the key only once — copy it right away.",
    apiKeySavedLocally: "Saved locally to {path}",
    apiKeyInputLabel: "key › ",
    apiKeyInvalid: "Key looks too short — paste the full token (16+ chars, no spaces).",
    apiKeyChecking: "Checking API key…",
    apiKeyRejected:
      "DeepSeek rejected this API key. Paste a valid key, or press Esc to cancel setup.",
    apiKeyCheckFailed:
      "Could not verify this API key right now ({message}). Check your network or try again.",
    apiKeyPreview: "preview: {redacted}",
    apiKeyFooter: "[Enter] confirm · [Tab] open key page · [Ctrl+B] back · [Esc] cancel",
    themeTitle: "Choose a theme",
    themeSubtitle: "Preview updates live as you navigate. Change later with /theme.",
    themeSampleHeading: "Sample",
    themeFooter: "[↑↓] navigate · [Enter] confirm · [Backspace/Ctrl+B] back · [Esc] cancel",
    themeCaption: {
      default: "GitHub dark (default)",
      dark: "Cool dark tones",
      light: "Clean light mode",
      "tokyo-night": "Tokyo Night palette",
      "github-dark": "GitHub dark",
      "github-light": "GitHub light",
      "high-contrast": "Accessibility",
    },
    presetDescriptions: {
      auto: {
        headline: "flash → pro on hard turns",
        cost: "default · ~96% turns stay on flash · pro kicks in only when needed",
      },
      flash: {
        headline: "v4-flash always",
        cost: "cheapest · predictable · /pro still works for a one-turn bump",
      },
      pro: {
        headline: "v4-pro always",
        cost: "~3x flash at current pricing; best for hard multi-turn work",
      },
    },
    mcpCatalog: {
      filesystem: {
        summary: "read/write/search files inside a sandboxed directory",
        note: "the directory is a hard sandbox — the server refuses access outside it",
      },
      memory: {
        summary: "persistent key-value memory across sessions",
      },
      github: {
        summary: "read issues, PRs, code search (needs GITHUB_PERSONAL_ACCESS_TOKEN)",
        note: "set GITHUB_PERSONAL_ACCESS_TOKEN in your env before spawning",
      },
      playwright: {
        summary: "browser automation — navigate, click, fill, screenshot",
        note: "first run downloads a browser engine; pass --headless to run without a window",
      },
      everything: {
        summary: "official test server — exercises every MCP feature",
        note: "useful for debugging your Carbon Code setup",
      },
    },
    reviewLabelTheme: "Theme",
    presetTitle: "Pick a preset",
    mcpTitle: "Which MCP servers should Carbon Code wire up for you?",
    mcpUserArgsHint: "(you'll provide {arg})",
    mcpFooterMulti:
      "[↑↓] navigate  ·  [Space] toggle  ·  [Enter] confirm  ·  [Backspace/Ctrl+B] back  ·  [Esc] cancel  ·  empty = skip",
    mcpArgsTitle: "Configure {name}",
    mcpArgsDirMissing: "Directory {path} doesn't exist.",
    mcpArgsDirCreateHint: "[Y/Enter] create it (mkdir -p) · [N/Esc] enter a different path",
    mcpArgsDirCreateFailed: "Couldn't create {path}: {message}",
    mcpArgsRequiredParam: "Required parameter: ",
    mcpArgsEmpty: "{name} needs a value — got an empty string.",
    mcpArgsNotADir: "{path} exists but is not a directory.",
    mcpArgsDefaultPlaceholder: "default: {value}",
    mcpArgsSqlitePlaceholder: "e.g. ./notes.sqlite",
    mcpArgsFilesystemSummary: "read/write/search files inside a sandboxed directory",
    mcpArgsFilesystemNote: "the directory is a hard sandbox — the server refuses access outside it",
    mcpArgsFooter: "[Enter] confirm · [Ctrl+B] back · [Esc] cancel",
    reviewTitle: "Ready to save",
    reviewLabelApiKey: "API key",
    reviewLabelLanguage: "Language",
    reviewLabelPreset: "Preset",
    reviewLabelMcp: "MCP",
    reviewMcpNone: "(none)",
    reviewMcpServers: "{count} server(s)",
    reviewSavesTo: "Saves to {path}",
    reviewSaveError: "Could not save config: {message}",
    reviewFooter: "[Enter] save · [Backspace/Ctrl+B] back · [Esc] cancel",
    savedTitle: "▸ Saved.",
    savedFooter: "[Enter] to exit",
    selectFooter: "[↑↓] navigate · [Enter] confirm · [Esc] cancel",
    selectFooterBack: "[↑↓] navigate · [Enter] confirm · [Backspace/Ctrl+B] back · [Esc] cancel",
    stepCounter: "Step {step}/{total} · ",
    exitHint: "/exit to abort",
    apiKeyPlaceholder: "sk-...",
    themeSampleReasoning: "Reasoning",
  },
  themePicker: {
    header: "Theme",
    footer: "↑↓ pick · ⏎ confirm · esc cancel",
    currentPref: "current preference",
    activeNow: "active now",
    autoDesc: "use CARBONCODE_THEME or default",
    autoLabel: "auto",
    defaultLabel: "default",
    darkLabel: "dark",
    lightLabel: "light",
    tokyoNightLabel: "tokyo-night",
    githubDarkLabel: "github-dark",
    githubLightLabel: "github-light",
    highContrastLabel: "high-contrast",
  },
  planFlow: {
    approveCardTitle: "Approve plan",
    approveCardMetaRight: "awaiting",
    openQuestionsBanner:
      "▲ the plan flags open questions or risks — pick {refine} to write concrete answers before the model moves on.",
    openQuestionsHeader: "Open questions / risks",
    truncatedBodyMore: "… {n} more line above in scrollback",
    truncatedBodyMorePlural: "… {n} more lines above in scrollback",
    picker: {
      accept: "accept",
      acceptHint: "run it now, in order",
      refine: "refine",
      refineHint: "give the agent more guidance, draft a new plan",
      revise: "revise",
      reviseHint: "edit the plan inline before running (skip / reorder steps)",
      reject: "reject",
      rejectHint: "discard, agent will retry from scratch",
    },
    refineFooter: "⏎ send  ·  esc return to picker",
    refineQuestionsHeading: "Answer these or describe the change you want:",
    modes: {
      approve: {
        title: "approving — any last instructions?",
        hint: "Answer questions the plan raised, add constraints, or just press Enter to approve as-is.",
        blankHint: " (Enter with blank = approve without extra instructions.)",
      },
      refine: {
        title: "refining — what should the model change?",
        hint: "Describe what's wrong or missing, or answer questions the plan raised.",
        blankHint: " (Enter with blank = let the model pick safe defaults for any open questions.)",
      },
      reject: {
        title: "rejecting — tell the model why (optional)",
        hint: "Say what the model got wrong about your goal, or what you actually want instead.",
        blankHint:
          " (Enter with blank = cancel without explanation; the model will ask what you want.)",
      },
      "checkpoint-revise": {
        title: "revising — what should change before the next step?",
        hint: "Scope change, skip steps, alternative approach — the model adjusts the remaining plan.",
        blankHint: " (Enter with blank = continue with the current plan.)",
      },
      "choice-custom": {
        title: "custom answer — type whatever fits",
        hint: "Free-form reply. The model reads it verbatim and proceeds — no need to match the listed options.",
        blankHint: " (Enter with blank = ask the model what you actually want.)",
      },
    },
    checkpoint: {
      title: "Checkpoint — step done",
      continue: "Continue — run the next step",
      continueHint: "Model resumes with the next step.",
      revise: "Revise — give feedback before the next step",
      reviseHint: "Stay paused, type guidance; model adjusts the remaining plan.",
      stop: "Stop — end the plan here",
      stopHint: "Model summarizes what was done and ends.",
    },
    stepList: {
      counter: "{total} steps",
      counterSingular: "{total} step",
      counterDone: "{done}/{total} done ({pct}%) · {total} steps",
      counterDoneSingular: "{done}/{total} done ({pct}%) · {total} step",
    },
    noPlanSummary: "No plan body submitted yet.",
    detailCollapsedHint: "Ctrl+P expands full plan details.",
    detailExpandedHint: "Ctrl+P collapses details.",
    detailHeader: "Plan details",
    detailWindow: "showing lines {start}-{end} of {total}",
    detailScrollHint: "PgUp/PgDn scroll details · Home/End jump",
    reviseTitle: "Revise plan",
    reviseSteps: "{count} steps",
    reviseFooter:
      "\u2191\u2193 focus  \u00b7  space toggle skip  \u00b7  k/j move  \u00b7  \u23ce accept  \u00b7  esc cancel",
    riskMed: " med",
    riskHigh: " high",
    completeMsg: "\u25b8 plan complete \u2014 all {total} step{s} done \u00b7 archived",
  },
  app: {
    walkCancelledRemaining: "▸ walk cancelled — {count} block(s) still pending.",
    walkCancelled: "▸ walk cancelled.",
    turnInterrupted: "▸ turn interrupted — type a follow-up to continue.",
    editModeYolo:
      "▸ edit mode: YOLO — edits AND shell commands auto-run. /undo still rolls back edits. Use carefully.",
    editModeAuto:
      "▸ edit mode: AUTO — edits apply immediately; press u within 5s to undo (space pauses the timer). Shell commands still ask.",
    editModeReview: "▸ edit mode: review — edits queue for /apply (or y) / /discard (or n)",
    rejectedEdit: "▸ rejected edit to {path}{context}",
    autoApprovingRest: "▸ auto-approving remaining edits for this turn",
    flippedAutoSession: "▸ flipped to AUTO mode for the rest of the session (persisted)",
    flippedAutoWalk: "▸ flipped to AUTO mode — future edits will apply immediately. Walk exited.",
    dashboardStopped: "▸ dashboard stopped.",
    notedMemory: "▸ noted ({scope}) — {verb} {path}",
    notedScopeProject: "project",
    notedScopeGlobal: "global",
    notedVerbCreated: "created",
    notedVerbAppended: "appended to",
    memoryWriteFailed: "# memory write failed",
    commandFailed: "! command failed",
    btwUsage: "▸ /btw <question> — ask a side question without polluting the conversation context.",
    btwHeader: "≫ btw",
    btwFailed: "/btw failed",
    restoreCodeOnly: "▸ /restore is code-mode only",
    hookUserPromptSubmit: "UserPromptSubmit hook",
    hookStop: "Stop hook",
    atMentions: "▸ @mentions: {parts}",
    atUrl: "▸ @url: {parts}",
    atUrlFailed: "@url expansion failed",
    sessionTitleNoSession: "▸ no persisted session is active, so there is nothing to rename.",
    sessionExported: "✓ session exported → {path}",
    sessionExportEmpty: "▸ this session is empty — nothing to export.",
    sessionExportFailed: "▸ export failed: {reason}",
    sessionTitleNoContent: "▸ not enough conversation content to name this session yet.",
    sessionTitleNoTitle: "▸ the model did not return a usable session title.",
    sessionTitleUpdated: '▸ session title updated: "{title}"',
    sessionTitleRenameFailed: '▸ could not rename the session for title "{title}".',
    sessionTitleRenamed: '▸ session renamed to "{name}" — {title}',
    sessionTitleAutoRenamed: '▸ auto-named session "{name}" — {title}',
    workspaceSwitched: "▸ workspace switched to {root}",
    semanticRepointed: "▸ semantic_search re-pointed at {root}",
    semanticDisabledForRoot: "▸ semantic_search disabled (no compatible index in {root})",
    semanticRebootstrapFailed: "▸ semantic_search re-bootstrap failed: {reason}",
    denied: "▸ denied: {cmd}{context}",
    alwaysAllowed: '▸ always allowed "{prefix}" for {dir}',
    sessionAllowed: '▸ allowed "{prefix}" for this session',
    runningCommand: "▸ running: {cmd}",
    startingBackground: "▸ starting (background): {cmd}",
    checkpointSaved:
      "⛁ checkpoint saved · {id} · {count} file{s} · /restore {id} to roll back this step",
    continuingAfter: "▸ continuing after {label}{counter}",
    planStoppedAt: "▸ plan stopped at {label}{counter}",
    revisingAfter: "▸ revising after {label} — {feedback}",
    historyScrollHint: " ↑ reading history · End / PgDn returns to bottom · ↓ advances one line",
  },
  hooks: {
    head: "hook {tag} `{cmd}` {decision}{truncTag}",
    headWithDetail: "hook {tag} `{cmd}` {decision}{truncTag}: {detail}",
    truncated: " (output truncated at 256KB)",
    decisionBlock: "block",
    decisionWarn: "warn",
    decisionTimeout: "timeout",
    decisionError: "error",
  },
  summary: {
    status: "summarizing what was gathered…",
    hallucinatedFallback:
      "(model emitted fake tool-call markup instead of a prose summary — try /retry with a narrower question, or /think to inspect R1's reasoning)",
    failedAfterReason:
      "{label} and the fallback summary call failed: {message}. Run /clear and retry with a narrower question, or raise --max-tool-iters.",
  },
  loop: {
    budgetExhausted:
      "session budget exhausted — spent ${spent} ≥ cap ${cap}. Bump the cap with /budget <usd>, clear it with /budget off, or end the session.",
    budget80Pct: "▲ budget 80% used — ${spent} of ${cap}. Next turn or two likely trips the cap.",
    proArmed: "⇧ /pro armed — this turn runs on deepseek-v4-pro (one-shot · disarms after turn)",
    deepThinkOn: "⬢ Thinking harder — this turn runs on {model} (one-shot)",
    abortedAtIter:
      "aborted at iter {iter} — stopped without producing a summary (press ↑ + Enter or /retry to resume)",
    toolUploadStatus: "tool result uploaded · model thinking before next response…",
    preflightTruncateStatus: "preflight: context near full, truncating oldest history…",
    preflightTruncated:
      "preflight: request ~{estimate}/{ctxMax} tokens ({pct}%) — truncated {beforeMessages} messages → {afterMessages}. Sending.",
    preflightTruncatedStillFull:
      "preflight: request still ~{estimate}/{ctxMax} tokens ({pct}%) after truncating {beforeMessages} messages → {afterMessages}. DeepSeek will likely 400. Run /clear or /new to start fresh.",
    preflightNoFold:
      "preflight: request ~{estimate}/{ctxMax} tokens ({pct}%) and nothing left to truncate — DeepSeek will likely 400. Run /clear or /new to start fresh.",
    flashEscalation: "⇧ flash requested escalation — retrying this turn on {model}{reasonSuffix}",
    malformedSseFrames:
      "Ignored {count} malformed streaming frame(s). The provider response may be incomplete.",
    unknownModelCapabilities:
      "Model {model} is not in the capability registry. Using a {context}-token fallback context window and unknown pricing; configure contextWindowOverride and pricingOverride for accurate limits and cost.",
    finishReasonLength:
      "The model stopped because it reached the output-token limit. Increase maxOutputTokens or ask for a narrower response.",
    finishReasonContentFilter: "The provider stopped this response because of its content filter.",
    finishReasonResource:
      "The provider stopped this response because capacity was unavailable. Retry the turn.",
    harvestStatus: "extracting plan state from reasoning…",
    repeatToolCallWarning:
      "Caught a repeated tool call — let the model see the issue and retry with a different approach.",
    stormStuck:
      "Stopped a stuck retry loop — the model kept calling the same tool with identical args after a self-correction nudge. Try /retry, rephrase, or rule out the underlying blocker.",
    stormSuppressed: "Suppressed {count} repeated tool call(s) — same name + args fired 3+ times.",
    compactingHistoryStatus: "compacting history{aggressiveTag}…",
    aggressiveTag: " (aggressive)",
    foldedHistory:
      "context {before}/{ctxMax} ({pct}%) — folded {beforeMessages} messages → {afterMessages} (summary {summaryChars} chars). Continuing.",
    aggressivelyFoldedHistory:
      "context {before}/{ctxMax} ({pct}%) — aggressively folded {beforeMessages} messages → {afterMessages} (summary {summaryChars} chars). Continuing.",
    forcingSummary:
      "context {before}/{ctxMax} ({pct}%) — forcing summary from what was gathered. Run /compact, /clear, or /new to reset.",
  },
  errors: {
    contextOverflow:
      "Context overflow (DeepSeek 400): session history is {requested}, past the model's prompt limit (V4: 1M tokens; legacy chat/reasoner: 131k). Usually a single tool result grew too big. Carbon Code caps new tool results at 8k tokens and auto-heals oversized history on session load — a restart often clears it. If it still overflows, run /new to start fresh, or open /sessions and press [d] to delete this session.",
    contextOverflowTooMany: "too many tokens",
    auth401:
      "Authentication failed (DeepSeek 401): {inner}. Your API key is rejected. Fix with `carboncode setup` or `export DEEPSEEK_API_KEY=sk-...`. Get one at https://platform.deepseek.com/api_keys.",
    balance402:
      "Out of balance (DeepSeek 402): {inner}. Top up at https://platform.deepseek.com/top_up — the panel header shows your balance once it's non-zero.",
    badparam422: "Invalid parameter (DeepSeek 422): {inner}",
    badrequest400: "Bad request (DeepSeek 400): {inner}",
    deepseek5xxHead:
      "DeepSeek service unavailable ({status}) — this is a DeepSeek-side problem, not Carbon Code. Already retried 4× with backoff.",
    deepseek5xxReachable:
      " DeepSeek's main API answered our health check, but /chat/completions is failing — partial outage on their side.",
    deepseek5xxUnreachable:
      " DeepSeek API is unreachable from your network — could be a wider DS outage or a local network issue.",
    deepseek5xxActionNetwork:
      " Try: (1) check your network, (2) wait 30s and retry, (3) status page: https://status.deepseek.com.",
    deepseek5xxActionRetry:
      " Try: (1) wait 30s and retry, (2) /preset to switch model, (3) status page: https://status.deepseek.com.",
    innerNoMessage: "(no message)",
    reasonAborted: "[aborted by user (Esc) — summarizing what I found so far]",
    reasonContextGuard:
      "[context budget running low — summarizing before the next call would overflow]",
    reasonStuck:
      "[stuck on a repeated tool call — explaining what was tried and what's blocking progress]",
    labelAborted: "aborted by user",
    labelContextGuard: "context-guard triggered (prompt > 80% of window)",
    labelStuck: "stuck (repeated tool call suppressed by storm-breaker)",
  },
  handlers: {
    basic: {
      newInfo:
        "▸ new conversation — dropped {count} message(s) from context. Same session, fresh slate.",
      newInfoArchived:
        '▸ new conversation — dropped {count} message(s) from context. Prior transcript archived as "{archived}" (visible under Sessions).',
      newInfoSystemReloaded: " · project memory reloaded (next turn pays one cache miss)",
      helpTitle: "Commands:",
      helpShellTitle: "Shell shortcut:",
      helpShell: "  !<cmd>                   run <cmd> in the sandbox root; output goes into",
      helpShellDetail:
        "                             the conversation so the model sees it next turn.",
      helpShellConsent:
        "                             No allowlist gate — user-typed = explicit consent.",
      helpShellExample: "                             Example: !git status   !ls src/   !npm test",
      helpMemoryTitle: "Quick memory:",
      helpMemoryPin:
        "  #<note>                  append <note> to <project>/CARBON.md (committable).",
      helpMemoryPinEx:
        "                             Example: #findByEmail must be case-insensitive",
      helpMemoryGlobal:
        "  #g <note>                append <note> to ~/.carboncode/CARBON.md (global, never committed).",
      helpMemoryGlobalEx: "                             Example: #g always run pnpm not npm",
      helpMemoryPinBoth:
        "                             Both pin into every future session's prefix. Faster than /memory.",
      helpMemoryEscape:
        "                             Use `\\#text` to send a literal `#text` to the model.",
      helpFileTitle: "File references (code mode):",
      helpFile: "  @path/to/file            inline file content under [Referenced files] on send.",
      helpFilePicker:
        "                             Type `@` to open the picker (↑↓ navigate, Tab/Enter pick).",
      helpUrlTitle: "URL references:",
      helpUrl:
        "  @https://example.com     fetch the URL, strip HTML, inline under [Referenced URLs].",
      helpUrlCache:
        "                             Same URL twice in one session fetches once (in-mem cache).",
      helpUrlPunct:
        "                             Trailing sentence punctuation (./,/)) is stripped automatically.",
      helpPresetsTitle: "Presets (branch + harvest are NEVER auto-enabled — opt-in only):",
      helpPresetAuto:
        "  auto   v4-flash → v4-pro on hard turns  ← default · cheap when easy, smart when hard",
      helpPresetFlash:
        "  flash  v4-flash always                  cheapest · predictable per-turn cost",
      helpPresetPro: "  pro    v4-pro   always                  ~3x flash · hard multi-turn work",
      helpSessionsTitle: "Sessions (auto-enabled by default, named 'default'):",
      helpSessionCustom: "  carboncode chat --session <name>   use a different named session",
      helpSessionNone: "  carboncode chat --no-session       disable persistence for this run",
      retryNone: "nothing to retry — no prior user message in this session's log.",
      retryInfo: '▸ retrying: "{preview}"',
      loopTuiOnly: "/loop is only available in the interactive TUI (not in run/replay).",
      loopStopped: "▸ loop stopped.",
      loopNoActive: "no active loop to stop.",
      loopNoActiveHint:
        "no active loop. Start one with `/loop <interval> <prompt>` (e.g. /loop 30s npm test).\nCancels on: /loop stop · Esc · /clear /new · any user-typed prompt.",
      loopStarted:
        '▸ loop started — re-submitting "{prompt}" every {duration}. Type anything (or /loop stop) to cancel.',
      keysNeedsTui: "/keys needs a TUI context (postKeys wired).",
      unknownCommand: "unknown command: /{cmd} — did you mean {list}?",
      unknownCommandShort: "unknown command: /{cmd}  (try /help)",
    },
    sessions: {
      titleUnavailable: "/title is only available in an active persisted TUI session.",
      titleStarted: "▸ naming session…",
      titleFailed: "▸ session title failed: {reason}",
    },
    theme: {
      saved: "theme saved: {theme}\nactive on next launch: {active}",
      unknownTheme: "unknown theme: {theme}\navailable: {available}",
    },
    admin: {
      doctorNeedsTui: "/doctor needs a TUI context (postDoctor wired).",
      doctorRunning: "⚕ Doctor — running health checks…",
      reviewRunning: "▸ reviewing changes…",
      outputStyleCurrent:
        "▸ output style: {current}  (options: {list})\n  /output-style <name> to change — applies on the next session / /new",
      outputStyleUsage: "usage: /output-style {list}",
      outputStyleSet: "✓ output style → {style} · applies on the next session (/new or restart)",
      statuslineUsage: "usage: /statusline {list}",
      statuslineSet: "✓ status bar → {preset} · applies on the next launch (restart)",
      configTitle: "⚙ Carbon Code · settings",
      configFooter: "type the command shown to change a setting · config: {path}",
      vimOn:
        "✓ vim mode on — composer starts in NORMAL · Esc to leave insert · i/a to insert · hjkl·w·b·dd·cw·x·p",
      vimOff: "✓ vim mode off — standard composer editing (readline-style)",
      hooksReloadUnavailable:
        "/hooks reload is not available in this context (no reload callback wired).",
      hooksReloaded: "▸ reloaded hooks · {count} active",
      hooksUsage:
        "usage: /hooks            list active hooks\n       /hooks reload     re-read settings.json files",
      hooksNone: "no hooks configured.",
      hooksDropHint: "drop a settings.json with a `hooks` key into either of:",
      hooksProject: "  · {path} (project)",
      hooksProjectFallback: "  · <project>/.carboncode/settings.json (project)",
      hooksGlobal: "  · {path} (global)",
      hooksEvents: "events: PreToolUse, PostToolUse, UserPromptSubmit, Stop",
      hooksExitCodes: "exit 0 = pass · exit 2 = block (Pre*) · other = warn",
      hooksLoaded: "▸ {count} hook(s) loaded",
      hooksSources: "sources: project={project} · global={global}",
      updateCurrent: "current: carboncode {version}",
      updateLatestPending: "latest:  (not yet resolved — background check in flight or offline)",
      updateRetryHint: "triggered a fresh registry fetch — retry `/update` in a few seconds,",
      updateRetryHint2: "or run `carboncode update` in another terminal to force it synchronously.",
      updateLatest: "latest:  carboncode {version}",
      updateUpToDate: "you're on the latest. nothing to do.",
      updateNpxHint:
        "you're running via npx — the next `npx @carboncode/cli ...` launch will auto-fetch.",
      updateNpxForce: "to force a refresh sooner: `npm cache clean --force`.",
      updateUpgradeHint: "to upgrade, exit this session and run:",
      updateUpgradeCmd1:
        "  carboncode update           (interactive, dry-run supported via --dry-run)",
      updateUpgradeCmd2: "  {command}   (direct)",
      updateInSessionDisabled:
        "in-session install is deliberately disabled — the install spawn would",
      updateInSessionDisabled2:
        "corrupt this TUI's rendering and Windows can lock the running binary.",
      statsNoData: "no usage data yet.",
      statsEveryTurn: "every turn you run here appends one record — this session's turns",
      statsWillAppear: "will show up in the dashboard once you send a message.",
    },
    edits: {
      undoCodeOnly:
        "/undo is only available inside `carboncode code` — chat mode doesn't apply edits.",
      historyCodeOnly: "/history is only available inside `carboncode code`.",
      showCodeOnly: "/show is only available inside `carboncode code`.",
      applyCodeOnly: "/apply is only available inside `carboncode code` (nothing to apply here).",
      discardCodeOnly: "/discard is only available inside `carboncode code`.",
      planCodeOnly:
        "/plan is only available inside `carboncode code` — chat mode doesn't gate tool writes.",
      planOn:
        "▸ plan mode ON — write tools are gated; the model MUST call `submit_plan` before anything executes. (The model can also call submit_plan on its own for big tasks even when plan mode is off — this toggle is the stronger, explicit constraint.) Type /plan off to leave.",
      planOff:
        "▸ plan mode OFF — write tools are live again. Model can still propose plans autonomously for large tasks.",
      modeCodeOnly: "/mode is only available inside `carboncode code`.",
      modeUsage: "usage: /mode <review|auto|yolo>   (Shift+Tab also cycles)",
      modeYolo:
        "▸ edit mode: YOLO — edits AND shell commands auto-run with no prompt. /undo still rolls back edits. Use carefully.",
      modeAuto:
        "▸ edit mode: AUTO — edits apply immediately; press u within 5s to undo, or /undo later. Shell commands still ask.",
      modeReview: "▸ edit mode: review — edits queue for /apply (or y) / /discard (or n)",
      commitCodeOnly:
        "/commit is only available inside `carboncode code` (needs a rooted git repo).",
      commitUsage:
        'usage: /commit "your commit message"  — runs `git add -A && git commit -m "…"` in {root}',
      walkCodeOnly: "/walk is only available inside `carboncode code`.",
      checkpointCodeOnly:
        "/checkpoint is only available inside `carboncode code` — chat mode doesn't apply edits.",
      checkpointNone:
        "no checkpoints yet — `/checkpoint <name>` snapshots every file the session has touched. Restore later with `/restore <name>`.",
      checkpointHeader: "◈ checkpoints · {count} stored",
      checkpointRestoreHint:
        "  /restore <name|id> · /checkpoint forget <id> · /checkpoint <name> to add",
      checkpointForgetUsage: "usage: /checkpoint forget <id|name>",
      checkpointNoMatch: '▸ no checkpoint matching "{name}" — see /checkpoint list',
      checkpointDeleted: "▸ deleted checkpoint {id} ({name})",
      checkpointDeleteFailed: "▸ failed to delete {id} (already gone?)",
      checkpointSaveUsage: "usage: /checkpoint <name>   (or /checkpoint list to see existing)",
      checkpointSavedEmpty:
        '▸ checkpoint "{name}" saved ({id}) — but no files have been touched yet, so it\'s an empty baseline. Edits made after this point will be revertable.',
      checkpointSaved:
        '▸ checkpoint "{name}" saved ({id}) — {files} file{s}, {size} KB. Restore: /restore {name}',
      restoreCodeOnly: "/restore is only available inside `carboncode code`.",
      restoreUsage: "usage: /restore <name|id>   (see /checkpoint list for ids)",
      restoreNoMatch: '▸ no checkpoint matching "{target}" — try /checkpoint list',
      restoreInfo: '▸ restored "{name}" ({id}) from {when}',
      restoreWrote: "  · wrote back {count} file{s}",
      restoreRemoved: "  · removed {count} file{s} (didn't exist at checkpoint time)",
      restoreSkipped: "  ✗ {count} file{s} skipped:",
      cwdCodeOnly: "/cwd is only available inside `carboncode code`.",
      addDirCodeOnly: "/add-dir is only available inside `carboncode code`.",
      addDirList: "▸ workspace roots (● primary · + added):\n{list}\n  /add-dir <path> to add one",
      addDirAdded:
        "✓ added workspace root → {dir}  ({count} roots total). File + shell tools can reach it now; it isn't semantically indexed, so use search_content / grep there.",
      addDirError: "▲ /add-dir failed: {reason}",
      cwdUsage:
        "usage: /cwd <path>   (current root: {current}). Re-points filesystem / shell / memory tools to <path>.",
      cwdUsageNoCurrent: "usage: /cwd <path>   re-points the workspace root to <path>.",
    },
    model: {
      modelHint: "try deepseek-v4-flash or deepseek-v4-pro — run /models to fetch the live list",
      modelUsage: "usage: /model <id>   ({hint})",
      modelNotInCatalog:
        "model → {id}   (⚠ not in the fetched catalog: {list}. If this is wrong the next call will 400 — run /models to refresh.)",
      modelSet: "model → {id}",
      presetAuto: "preset → auto  (v4-flash → v4-pro on hard turns · default)",
      presetFlash: "preset → flash  (v4-flash always · cheapest · /pro still bumps one turn)",
      presetPro: "preset → pro  (v4-pro always · ~3× flash · for hard multi-turn work)",
      presetUsage: "usage: /preset <auto|flash|pro>",
      thinkingStatus: "thinking: {mode} (effective: {effective})",
      thinkingSet: "thinking → {mode} (effective: {effective})",
      thinkingUsage: "usage: /thinking <auto|on|off>",
      maxOutputStatus: "max output: {tokens} tokens",
      maxOutputSet: "max output → {tokens} tokens",
      maxOutputOff: "max output → provider default",
      maxOutputUsage: "usage: /max-output <positive-token-count|off>",
      proNothingArmed: "nothing armed — /pro with no args will arm pro for your next turn",
      proDisarmed: "▸ /pro disarmed — next turn falls back to the current preset",
      proUsage:
        "usage: /pro       arm pro for the next turn (one-shot, auto-disarms after)\n       /pro off  cancel armed state before the next turn",
      proArmed:
        "▸ /pro armed — your NEXT message runs on {model} regardless of preset. Auto-disarms after one turn. Use /preset pro for a persistent switch.",
      budgetNoCap:
        "no session budget set — Carbon Code will keep going until you stop it. Set one with: /budget <usd>   (e.g. /budget 5)",
      budgetStatus:
        "budget: ${spent} of ${cap} ({pct}%) · /budget off to clear, /budget <usd> to change",
      budgetOff: "budget → off (no cap)",
      budgetUsage:
        'usage: /budget <usd>   (got "{arg}" — must be a positive number, e.g. /budget 5 or /budget 12.50)',
      budgetExhausted:
        "▲ budget → ${cap} but already spent ${spent}. Next turn will be refused — bump the cap higher to keep going, or end the session.",
      budgetSet:
        "budget → ${cap}  (so far: ${spent} · warns at 80%, refuses next turn at 100% · /budget off to clear)",
    },
    permissions: {
      mutateCodeOnly:
        "/permissions add / remove / clear are only available inside `carboncode code` — they edit the project-scoped allowlist (`~/.carboncode/config.json` projects[<root>].shellAllowed).",
      addUsage:
        'usage: /permissions add <prefix>   (multi-token OK: /permissions add "git push origin")',
      addAlready: "▸ already allowed: {prefix}",
      addBuiltin:
        "▸ `{prefix}` is already in the builtin allowlist — no per-project entry needed. (Builtin entries are always on.)",
      addInfo:
        "▸ added: {prefix}\n  → next `{prefix}` invocation runs without prompting in this project.",
      removeUsage:
        "usage: /permissions remove <prefix-or-index>   (e.g. /permissions remove 3, or /permissions remove npm)",
      removeEmpty: "▸ no project allowlist entries to remove.",
      removeIndexOob: "▸ index out of range: {idx} (project list has {count} entries)",
      removeNothing: "▸ nothing to remove.",
      removeBuiltin:
        "▸ `{prefix}` is in the builtin allowlist (read-only). Builtin entries can't be removed at runtime — they're baked into the binary.",
      removeInfo: "▸ removed: {prefix}",
      removeNotFound:
        "▸ no such project entry: {prefix}   (try /permissions list to see what's stored)",
      clearAlready: "▸ project allowlist is already empty.",
      clearConfirm:
        "about to drop {count} project allowlist entr{plural} for {root}. Re-run with the word 'confirm' to proceed: /permissions clear confirm",
      clearedNone: "▸ project allowlist was already empty — nothing changed.",
      cleared: "▸ cleared {count} project allowlist entr{plural}.",
      usage:
        'usage: /permissions [list]                   show current state\n       /permissions add <prefix>            persist (e.g. "npm run build")\n       /permissions remove <prefix-or-N>    drop one entry\n       /permissions clear confirm           wipe every project entry',
      modeYolo:
        "▸ edit mode: YOLO  — every shell command auto-runs, allowlist is bypassed. /mode review to re-enable prompts.",
      modeAuto:
        "▸ edit mode: auto  — edits auto-apply, shell still gated by allowlist (or ShellConfirm prompt for non-allowlisted).",
      modeReview:
        "▸ edit mode: review — both edits and non-allowlisted shell commands ask before running.",
      projectHeader: "Project allowlist ({count}) — {root}",
      projectNone1: '  (none — pick "always allow" on a ShellConfirm prompt to add one,',
      projectNone2: "   or `/permissions add <prefix>` directly.)",
      projectNoRoot: "Project allowlist — (no project root; chat mode shows builtin entries only)",
      builtinHeader: "Builtin allowlist ({count}) — read-only, baked in",
      subcommands:
        "Subcommands: /permissions add <prefix> · /permissions remove <prefix-or-N> · /permissions clear confirm",
    },
    dashboard: {
      notAvailable:
        "/dashboard is not available in this context (no startDashboard callback wired).",
      stopNoCallback: "/dashboard stop: no stop callback wired.",
      notRunning: "▸ dashboard is not running.",
      stopping: "▸ dashboard stopping…",
      alreadyRunning: "▸ dashboard is already running:",
      alreadyRunningHint: "Open it in any browser. Type `/dashboard stop` to tear it down.",
      ready: "▸ dashboard ready:",
      readyHint: "127.0.0.1 only · token-gated. Type `/dashboard stop` to shut down.",
      failed: "▸ dashboard failed to start: {reason}",
      starting: "▸ starting dashboard server…",
    },
    observability: {
      contextInfo: "context: ~{total} of {max} ({pct}%) · system {sys} · tools {tools} · log {log}",
      compactStarting: "▸ folding older turns into a summary…",
      compactNoop: "▸ nothing to fold — log already small or recent turns alone exceed the budget.",
      compactDone: "▸ folded {before} messages → {after} (summary {chars} chars). Continuing.",
      compactFailed: "▸ fold failed: {reason}",
      costNoTurn: "no turn yet — `/cost` shows the most recent turn's token + spend breakdown.",
      costNeedsTui: "/cost needs a TUI context (postUsage wired).",
      costNoPricing:
        '▸ /cost: no pricing table for model "{model}". Add one to telemetry/stats.ts.',
      costEstimate:
        "▸ /cost estimate · {model} · {prompt} prompt tokens (sys {sys} + tools {tools} + log {log} + msg {msg})",
      costWorstCase:
        "  worst case (full miss): {input} input + ~{output} output ({avg} avg) ≈ {total}",
      costLikely: "  likely ({pct}% session cache hit): {input} input + ~{output} output ≈ {total}",
      costLikelyCold: "  likely: matches worst case until cache fills (no completed turns yet)",
      pricingTitle: "pricing for {model}",
      pricingCurrent:
        "  USD / 1M tokens: cache-hit input {hit}, cache-miss input {miss}, output {output} ({source})",
      pricingMissing: '  no pricing table for "{model}" yet; cost will be shown as zero.',
      pricingFormula:
        "  formula: (cacheHitTokens*hit + cacheMissTokens*miss + completionTokens*output) / 1,000,000",
      pricingReference: "  reference: {url}",
      pricingOverrideIntro: "  override in {path}:",
      pricingSourceBuiltIn: "built-in table",
      pricingSourceOverride: "config override",
      pricingSourceMissing: "missing table",
      pricingOpenHint: "  run /pricing open to open the reference page.",
      pricingOpened: "  opened the reference page in your browser.",
      pricingOpenFailed: "  could not open the reference page: {reason}",
      statusModel: "  model   {model}",
      statusFlags: "  flags   stream={stream} · effort={effort}",
      statusCtx: "  ctx     {bar} {used}/{max} ({pct}%)",
      statusCtxNone: "  ctx     no turns yet",
      statusCost: "  cost    ${cost} · cache {bar} {pct}% · turns {turns}",
      statusCostCold: "  cost    ${cost} · turns {turns} (cache warming up)",
      statusBudget: "  budget  ${spent} / ${cap} ({pct}%){tag}",
      statusSession: '  session "{name}" · {count} messages in log (resumed {resumed})',
      statusSessionEphemeral: "  session (ephemeral — no persistence)",
      statusWorkspace:
        "  workspace {path} · pinned at launch (relaunch with --dir <path> to switch)",
      statusMcp: "  mcp     {servers} server(s), {tools} tool(s) in registry",
      statusEdits: "  edits   {count} pending (/apply to commit, /discard to drop)",
      statusPlan: "  plan    ON — writes gated (submit_plan + approval)",
      statusModeYolo:
        "  mode    YOLO — edits + shell auto-run with no prompt (/undo still rolls back · Shift+Tab to flip)",
      statusModeAuto:
        "  mode    AUTO — edits apply immediately (u to undo within 5s · Shift+Tab to flip)",
      statusModeReview: "  mode    review — edits queue for /apply or y  (Shift+Tab to flip)",
      statusDash: "  dash    {url} (open in browser · /dashboard stop)",
    },
    plans: {
      noSession:
        "no session attached — `/plans` is per-session. Run `carboncode code` in a project to get a session.",
      activePlan: "▸ active plan{label} — {done}/{total} step{s} done · last touched {when}",
      activeNone: "▸ active plan: (none)",
      noArchives:
        "no archived plans yet for this session — they auto-archive when every step is done",
      archivedHeader: "Archived ({count}):",
      replayNoSession:
        "no session attached — `/replay` is per-session. Run `carboncode code` in a project to get a session.",
      replayNoArchives:
        "no archived plans yet for this session — `/replay` lights up once a plan completes (auto-archives when every step is done).",
      replayInvalidIndex:
        "invalid index — `/replay` takes 1..{max} (newest = 1). Use `/plans` to see the list.",
      archivedRow: "  ✓ {when}  {total} step{s} · {completion}  {label}",
      completionComplete: "complete",
      stopAborted:
        "▸ plan stopped — model aborted; type a follow-up to continue or start a new task.",
      doneUsage:
        "usage: /plans done <stepId>  ·  /plans done all — manual override when the model forgot to call mark_step_complete",
      doneUnavailable: "/plans done is only available inside an active session.",
      doneNoPlan: "no active plan — nothing to mark done.",
      doneNotInPlan: "step `{id}` is not in the active plan. Run /plans to see the step ids.",
      doneAlready: "step `{id}` was already marked done.",
      doneOk: "▸ marked step `{id}` done.",
      doneAllNoop: "every step is already done.",
      doneAllOk: "▸ marked {count} step(s) done.",
    },
    jobs: {
      codeOnly: "/jobs is only available inside `carboncode code`.",
      killCodeOnly: "/kill is only available inside `carboncode code`.",
      logsCodeOnly: "/logs is only available inside `carboncode code`.",
      empty:
        "◈ jobs · 0 running · 0 total\n  (run_background spawns one — dev servers, watchers, long-running scripts)",
      header: "◈ jobs · {running} running · {total} total",
      footer: "  /logs <id> tail · /kill <id> SIGTERM → SIGKILL",
      killUsage: "usage: /kill <id>   (see /jobs for ids)",
      killNotFound: "job {id}: not found",
      killAlreadyExited: "job {id} already exited ({code})",
      killStopping:
        "▸ stopping job {id} (tree kill: SIGTERM → SIGKILL after 2s grace; Windows: taskkill /T /F)",
      killStatus: "▸ job {id} {status}",
      killStillAlive: "still alive after SIGKILL (!) — report this as a bug",
      logsUsage: "usage: /logs <id> [lines]   (default last 80 lines)",
      logsNotFound: "job {id}: not found",
      logsStatus: "[job {id} · {status}]\n$ {command}",
      logsRunning: "running · pid {pid}",
      logsExited: "exited {code}",
      logsFailed: "failed ({reason})",
      logsStopped: "stopped",
    },
    memory: {
      disabled:
        "memory is disabled (CARBONCODE_MEMORY=off in env). Unset the var to re-enable — no CARBON.md, AGENTS.md, or ~/.carboncode/memory content will be pinned in the meantime.",
      noRoot:
        "no working directory on this session — `/memory` needs a root to resolve project memory from. (Running in a test harness?)",
      listEmpty:
        "no user memories yet. The model can call `remember` to save one, or you can create files by hand in ~/.carboncode/memory/global/ or the per-project subdir.",
      listHeader: "User memories ({count}):",
      listFooter: "View body: /memory show <name>   Delete: /memory forget <name>",
      showUsage: "usage: /memory show <name>  or  /memory show <scope>/<name>",
      showNotFound: "no memory found: {target}",
      showFailed: "show failed: {reason}",
      forgetUsage: "usage: /memory forget <name>  or  /memory forget <scope>/<name>",
      forgetNotFound: "no memory found: {target}",
      forgetInfo: "▸ forgot {scope}/{name}. Next /new or launch won't see it.",
      forgetFailed: "could not forget {scope}/{name} (already gone?)",
      forgetError: "forget failed: {reason}",
      clearUsage: "usage: /memory clear <global|project> confirm",
      clearConfirm:
        "about to delete every memory in scope={scope}. Re-run with the word 'confirm' to proceed: /memory clear {scope} confirm",
      cleared: "▸ cleared scope={scope} — deleted {count} memory file(s).",
      noMemory: "no memory pinned in {root}.",
      layers: "Three layers are available:",
      layerProject: "  1. {file} — committable team memory (in the repo).",
      layerGlobal: "  2. ~/.carboncode/memory/global/ — your cross-project private memory.",
      layerProjectHash:
        "  3. ~/.carboncode/memory/<project-hash>/ — this project's private memory.",
      askModel: "Ask the model to `remember` something, or hand-edit files directly.",
      changesNote:
        "Changes take effect on next /new or launch — the system prompt is hashed once per session to keep the prefix cache warm.",
      subcommands:
        "Subcommands: /memory list | /memory show <name> | /memory forget <name> | /memory clear <scope> confirm",
      changesNoteShort:
        "Changes take effect on next /new or launch. Subcommands: /memory list | show | forget | clear",
    },
    mcp: {
      noServers:
        'no MCP servers attached. Run `carboncode setup` to pick some, or launch with --mcp "<spec>". `carboncode mcp list` shows the catalog.',
      toolsLabel: "  tools     {count}",
      resourcesHint: "`/resource` to browse+read",
      promptsHint: "`/prompt` to browse+fetch",
      awarenessOnly:
        "Chat mode consumes tools today; resources+prompts are surfaced here for awareness.",
      catalogHint:
        "Full catalog: `carboncode mcp list` · deeper diagnosis: `carboncode mcp inspect <spec>`.",
      fallbackServers: "MCP servers ({count}):",
      fallbackTools: "Tools in registry ({count}):",
      fallbackChange: "To change this set, exit and run `carboncode setup`.",
      usageDisableEnable:
        "usage: /mcp {action} <name>  ·  pick a name shown in /mcp (anonymous servers can't be named-toggled).",
      usageReconnect: "usage: /mcp reconnect <name>  ·  pick a name shown in /mcp.",
      unknownServer: 'unknown MCP server "{name}". Known: {list}.',
      noneList: "(none)",
      reconnectNoTui: "/mcp reconnect requires the interactive TUI (postInfo not wired).",
      liveTab: "Live",
      marketplaceTab: "Marketplace",
      tabHint: "tab to switch",
    },
    init: {
      codeOnly:
        "/init only works in code mode (it needs filesystem tools).\nRun `carboncode code [path]` to start a session rooted at the\nproject you want to initialize, then run /init.",
      exists: "▸ project memory already exists at {path}",
      existsForce: "  /init force   regenerate from scratch (overwrites)",
      existsEdit: "  Or edit it by hand — it's just markdown. The current file is",
      existsPinned: "  pinned into the system prompt every launch as-is.",
      info: "▸ /init — model will scan the project and synthesize CARBON.md.\n  The result lands as a pending edit; review with /apply or /walk.",
    },
    webSearchEngine: {
      currentEngine: "Current web search engine: {engine}",
      endpoint: "SearXNG endpoint: {url}",
      usageHeader: "Usage:",
      usageMojeek: "  /search-engine mojeek            use Mojeek (default, no external deps)",
      usageSearxng: "  /search-engine searxng            use SearXNG at default endpoint",
      usageSearxngUrl: "  /search-engine searxng <url>      use SearXNG at custom endpoint",
      usageMetaso:
        "  /search-engine metaso              use Metaso API (100/d free, configure your own API key for more)",
      alias: "Alias: /se",
      searxngInfo:
        "SearXNG is a self-hosted metasearch engine (https://github.com/searxng/searxng).",
      searxngInstall: "Install it with:  docker run -d -p 8080:8080 searxng/searxng",
      switched: 'Switched web search engine to "{engine}".{note}',
      switchedSearxngNote: " Make sure SearXNG is running at {endpoint}.",
      switchedMetasoNote:
        " There is a daily quota of 100 (configure your own API key for higher limits).",
      confirmed:
        '✓ Web search engine set to "{engine}"{detail}. Next assistant turn will pick up the change.',
      confirmedDetail: " ({endpoint})",
    },
    skill: {
      listEmpty: "no skills found. Carbon Code reads skills from:",
      listProjectScope:
        "  · <project>/.carboncode/skills/<name>/SKILL.md  (or <name>.md)  — project scope",
      listGlobalScope: "  · ~/.carboncode/skills/<name>/SKILL.md  (or <name>.md)  — global scope",
      listProjectOnly: "  (project scope is only active in `carboncode code`)",
      listFrontmatter: "Each file's frontmatter needs at least `name` and `description`.",
      listInvoke:
        "Invoke a skill with `/skill <name> [args]` or by asking the model to call `run_skill`.",
      listHeader: "User skills ({count}):",
      listFooter: "View: /skill show <name>   Run: /skill <name> [args]   New: /skill new <name>",
      listEmptyNewHint:
        "Scaffold one with: /skill new <name>  (project scope) — there's no remote registry yet; you author skills directly.",
      showUsage: "usage: /skill show <name>",
      showNotFound: "no skill found: {name}",
      runNotFound: "no skill found: {name}  (try /skill list)",
      runInfo: "▸ running skill: {name}{args}",
      newUsage: "usage: /skill new <name> [--global]",
      newCreated: "▸ created skill: {name}\n  {path}\n  edit it, then `/skill {name}` to invoke",
      newError: "▲ /skill new failed: {reason}",
      pathsHeader: "Skill paths (priority order):",
      pathsPriority:
        "Priority: project > custom paths in config order > global > builtin. Changes affect the system prompt on next /new or new session.",
      pathsUsage:
        "usage: /skill paths [list]\n       /skill paths add <path>\n       /skill paths remove <path|N>",
      pathsAddUsage: "usage: /skill paths add <path>",
      pathsRemoveUsage: "usage: /skill paths remove <path|N>",
      pathsAdded: "▸ added custom skills path: {path}",
      pathsAlready: "▸ custom skills path already configured: {path}",
      pathsRemoved: "▸ removed custom skills path: {path}",
      pathsRemoveNotFound: "▸ no custom skills path matches: {target}",
      pathsRestartHint:
        "The current session's system prompt is unchanged; run /new or start a new session to refresh the skills index.",
    },
    agents: {
      listHeader: "▸ agents — {count} subagent personas you can delegate to",
      listAddHint:
        "  add your own: drop a .md in .carboncode/agents/ (project) or ~/.carboncode/agents/ (global)",
      listInvokeHint:
        "  invoke: ask in plain language, or /skill <name> — each runs as an isolated subagent (only its answer returns)",
      listNewHint: "  scaffold: /agents new <name> [--global]   ·   inspect: /agents show <name>",
      newUsage: "usage: /agents new <name> [--global]",
      newCreated:
        "▸ created agent: {name}\n  {path}\n  edit it, then /new (or restart) to load — invoke via run_skill or /skill {name}",
      newError: "▲ /agents new failed: {reason}",
      showUsage: "usage: /agents show <name>",
      showNotFound: "no agent named: {name}  (try /agents)",
    },
  },
  statusBar: {
    turn: "turn",
    session: "session",
    cache: "cache",
    spent: "spent",
    left: " left",
    slow: "slow",
    disconnect: "disconnect",
    reconnecting: "reconnecting\u2026",
    approvingIn: "approving in ",
    escToInterrupt: "s \u00b7 esc to interrupt",
    recordingGlyph: "\u25CFREC",
    mb: " MB",
    evt: " evt",
    editsLabel: "edits:",
    mcpLoading: "MCP",
    ctx: "ctx",
    ctxCompactHint: "/compact",
  },
  editMode: {
    plan: "PLAN MODE",
    yolo: "YOLO",
    auto: "AUTO",
    review: "REVIEW",
    writesGated: "   writes gated \u00b7 /plan off to leave",
    editsShellAuto: "edits + shell auto \u00b7 /undo to roll back",
    editsLandNow: "edits land now \u00b7 u to undo",
    queuedApplyDiscard: "{count} queued \u00b7 y apply \u00b7 n discard",
    editsQueued: "edits queued \u00b7 y apply \u00b7 n discard",
    shiftTabFlip: "   {mid} \u00b7 Shift+Tab to flip",
    queuedDots: "queued\u2026",
    undoApplied: "applied {ok}/{total}",
    undoHint: "u undo \u00b7 Space pause",
    undoPausedHint: "u undo \u00b7 Space resume",
  },
  composer: {
    placeholder: "Ask for a code change",
    waitingForResponse: "\u2026waiting for response\u2026",
    queueHint: "response in progress - enter interrupts it and sends the next message",
    queueActive: "{count} queued - interrupting the current response, then sending",
    hintSend: "send",
    hintNewline: "newline",
    hintClear: "clear",
    hintScroll: "scroll",
    hintHistory: "history",
    hintAbort: "abort",
    hintQuit: "quit",
    historySearchTitle: "Prompt history",
    historySearchPrompt: "search: ",
    historySearchCount: " · {shown}/{total}",
    historySearchEmpty: "No prompts submitted in this session yet.",
    historySearchNoMatch: "No matching prompts.",
    historySearchHint: "type to filter · ↑/↓ select · Ctrl+R next · Enter use · Esc cancel",
    abortedHint: "turn aborted by user \u00b7 esc again to clear \u00b7 \u23ce to ask a follow-up",
    editorNoRawMode:
      "external editor unavailable \u2014 stdin doesn't support raw-mode toggling on this terminal",
    editorFailed: "external editor:",
    editorMissing:
      "no $EDITOR / $VISUAL / $GIT_EDITOR set \u2014 export one (e.g. `export EDITOR=nano`) and retry",
    editorExited: "editor exited with code {code}",
    typeaheadStaged: "\u25b8 {count} line(s) staged \u00b7 esc recall",
  },
  pathConfirm: {
    title: "Outside-sandbox path",
    subtitleRead: "{tool} wants to READ a file outside the project sandbox",
    subtitleWrite: "{tool} wants to WRITE a file outside the project sandbox",
    awaiting: "awaiting",
    denyTitle: "Deny \u2014 provide context",
    optional: "optional",
    denyFooter:
      "type context  \u00b7  \u23ce submit with reason  \u00b7  esc skip (deny without reason)",
    pickFooter: "\u2191\u2193 pick  \u00b7  \u23ce confirm  \u00b7  esc cancel",
    allowOnce: "allow once",
    allowOnceDesc: "permit this access; remember the directory for the rest of this session",
    allowAlways: "allow always",
    allowAlwaysDesc:
      "remember `{prefix}` for this project (persisted in ~/.carboncode/config.json)",
    deny: "deny",
    denyDesc: "press Tab to add context telling the model why",
    pathLabel: "path",
    sandboxLabel: "sandbox",
    allowPrefixLabel: "prefix",
  },
  shellConfirm: {
    title: "Shell command",
    bgTitle: "Background process",
    subtitle: "model wants to run a shell command",
    bgSubtitle: "long-running process \u2014 keeps running after approval, /kill to stop",
    denyTitle: "Deny \u2014 provide context",
    optional: "optional",
    denyFooter:
      "type context  \u00b7  \u23ce submit with reason  \u00b7  esc skip (deny without reason)",
    awaiting: "awaiting",
    pickFooter: "\u2191\u2193 pick  \u00b7  \u23ce confirm  \u00b7  esc cancel",
    allowOnce: "allow once",
    allowOnceDesc: "run this command, ask again next time",
    allowSession: "allow this session",
    allowAlways: "allow always",
    allowAlwaysDesc: "remember `{prefix}` for this project",
    deny: "deny",
    denyDesc: "press Tab to add context telling the model why",
    cwdLabel: "cwd",
    timeoutLabel: "timeout",
    waitLabel: "wait",
    previewMore: "… {n} more line hidden — press esc, ask the model to split it",
    previewMorePlural: "… {n} more lines hidden — press esc, ask the model to split it",
  },
  editConfirm: {
    footer: "Enter apply  \u00b7  n reject  \u00b7  \u2191\u2193 scroll  \u00b7  Esc cancel",
    newTag: "NEW",
    editTag: "EDIT",
    linesCount: "-{removed} +{added} lines",
    viewingRange: "viewing {start}-{end}/{total}",
    denyFooter: "\u23ce submit  \u00b7  esc skip (deny without reason)",
    oldLabel: "  - old",
    newLabel: "  + new",
    sideBySide:
      "   side-by-side \u00b7 removed lines on the left, added on the right \u00b7 paired by offset",
    linesAbove: "  \u2191 {count} line above  (\u2191/k or PgUp)",
    linesAbovePlural: "  \u2191 {count} lines above  (\u2191/k or PgUp)",
    linesBelow: "  \u2193 {count} line below  (\u2193/j or Space/PgDn)",
    linesBelowPlural: "  \u2193 {count} lines below  (\u2193/j or Space/PgDn)",
  },
  sessionPicker: {
    header: " \u25c8 CARBON CODE \u00b7 pick a session ",
    title: "pick a session \u2014 {workspace}",
    messages: "{count} message",
    messagesPlural: "{count} messages",
    turns: "{count} turns",
    pickerHint:
      "\u2191\u2193 pick \u00b7 / search \u00b7 \u23ce open \u00b7 [n] new \u00b7 [d] delete \u00b7 [r] rename \u00b7 esc quit",
    empty: "  no saved sessions in this workspace yet \u2014 press ",
    emptyNew: " to start a new one",
    renamePrompt: '  rename "{from}" \u2192 ',
    renameHint: "  \u23ce confirm rename  \u00b7  esc cancel",
    searchPrompt: "  search sessions: /",
    searchHint: "  type to filter  \u00b7  \u23ce open match  \u00b7  esc clear",
    searchEmpty: "  no sessions match this search",
    emptyHint: "  \u23ce new session  \u00b7  esc quit",
    justNow: "just now",
    minAgo: "{count} min ago",
    yesterday: "yesterday",
    hoursAgo: "{count}h ago",
    daysAgo: "{count} days ago",
  },
  workspacePicker: {
    header: " ◈ CARBON CODE · pick a workspace ",
    title: "pick a workspace — {workspace}",
    sessions: "{count} session",
    sessionsPlural: "{count} sessions",
    current: "current",
    pickerHint: "↑↓ pick · / search · ⏎ switch + pick session · esc quit · /cwd <path> adds one",
    empty: "  no known workspaces yet — run /cwd <path> once to add one",
    searchPrompt: "  search workspaces: /",
    searchHint: "  type to filter  ·  ⏎ switch + pick session  ·  esc clear",
    searchEmpty: "  no workspaces match this search",
  },
  modelPicker: {
    header: " \u25c8 CARBON CODE \u00b7 pick a setup ",
    loading: "  \u00b7  loading catalog\u2026",
    catalogEmpty: "  \u00b7  catalog empty \u2014 using known fallbacks",
    modelsAvailable: "  \u00b7  {count} models available",
    presetsHeader: "    PRESETS  \u00b7  recommended \u2014 model + effort + auto-escalate",
    modelsHeader: "    MODELS  \u00b7  raw pick \u2014 auto-escalate stays as-is",
    pickerFooter:
      "  \u2191\u2193 pick  \u00b7  \u23ce confirm  \u00b7  [r] refresh  \u00b7  esc cancel",
    currentLabel: "  \u00b7 current",
  },
  slashSuggestions: {
    noMatch: "no slash command matches that prefix",
    backspaceHint: " \u2014 Backspace to edit, or /help for the full list",
    commandCount: "{count} command",
    commandCountPlural: "{count} commands",
    aboveLabel: "   \u2191 {count} above",
    belowLabel: "   \u2193 {count} below",
    advancedHint: "  + {count} advanced  \u00b7  type a letter to search",
    footerHint: "  \u2191\u2193 navigate \u00b7 Tab / \u23ce pick \u00b7 esc cancel",
    groupChat: "CHAT",
    groupSetup: "SETUP",
    groupInfo: "INFO",
    groupSession: "SESSION",
    groupExtend: "EXTEND",
    groupCode: "CODE",
    groupJobs: "JOBS",
    groupAdvanced: "ADVANCED",
    groupDetailSetup: "model + cost",
    groupDetailInfo: "current state",
    groupDetailChat: "daily turn ops",
    groupDetailExtend: "MCP, memory, skills",
    groupDetailSession: "saved sessions",
    groupDetailCode: "edits + plans (code mode)",
    groupDetailJobs: "background processes (code mode)",
    groupDetailAdvanced: "rare or set-and-forget",
  },
  atMentions: {
    loading: "loading\u2026",
    entrySingular: "{count} entry",
    entryPlural: "{count} entries",
    searching: "searching\u2026",
    scanned: "scanned",
    match: "match",
    matches: "matches",
    forFilter: 'for "{filter}"',
    noMatch: 'no files match "{filter}"',
    emptyDir: "empty directory",
    scanning: "scanning the tree\u2026",
    footerBrowse:
      "\u2191\u2193 navigate \u00b7 Tab drill into folder \u00b7 \u23ce insert \u00b7 esc cancel",
    footerBrowseSearch:
      "\u2191\u2193 navigate \u00b7 Tab / \u23ce insert as @path \u00b7 esc cancel",
    footerInsert: "\u2191\u2193 navigate \u00b7 Tab / \u23ce insert as @path \u00b7 esc cancel",
  },
  statsPanel: {
    modePlan: "PLAN",
    modeYolo: "yolo",
    modeAuto: "auto",
    modeReview: "review",
    pro: "\u21e7 pro",
    budget: "  budget  ",
  },
  welcomeBanner: {
    help: "/help for commands \u00b7 type a task to start",
    workspace: "\u25b8 workspace",
    relaunchHint: "  (relaunch with --dir <path> to switch)",
    dashboard: "\u25b8 web",
  },
  ctxBreakdown: {
    title: "\u25a3 context",
    compactHint: "  /compact folds (auto at 50%) \u00b7 /new wipes log",
    topTools: "  top tool results by cost ({count}):",
    msg: "msg",
    turnLabel: "turn",
  },
  startup: {
    codeRooted:
      '\u25b8 carboncode code: rooted at {rootDir}, session "{session}" \u00b7 {tools} native tool(s){semantic}',
    ephemeral: "(ephemeral)",
    semanticOn: " \u00b7 semantic_search on",
    updateAvailable:
      "\u2b22 Update available: {current} \u2192 {latest}\n  Run `carboncode update` to install.",
    updateInstalling: "\u2b22 Updating {current} \u2192 {latest} in the background\u2026",
    updateInstalled: "\u2713 Updated to {latest} \u00b7 restart carboncode to apply",
    updateFailed: "\u2b22 Auto-update to {latest} failed \u00b7 run `carboncode update` to retry",
  },
  doctorRemediation: {
    apiKey: "run `carboncode setup`, or export DEEPSEEK_API_KEY=sk-…",
    config: "fix or delete ~/.carboncode/config.json, then retry",
    apiReach:
      "check your network + DEEPSEEK_BASE_URL; if the balance is low, top up at platform.deepseek.com",
    tokenizer: "reinstall to restore the tokenizer: npm i -g @carboncode/cli",
    sessions: "run `carboncode prune-sessions` to clear stale sessions",
    semantic:
      "rebuild with `carboncode index`; if using Ollama, make sure it's running and the model is pulled",
    hooks: "fix the JSON syntax in your hooks config file",
    project: "launch from your project root, or run `git init` / add a package.json",
  },
  terminalSetup: {
    report:
      "⬢ terminal check\n  terminal: {program} ({term})\n  truecolor: {color} · TTY: {tty} · OS: {platform}\n\nsuggestion: {advice}",
    yes: "yes",
    no: "no",
    advice: {
      iterm:
        "iTerm2 — if Shift+Enter doesn't add a newline, bind ⇧↩ to Send Escape Sequence `\\n` in Preferences → Profiles → Keys. Paste + truecolor already work.",
      vscode: "VS Code integrated terminal — Shift+Enter and paste already work, no setup needed.",
      appleTerminal:
        "Terminal.app — works, but iTerm2 or WezTerm give smoother Shift+Enter and truecolor.",
      wezterm: "WezTerm — works out of the box: Shift+Enter, paste, and truecolor.",
      windowsTerminal:
        "Windows Terminal — supported; if npm hits a script-policy error, use npm.cmd.",
      generic:
        "Unrecognized terminal — most modern terminals work out of the box. If Shift+Enter doesn't add a newline, use Esc then Enter, or bind a newline key in your terminal settings.",
    },
  },
  doctorErrors: {
    unreadable: "{path} unreadable \u2014 {message}",
    cannotList: "cannot list \u2014 {message}",
    parseFailed: "couldn't parse settings.json \u2014 {message}",
    probeFailed: "probe failed \u2014 {message}",
  },
  doctorReport: {
    labels: {
      apiKey: "api key",
      config: "config",
      proxy: "http proxy",
      apiReach: "api reach",
      tokenizer: "tokenizer",
      sessions: "sessions",
      hooks: "hooks",
      semantic: "semantic",
      project: "project",
    },
    details: {
      proxyDirect: "no HTTPS_PROXY / HTTP_PROXY / ALL_PROXY set \u2014 direct connection",
      proxyRouting: "routing fetch through {url}",
      apiKeyEnv: "set via env DEEPSEEK_API_KEY ({tail})",
      apiKeyConfig: "from {path} ({tail})",
      apiKeyMissing:
        "not set \u2014 `carboncode setup` to save one, or export DEEPSEEK_API_KEY. Get a key at https://platform.deepseek.com/api_keys",
      configMissing: "missing \u2014 running with library defaults. `carboncode setup` writes one.",
      apiReachSkipped: "skipped \u2014 no api key to test with",
      apiReachNull: "/user/balance returned null \u2014 auth failed or network blocked",
      apiReachUnavailable:
        "account flagged not-available ({summary}) \u2014 top up or check your dashboard",
      apiReachOk: "/user/balance ok",
      apiReachOkWithBalance: "/user/balance ok \u2014 {summary}",
      tokenizerMissing:
        "data/deepseek-tokenizer.json.gz not found \u2014 token counts will fall back to char heuristics",
      sessionsZero: "0 saved",
      sessionsSummary: "{count} saved \u00b7 {size} \u00b7 oldest {days}d",
      sessionsStale: "{detail} \u00b7 {stale} idle \u226590d (run `carboncode prune-sessions`)",
      hooksSummary: "{global} global, {project} project",
      semanticNoIndex: "not in use (no semantic index built; `carboncode index` to enable)",
      semanticMismatch:
        "index uses {indexProvider}/{indexModel} but current config resolves to {configProvider}/{configModel} \u2014 rebuild before searching",
      semanticOpenaiOk:
        "openai-compat \u00b7 {baseUrl} \u00b7 model {model} \u00b7 api key configured",
      semanticOllamaMissing:
        "ollama binary not on PATH \u2014 semantic_search will fail; install from https://ollama.com",
      semanticOllamaStopped:
        "ollama daemon not running \u2014 `ollama serve` (or call /semantic in TUI to auto-start)",
      semanticOllamaModelMissing: "model {model} not pulled \u2014 `ollama pull {model}`",
      semanticOllamaReady: "ollama daemon up \u00b7 model {model} ready",
      projectMissing:
        "{path} has none of: {markers} \u2026 \u2014 `carboncode code` will still run, but @-mentions and project memory have nothing to anchor",
      projectOk: "{path} ({markers})",
    },
  },
  webErrors: {
    searchTimeout:
      "web_search: timed out after {ms}ms \u2014 try: check network/proxy (international engines like Mojeek may be blocked on some networks); or switch with /search-engine metaso",
    status:
      "web_search {status} \u2014 try: the search backend returned an error; rephrase the query, or switch engine with /search-engine mojeek|searxng",
    rateLimit429:
      "web_search 429 \u2014 try: wait 10s before retrying, or rephrase the query; the search backend is rate-limiting this client",
    forbidden403:
      "web_search 403 \u2014 try: the search backend is blocking this client; switch engine with /search-engine mojeek|searxng, or wait and retry later",
    serverError5xx:
      "web_search {status} \u2014 try: open the search URL in a browser; if it loads this is transient and a retry in 30s may help",
    mojeekBlocked:
      "web_search: Mojeek anti-bot page \u2014 rate-limited or blocked \u2014 try: wait 30s and retry, or switch engine with /search-engine searxng",
    mojeekNoResults:
      "web_search: 0 results but response doesn't look like a real empty page ({chars} chars, first 120: {preview}) \u2014 try: rephrase the query with simpler terms, or switch engine with /search-engine searxng",
    invalidEndpoint:
      'web_search: invalid SearXNG endpoint "{endpoint}" \u2014 try: set a valid URL with /search-endpoint http://host:port',
    endpointMustBeHttp:
      "web_search: SearXNG endpoint must be http(s), got {protocol} \u2014 try: set a valid URL with /search-endpoint http://host:port",
    cannotReach:
      "web_search: Cannot reach SearXNG server at {endpoint} \u2014 try: install and start SearXNG (https://github.com/searxng/searxng, e.g. `docker run -d -p 8080:8080 searxng/searxng`), or switch to the default engine with /search-engine mojeek",
    searxngNoResults:
      "web_search: 0 results but SearXNG response doesn't look like an empty results page ({chars} chars) \u2014 try: rephrase the query with simpler terms, or switch engine with /search-engine mojeek",
    metasoDailyLimit:
      "web_search: daily search limit reached for the default API key \u2014 set your own METASO_API_KEY env var or get one at https://metaso.cn/search-api/playground",
    metasoUnauthorized:
      "web_search: Metaso API key rejected \u2014 check METASO_API_KEY or get one at https://metaso.cn/search-api/playground",
    metasoRateLimit:
      "web_search: Metaso rate-limited \u2014 wait and retry, or get your own API key at https://metaso.cn/search-api/playground",
    metasoServerError:
      "web_search: Metaso server error ({status}) \u2014 try again later, or switch engine with /search-engine mojeek",
    metasoParseError:
      "web_search: Metaso returned unparseable response (HTTP {status}) \u2014 try again later",
    metasoApiError: "web_search: Metaso API error (code {code}: {message}) \u2014 try again later",
    fetchStatus:
      "web_fetch {status} for {url} \u2014 try: confirm the URL resolves in a browser; status suggests the host returned an error page",
    fetchRateLimit429:
      "web_fetch 429 for {url} \u2014 try: wait 10s before retrying; the host is rate-limiting this client",
    fetchForbidden403:
      "web_fetch 403 for {url} \u2014 try: the host is blocking this client; the page may require login or block bots \u2014 use web_search snippets instead",
    fetchServerError5xx:
      "web_fetch {status} for {url} \u2014 try: open the URL in a browser; if it loads this is transient and a retry in 30s may help",
    fetchTimeout:
      "web_fetch: timed out after {ms}ms for {url} \u2014 try: a shorter URL or smaller content; this may be a slow CDN, or retry once",
    fetchTooLarge:
      "web_fetch refused: content-length {len} bytes exceeds {cap}-byte cap ({url}) \u2014 try: a different URL with smaller content; this page is too large to fetch",
    fetchBodyTooLarge:
      "web_fetch refused: response body exceeded {cap}-byte cap ({seen} bytes seen) \u2014 try: a different URL with smaller content; this page streamed past the size cap",
    fetchInvalidUrl:
      "web_fetch: url must start with http:// or https:// \u2014 try: pass an absolute http(s) URL (the URL is malformed or uses an unsupported scheme)",
  },
  choiceConfirm: {
    customLabel: "Let me type my own answer",
    customDesc:
      "None of the above fits \u2014 type a free-form reply. The model reads it verbatim.",
    cancelLabel: "Cancel \u2014 drop the question",
    cancelDesc: "Model stops and asks what you want instead.",
  },
  cardTitles: {
    usage: "usage",
    context: "context",
    search: "search",
    subagent: "subagent",
    reply: "reply",
    reasoning: "reasoning",
    reasoningAborted: "reasoning (aborted)",
    reasoningEllipsis: "reasoning\u2026",
    error: "error",
    doctor: "doctor",
    you: "you",
    task: "task",
  },
  cardLabels: {
    prompt: "prompt",
    reason: "reason",
    output: "output",
    cache: "cache",
    session: "session",
    balance: "balance",
    turn: "turn",
    system: "system",
    tools: "tools",
    log: "log",
    input: "input",
    topTools: "top tools",
    logMsgs: "log msgs",
    hitSingular: "{count} hit \u00b7 {files} file",
    hitsPlural: "{count} hits \u00b7 {files} files",
    moreHitSingular: "\u22ee +{count} more hit",
    moreHitsPlural: "\u22ee +{count} more hits",
    earlierLine: "\u22ee {count} earlier line (use /tool to read full)",
    earlierLines: "\u22ee {count} earlier lines (use /tool to read full)",
    earlierStackLine: "\u22ee {count} earlier stack line hidden",
    earlierStackLines: "\u22ee {count} earlier stack lines hidden",
    agent: "agent \u00b7 {name}",
    response: "response",
    writing: "writing \u2026",
    tok: "tok",
    pilcrow: "\u00b6",
    aborted: "aborted",
    truncatedByEsc: "[truncated by esc]",
    rejected: "rejected",
    exit: "exit {code}",
    bytesIn: "{bytes} in",
    elapsedSec: "{secs}s",
    stackTrace: "stack trace",
    retries: "retries",
    reasoningLabel: "reasoning \u00b7 {count} \u00b6",
    runningLabel: "running",
    workingLabel: "working",
    defaultFooter: "\u2191\u2193 pick  \u00b7  \u23ce confirm  \u00b7  esc cancel",
    applyAction: "[a] apply",
    skipAction: "[s] skip",
    rejectAction: "[r] reject",
    levelOk: "OK",
    levelWarn: "warn",
    levelFail: "FAIL",
    checksLabel: "checks",
    passed: "passed",
    warnTag: "warn",
    failTag: "fail",
    stepLabel: "step",
    done: "done",
    inProgress: "\u2190 in progress",
    upcoming: "upcoming",
    resumed: "resumed \u00b7 ",
    archive: "\u23ea archive \u00b7 ",
    more: "\u22ee +{count} more",
    categoryUser: "user",
    categoryFeedback: "feedback",
    categoryProject: "project",
    categoryReference: "reference",
  },
  copyMode: {
    title: "── COPY MODE ──",
    help: "j/k or ↑/↓ move · v select · y yank · g/G top/bottom · q quit",
    statusBar: "line {cur}/{total} · selection: {sel}",
    statusYanked: "yanked {size} chars (osc52={osc52})",
    statusEmpty: "nothing selected",
    empty: "(no chat content yet — say something to the model first)",
    labelUser: "you",
    labelAssistant: "assistant",
    labelReasoning: "reasoning",
    yankedToast: "▸ copied {size} chars to clipboard (osc52)",
    yankedToastFile: "▸ copied {size} chars · file: {path}",
  },
  mcpHealth: {
    noData: "no inspect data",
    healthy: "healthy \u00b7 {ms}ms",
    slow: "slow \u00b7 {ms}ms",
    verySlow: "very slow \u00b7 {ms}ms",
    slowToast: "\u26a0 MCP `{name}` slow \u00b7 {seconds}s p95 over the last {sampleSize} calls",
    emptyHint:
      "\u2139 no MCP servers configured \u2014 try: `carboncode setup` to re-pick, or `carboncode mcp install filesystem`",
  },
  denyContextInput: {
    description:
      "Tell the agent why you denied this. The next attempt will see your reason as additional context.",
  },
  cardStream: {
    scrollAbove: " \u2191 {scroll} / {max} row above",
    scrollAbovePlural: " \u2191 {scroll} / {max} rows above",
    scrollMore: " \u2014 {remaining} more",
    scrollPgUp: " \u00b7 PgUp / wheel / \u2191",
  },
  slashArgPicker: {
    noMatch: 'no match for "{partial}"',
    keepTyping: " \u2014 keep typing, or Backspace to edit",
    above: "   \u2191 {hidden} above",
    below: "   \u2193 {hidden} below",
    footer: "  \u2191\u2193 navigate \u00b7 Tab / \u23ce pick \u00b7 esc cancel",
  },
  mcpMarketplace: {
    title: "MCP marketplace",
    filter: "filter: ",
    filterPlaceholder: "(type to filter)",
    matchSingular: "{n} match",
    matchPlural: "{n} matches",
    loading: "loading\u2026",
    noEntries: "no entries",
    opening: "opening registry\u2026",
    cached: "\u00b7 cached",
    exhausted: "\u00b7 exhausted",
    loadingMore: "loading more\u2026",
    allLoaded: "all pages loaded",
    fetchingDetail: "fetching smithery detail\u2026",
    noInstallInfo: "no install info for {name} - try `npx -y @smithery/cli install {name}`",
    alreadyInstalled: "already installed: {spec}",
    installed: "installed \u2192 {spec}",
    uninstalled: "uninstalled {name}",
    installFailed: "install failed: {message}",
    notInstalled: "not installed: {name}",
    bridged: "\u2713 installed {name} - bridged",
    bridgeFailed: "\u25b2 installed {name} - bridge failed: {reason}",
    bridgeReloadFailed:
      "\u2713 installed {name} - restart `carboncode code` to bridge (reload failed: {message})",
    restartBridge: "\u2713 installed {name} - restart `carboncode code` to bridge",
    needsEnv: "  \u00b7  needs env: {env}",
    badgeOfficial: "[off]",
    badgeSmithery: "[smt]",
    badgeLocal: "[loc]",
    footerHint:
      "type filter \u00b7 \u2191\u2193 pick \u00b7 \u23ce install/toggle \u00b7 PgDn load more \u00b7 esc close",
    specLine: "spec: {runtime} {id} \u00b7 {transport}",
    smitheryDetail: "(smithery listing \u2014 install detail fetched on Enter)",
    statusError: "error: {message}",
  },
  mcpBrowser: {
    title: "\u25c8 MCP browser",
    empty: "No MCP servers attached. Run `carboncode setup` to pick some, or launch with --mcp.",
    serverCount: "{count} server{s}",
    footer: "\u2191\u2193 pick \u00b7 [r] reconnect \u00b7 [d] disable \u00b7 esc quit",
  },
  mcpLifecycle: {
    profileSkipped:
      'tool profile auto · skipped redundant code-mode MCP servers: {servers} · set mcpToolProfile to "full" to restore',
    toolBudget: "request tools: {nativeTools} native + {mcpTools} MCP = {activeTools}/{maxTools}",
    toolBudgetExceededTitle: "MCP tool limit exceeded",
    toolBudgetExceeded:
      "tool limit exceeded: {activeTools}/{maxTools}. Disable unused MCP servers before sending a task.",
    handshake: "handshake\u2026",
    connected: "connected",
    failed: "failed",
    disabled: "disabled",
    reconnect: "reconnect\u2026",
    initDetail: "initialise \u2192 tools/list \u2192 resources/list",
    reconnectDetail: "tearing down \u00b7 re-handshake \u00b7 listing tools",
    disabledDetail: "via /mcp disable {name}",
    failedSetupHint:
      "→ run `carboncode setup` to remove this entry, or fix the underlying issue (missing npm package, network, etc.).",
    failedSetupConfigHint:
      "→ run `carboncode setup` to remove broken entries from your saved config.",
    startupSummary: "MCP ready · {connected}/{total} connected · {tools} tools · details: /mcp",
    startupSummaryIssues:
      "MCP ready · {connected}/{total} connected · {tools} tools · {disabled} disabled · {failed} failed · details: /mcp",
  },
  checkpointPicker: {
    title: "restore a checkpoint \u2014 {workspace}",
    header: " \u25c8 CARBON CODE \u00b7 pick a checkpoint ",
    empty: "  no checkpoints in this workspace yet - see /checkpoint to make one",
    more: "     \u2026 {hidden} more",
    footer: "  \u2191\u2193 pick  \u00b7  \u23ce restore  \u00b7  [d] forget  \u00b7  esc quit",
    footerEmpty: "  esc quit",
  },
  planReviseConfirm: {
    title: "plan revision proposed",
    metaRight: "\u2212{removed}  +{added}  \u00b7  {kept} kept",
    updatedSummary: "updated summary: {summary}",
    acceptLabel: "Accept revision - apply the new step list",
    acceptHint: "Replaces the remaining plan with the proposed steps. Done steps are untouched.",
    rejectLabel: "Reject - keep the original plan",
    rejectHint: "Drops the proposal. Model continues with the original remaining steps.",
  },
  diffApp: {
    title: "carboncode diff",
    turnLabel: "turn {turn} ({current}/{total})",
    turnsAligned: "{count} turns aligned",
    paneEmpty: "(no records on this side for this turn)",
    kindMatch: "\u2713 match",
    kindDiverge: "\u2605 diverge",
    kindOnlyInA: "\u2190 only in A",
    kindOnlyInB: "\u2192 only in B",
  },
  recordView: {
    userPrefix: "you \u203a ",
    assistant: "assistant",
    toolPrefix: "tool<",
    argsLabel: "  args: ",
    resultArrow: "  \u2192 ",
    error: "error ",
    cache: "  \u00b7 cache ",
    toolCallOnly: "(tool-call response only)",
    truncateExtra: "(+{extra} chars)",
  },
  replayApp: {
    emptyTranscript: "empty transcript",
    turnProgress: "turn {current}/{total}",
    noRecords: "no records",
    untracked: "(untracked)",
    churned: "(churned \u00d7{count})",
  },
};
