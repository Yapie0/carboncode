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

## Multiple Models And Providers

`/model` now manages reusable model profiles for the active single-agent session,
not only DeepSeek model IDs. Profiles can use OpenAI's official service or any
self-hosted/company relay compatible with the OpenAI Responses API:

```text
/model                         # open the model picker
/model add                     # guided provider, model, base URL, and key setup
/model list                    # inspect profiles, key readiness, and the active model
/model update company-gpt      # update and revalidate a profile
/model remove company-gpt      # remove an inactive custom profile
/model company-gpt             # switch provider + model in the current session
```

Relay setup asks for a base URL, model ID, profile name, and masked API key.
Carbon Code connects directly without a separate proxy. It validates through
`/models`, with a minimal `/responses` fallback for gateways without a model-list
endpoint. Profile metadata is stored in `~/.carboncode/config.json`; raw keys live
in the separate user-level `~/.carboncode/credentials.json` and never enter regular
config, session history, or the project. The file is owner-only where supported,
and explicit environment variables always take precedence.

One provider or relay can expose multiple model profiles. DeepSeek profiles share
the existing DeepSeek key, official OpenAI profiles share `OPENAI_API_KEY`, and
profiles with the same relay base URL reuse one key environment variable. After a
restart, Carbon Code restores these keys automatically from the user credential store.

## Experimental Multi-Agent

Multi-Agent is one consumer of the shared model profiles, not a separate model
configuration system. Carbon Code can run a small real
benchmark, and assign the design, implementation, testing, and acceptance stages
to different models in sequence.

Local development still starts the usual way:

```powershell
npm run dev
```

Configure and run the workflow inside the TUI:

```text
/model add
/multi-agent models
/multi-agent enable deepseek-pro company-gpt
/multi-agent benchmark deepseek-pro company-gpt
/multi-agent assignments
/multi-agent run implement a feature with focused tests
```

`/multi-agent setup` remains as a compatibility alias for `/model add` and opens
the same model setup wizard. Added or updated profiles can be selected directly
with `/model <profile>` and are also available to Multi-Agent. Benchmarks make
real paid API calls: a full run uses four calls
per candidate, one for each role.

See the [multi-provider Multi-Agent guide](docs/multi-agent.md) for architecture,
safety boundaries, custom candidates, and non-interactive CLI usage.

## License And Attribution

Carbon Code is MIT licensed.

Third-party MIT notices are preserved in:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

Do not remove copyright or MIT notices from derived files.
