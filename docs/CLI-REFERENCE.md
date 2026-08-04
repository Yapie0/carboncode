# Carbon Code CLI Reference

Every shell subcommand, every TUI slash command, every keybinding. The in-app `/help` and `/keys` panels are the live source of truth — this page is the printable companion.

---

## Shell subcommands

Run `carboncode --help` (or any subcommand with `--help`) for the full flag list. Headline subcommands:

| Subcommand | What it does |
|---|---|
| `carboncode code [dir]` | Code-mode TUI — file edits, plan mode, edit-gate, project-scoped sessions |
| `carboncode chat` | Chat-only TUI — no filesystem access, no code mode |
| `carboncode run <task>` | Headless run — read prompt, execute, exit (CI-friendly) |
| `carboncode setup` | Interactive first-run config (API key, language, theme) |
| `carboncode sessions [name]` | List or open a saved session |
| `carboncode prune-sessions` | Drop sessions older than `--days N` |
| `carboncode replay <transcript>` | Re-render a JSONL transcript without calling the model |
| `carboncode diff <a> <b>` | Compare two transcripts (cost / cache / tokens) |
| `carboncode events <name>` | Tail the event log for a session |
| `carboncode stats [transcript]` | One-shot cost / cache breakdown |
| `carboncode doctor` | Health check — API reach, config, hooks, project |
| `carboncode commit` | `git add -A && git commit` with an LLM-written message |
| `carboncode mcp <list\|search\|install\|inspect\|browse>` | MCP server management |
| `carboncode index` | Build the local semantic index (Ollama or OpenAI-compatible embeddings) |
| `carboncode version` / `carboncode update` | Version info + upgrade hint |

### Notable runtime flags (chat / code)

| Flag | Effect |
|---|---|
| `--no-session` | Ephemeral run — nothing is persisted |
| `--session <name>` | Resume / pin to a named session |
| `--continue` | Resume the most recent session for this workspace |
| `--new` | Force a fresh session even if one exists |
| `--budget <usd>` | Per-session USD cap — warns at 80%, refuses next turn at 100% |
| `--preset <auto\|flash\|pro>` | Model bundle (auto-escalation, locked flash, locked pro) |
| `--mcp <spec>` | Attach an MCP server for this run (repeatable) |
| `--no-config` | Ignore `~/.carboncode/config.json` for this run |
| `--no-dashboard` | Don't auto-start the embedded web dashboard |
| `--no-alt-screen` | Render to scrollback instead of the alt-screen buffer (preserves chat in shell history; legacy mode, can ghost on resize) |
| `--no-mouse` | Disable DECSET 1007 (alternate-scroll); wheel reverts to native terminal scroll |

### Local development via `npm run dev`

`npm run dev` executes `tsx src/cli/index.ts`. When passing Carbon Code flags or
subcommands through npm, put them after npm's `--` separator. Without the
separator, npm treats flags such as `--setup` or `-c` as npm options instead of
Carbon Code arguments.

| Goal | Command |
|---|---|
| Start the source TUI normally | `npm run dev` |
| Re-run setup / update API key | `npm run dev -- setup` |
| Continue the latest bare code session | `npm run dev -- -c` |
| Resume the latest code session explicitly | `npm run dev -- code -r` |
| Start chat and continue the latest chat session | `npm run dev -- chat -c` |
| Resume a named chat session | `npm run dev -- chat --session <name> -r` |
| Show cross-session usage stats | `npm run dev -- stats` |

For direct execution without npm's argument separator, use
`npx tsx src/cli/index.ts ...`, for example `npx tsx src/cli/index.ts setup`.

Session defaults differ slightly by entrypoint:

- Bare `carboncode` / `npm run dev` starts a fresh code session after setup.
- Bare `-c` / `--continue` resumes the most recent session for the workspace.
- `code -r` resumes the latest project-scoped code session.
- `chat -c` continues the most recently touched chat session; `chat --session <name> -r` resumes a specific named session.

---

## Slash commands

Type `/` mid-chat to open the picker. Aliases shown in parentheses. Code-mode-only commands marked **(code)**.

### Chat ops

| Command | What it does |
|---|---|
| `/help` (`/?`) | Show the full command reference inline |
| `/new` (`/reset`, `/clear`) | Start a fresh conversation (clear context + scrollback) |
| `/retry` | Truncate and resend your last message — fresh sample |
| `/compact` | Fold older turns into a summary (cache-safe). Auto-fires at 50% ctx; this is the manual trigger |
| `/stop` | Abort the current model turn (typed alternative to Esc) |
| `/btw <question>` | Ask a side question without changing the main conversation |
| `/copy` | Open vim/tmux-style copy mode — `j`/`k` navigate, `v` select, `y` yank to clipboard. The right answer for SSH / mosh / tmux where drag-select can't extend past the viewport |

### Setup

| Command | What it does |
|---|---|
| `/preset <auto\|flash\|pro>` | Switch model bundle. Bare opens picker |
| `/model <id>` | Switch DeepSeek model id. Bare opens picker |
| `/thinking [auto\|on\|off]` | Show or set DeepSeek thinking mode |
| `/max-output [tokens\|off]` | Show, cap, or clear the maximum output token count |
| `/language <EN\|zh-CN>` (`/lang`) | Switch the runtime language |
| `/theme <name>` | Show or persist terminal theme. Bare opens picker |
| `/config` | Open configuration guidance and current config paths |
| `/vim [on\|off]` | Toggle vim-style input editing |

### Info

| Command | What it does |
|---|---|
| `/status` | Current model, flags, context, session |
| `/cost [text]` | Bare → last turn's spend; with text → estimate cost of sending it next |
| `/pricing [open]` | Show the pricing table used for cost math, override example, and official DeepSeek pricing reference |
| `/context` | Context-window breakdown (system / tools / log / input) |
| `/stats` | Cross-session cost dashboard (today / week / month / all-time) |
| `/statusline <minimal\|default\|full>` | Persist status-bar density. `full` shows the most fields; restart the TUI after changing it |
| `/doctor` | Health check (api / config / api-reach / index / hooks / project) |
| `/terminal-setup` | Show terminal integration setup help |
| `/output-style [default\|explanatory\|learning]` | Switch response style |
| `/keys` | Keyboard + mouse + copy/paste reference |
| `/feedback` | Open a GitHub issue with diagnostic info copied to clipboard |

### Extend

| Command | What it does |
|---|---|
| `/mcp` | Open the MCP hub (live + marketplace tabs) |
| `/resource [uri]` | Browse / read MCP resources |
| `/prompt [name]` | Browse / fetch MCP prompts |
| `/memory [for <path>\|list\|show\|forget\|clear]` | Manage pinned memory (AGENTS.md / CARBON.md + `~/.carboncode/memory`) |
| `/skill [list\|paths\|show\|new\|<name>]` | List / run / scaffold user skills |
| `/mwh [list\|installed\|search <query>\|show <id>\|install <id>\|check\|update\|root]` | Browse and install reusable Middlewave Hub modules |
| `/agents [list\|show\|new]` (`/agent`) | Manage project agents |
| `/teams [create\|status\|inbox\|run\|dispatch]` | Manage multi-agent Carbon Code Teams |
| `/qq <connect\|status\|disconnect>` | Connect, inspect, or disconnect the QQ channel |
| `/collab [agent]` | Enter local collaboration mode and print a prompt for another coding agent |

### Session

| Command | What it does |
|---|---|
| `/sessions` | List saved sessions (current marked with ▸) |
| `/resume` | Resume a saved session |
| `/export [json]` | Export the current conversation |
| `/title` (`/retitle`) | Rename the current session |

### Code mode

| Command | What it does |
|---|---|
| `/review [ref]` | Review the working tree or a git ref |
| `/init [force]` | Scan project, synthesize a baseline `CARBON.md` |
| `/apply [N\|N,M\|N-M]` | Commit pending edit blocks to disk (subset selection supported) |
| `/discard [N\|N,M\|N-M]` | Drop pending edits without writing |
| `/walk` | Step through pending edits one block at a time (git-add-p style) |
| `/undo` | Roll back the last applied edit batch |
| `/history` | List every edit batch this session |
| `/show [id]` | Dump a stored edit diff |
| `/commit "msg"` | `git add -A && git commit -m ...` |
| `/mode <review\|auto\|yolo>` | Edit-gate mode. Shift+Tab cycles |
| `/plan [on\|off]` | Toggle read-only plan mode. Submitted plans initially show a compact summary; press `Ctrl+P` in the plan confirmation modal to expand/collapse full details |
| `/checkpoint [name\|list\|forget]` | Snapshot every file the session has touched |
| `/restore <name\|id>` | Roll back to a named checkpoint |
| `/cwd <path>` (`/sandbox`) | Switch the workspace root mid-session |
| `/add-dir [path]` | Add another directory to the current workspace |

### Jobs (code mode)

| Command | What it does |
|---|---|
| `/jobs` | List background jobs |
| `/kill <id>` | Stop a background job (SIGTERM → SIGKILL) |
| `/logs <id> [lines]` | Tail a job's output (default 80 lines) |

### Advanced

| Command | What it does |
|---|---|
| `/pro [off]` | Arm v4-pro for the NEXT turn only |
| `/budget [usd\|off]` | Session USD cap |
| `/search-engine <mojeek\|searxng\|metaso>` (`/se`) | Switch web search backend |
| `/hooks [reload]` | List / reload hooks |
| `/permissions [list\|add\|remove\|clear]` | Edit shell allowlist |
| `/dashboard [stop]` | Launch / stop the embedded web dashboard |
| `/loop <interval> <prompt>` | Auto-resubmit a prompt every interval |
| `/plans` | List active + archived plans |
| `/replay [N]` | Load an archived plan as a read-only Time Travel snapshot |
| `/update` | Show current vs latest version |
| `/exit` (`/quit`, `/q`) | Quit the TUI |

---

## Keyboard

| Key | What it does |
|---|---|
| `Enter` | Submit the prompt |
| `Shift+Enter` | Insert a newline in the prompt |
| `↑` / `↓` | Scroll chat history (mouse wheel routes here too) |
| `Ctrl+P` / `Ctrl+N` | Previous / next prompt history · cursor up / down in a multi-line draft. In a submitted-plan confirmation modal, `Ctrl+P` expands/collapses full plan details |
| `Ctrl+A` / `Ctrl+E` | Jump to start / end of the current line |
| `Ctrl+W` | Delete the word before the cursor |
| `Ctrl+U` | Clear the entire prompt buffer |
| `Tab` | Complete @-mention · drill folder · accept slash command |
| `Shift+Tab` | Edit-gate: toggle review ↔ AUTO mode |
| `Esc` | Dismiss picker · abort the running model turn |
| `Ctrl+C` | Abort the running model turn (NOT copy — see clipboard) |
| `PgUp` / `PgDn` | Scroll chat history a page at a time. While plan details are expanded, scroll the bounded detail window |
| `End` | Jump chat to the most recent line |

If a model turn is already running, the prompt remains editable. Pressing
`Enter` queues the next user message; queued messages are sent FIFO as soon as
the current turn finishes. Remote confirmation replies, such as QQ approval
messages, may bypass the normal queue when they are needed to unblock an active
pause gate.

### Edit-gate (code mode)

| Key | What it does |
|---|---|
| `y` / `n` | Accept / drop pending edits in the review modal |
| `Shift+Tab` | Toggle review ↔ AUTO (persisted across sessions) |
| `u` | Undo the last auto-applied batch (within the 5s banner) |

Edit-gate modes:

- `review`: edits queue for `/apply` or `y`; shell commands still require approval unless allowlisted.
- `auto`: edits apply immediately; shell commands still require approval unless allowlisted.
- `yolo`: edits and shell gates are skipped. Use only inside a sandbox or disposable workspace.

The selected mode is persisted in `~/.carboncode/config.json`. Use `/mode yolo`
inside the TUI to enter yolo mode; for ACP sessions use `carboncode acp --yolo`.

---

## Setup, API keys, and usage

Run `carboncode setup` to re-run the setup wizard and replace a saved DeepSeek
API key. In local source mode, run `npm run dev -- setup`; `npm run dev --setup`
is an npm option and will not invoke Carbon Code setup.

Configuration is stored in `~/.carboncode/config.json`. `DEEPSEEK_API_KEY` can
also be exported for a temporary override.

Cost visibility:

- The bottom status bar shows the latest turn cost as `turn`.
- The same bottom bar shows cumulative current-session cost as `session` after at least one completed turn unless `showSessionCost` is explicitly disabled.
- Context usage is separate from cost and appears as `ctx` / context, for example `26% · 258K/1000K`.
- `/cost` shows the most recent turn's detailed usage card, or estimates a draft prompt if text is supplied.
- `/pricing` shows the current model's USD-per-1M-token price table, the exact cost formula, and a `pricingOverride` example for `~/.carboncode/config.json`.
- `/pricing open` opens the DeepSeek official pricing reference page. Carbon Code does not rely on a provider pricing API at runtime; it uses built-in rates plus local overrides.
- `/stats` / `carboncode stats` summarizes usage across sessions.
- `/statusline full` enables the densest bottom bar preset; restart the TUI after changing it.

Cost math uses model provider token usage returned by the chat completion response:

```text
(promptCacheHitTokens * inputCacheHit
 + promptCacheMissTokens * inputCacheMiss
 + completionTokens * output) / 1_000_000
```

All price values are USD per 1M tokens. To adjust rates manually:

```json
{
  "pricingOverride": {
    "deepseek-v4-flash": {
      "inputCacheHit": 0.0028,
      "inputCacheMiss": 0.14,
      "output": 0.28
    }
  }
}
```

Code-mode delivery contract:

- For code changes, Carbon Code's prompt instructs the agent to inspect, patch, verify, then summarize.
- The agent should run the narrowest relevant test, typecheck, lint, build, or smoke command it can identify before final delivery.
- Final replies should include the validation commands that were run, or explicitly say why validation could not be run.

---

## Mouse

| Action | What it does |
|---|---|
| Wheel | Scrolls chat history (works on web / cloud / SSH terminals too) |
| Drag | Selects text natively — no modifier needed |
| Right-click | Terminal-native (e.g. paste menu on Windows Terminal) |

Carbon Code sets DECSET 1007 (alternate-scroll) only — wheel events translate to ↑/↓ keypresses for the app, but native click/drag selection is left untouched. Pass `--no-mouse` to opt out entirely.

---

## Copy / paste

The default path is **terminal-native**. Drag to select, then use your terminal's normal copy keys:

| Action | How |
|---|---|
| Select text | Drag — terminal-native (no modifier) |
| Copy | `Ctrl+Shift+C` (Win / Linux) · `Cmd+C` (macOS) — or auto-copy-on-select if your terminal does it |
| Paste | `Ctrl+V` or `Ctrl+Shift+V` (Win / Linux) · `Cmd+V` (macOS) |
| Multi-line paste | Bracketed paste — pastes stay one block, no auto-submit on intermediate newlines |

### When drag-select doesn't work

In SSH / mosh / tmux, the alt-screen buffer prevents the terminal from extending the selection past the visible viewport — there is no scrollback above the alt-screen to drag into. Two fixes:

1. **`/copy`** — open vim/tmux-style copy mode in-app. Snapshots the current chat to a navigable buffer; `y` yanks to clipboard via OSC 52 (with a temp-file fallback for terminals that don't support it).
2. **`--no-alt-screen`** — render to shell scrollback instead. Drag-select then works terminal-natively (the chat content is real lines in the scrollback above your cursor). Trade-off: redraw can ghost on resize.

### `/copy` — copy mode keys

| Key | What it does |
|---|---|
| `j` / `↓` | Cursor down one line |
| `k` / `↑` | Cursor up one line |
| `PgUp` / `PgDn` | Page up / down |
| `g` / `G` | Jump to top / bottom |
| `v` | Start (or cancel) selection at the cursor |
| `y` / `Enter` | Yank selection to clipboard, exit |
| `q` / `Esc` | Quit without yanking |

`y` with no active selection yanks just the current line. The yank goes through OSC 52 first (works through SSH, mosh, tmux with `set -g set-clipboard on`); content larger than 75 KB falls back to a temp file whose path is printed on exit.

---

## Where this lives

In-app, `/keys` and `/help` print the same content the model knows about. This page mirrors them so the reference is greppable from the repo / website.
