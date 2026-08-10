# Carbon Code

Carbon Code is a Claude Code–style coding tool, and the first DeepSeek-based
coding tool from China — cutting token cost by over 90%. It does automatic task
breakdown, autonomous development, MCP testing, and multi-agent collaboration
with Claude or Codex, with capability approaching Claude Sonnet 4.6.

Carbon Code is aimed at personal developer workflows: open a repository, let the
agent read and search the codebase, review planned edits, approve shell commands,
run validation, and keep a concise session trail.

简体中文：[README.md](README.md)

## Install

Requires Node.js 22 or newer.

```bash
npm install -g @carboncode/cli
cd path/to/project
carboncode
```

On Windows PowerShell, if `npm` fails with a script execution policy error, use
`npm.cmd` instead:

```powershell
npm.cmd install -g @carboncode/cli
```

Short command:

```bash
ccode
```

One-off usage without a global install:

```bash
npx @carboncode/cli
```

## Commands

| Command | Purpose |
| --- | --- |
| `carboncode` | Start the coding agent in the current project (same as `carboncode code`). |
| `carboncode code [dir]` | Start the coding agent in `[dir]`; omit `[dir]` for the current directory. |
| `carboncode chat` | Chat without filesystem or shell tools. |
| `carboncode run "task"` | Non-interactive one-shot task. |
| `carboncode init [dir]` | Analyze a project and generate a `CARBON.md` guide. |
| `carboncode doctor` | Local health check. |
| `carboncode update` | Check and install the latest CLI package. |

Carbon Code also installs `ccode`. It intentionally does not install `cc`,
because that name commonly points to the system C compiler.

## Configuration

Carbon Code stores user configuration in:

```text
~/.carboncode/config.json
```

Set a DeepSeek API key with the first-run setup wizard, or export it directly:

```bash
export DEEPSEEK_API_KEY=sk-...
```

Project rules should live in `AGENTS.md` or `CARBON.md` in the repository.

Initialize a rules file for an existing project:

```bash
carboncode init
carboncode init --dry-run
carboncode init --force --yes
```

The command reads repository manifests, directories, and tool configuration without
calling a model. Existing rules are protected unless `--force` is supplied.

Model presets use the current DeepSeek V4 API IDs: `flash` maps to
`deepseek-v4-flash`, `pro` maps to `deepseek-v4-pro`, and `auto` starts on Flash
with one-turn Pro escalation for harder turns.

Desktop also supports standard OpenAI-compatible providers. Under
**Settings -> Models -> Add model provider**, enter the Base URL and API key first;
the app discovers `/models`, recommends an agent model, and safely adapts between
the Responses and Chat Completions APIs. Newly returned model IDs work without a
local capability-registry entry. See the
[OpenAI-compatible provider guide](docs/OPENAI-COMPATIBLE-PROVIDERS.md) for the
runtime contract, security boundary, and repeatable end-to-end verifier.

### Error diagnostics

Carbon Code collects redacted `error` and `fatal` metadata and stack traces by default to diagnose release failures. It does not upload chats, model output, file contents, full command arguments, API keys, tokens, cookies, or environment values. Offline events are kept in a bounded queue under `~/.carboncode/diagnostics/pending/`.

Disable collection from Desktop under **Settings -> General -> Error diagnostics**, or through configuration/environment:

```json
{
  "diagnostics": { "enabled": false }
}
```

```bash
export CARBONCODE_DIAGNOSTICS=off
```

## License And Attribution

Carbon Code is MIT licensed.

Third-party MIT notices are preserved in:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

Do not remove copyright or MIT notices from derived files.
