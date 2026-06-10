# Carbon Code

Chinese-first, DeepSeek-powered terminal coding agent for personal developer
workflows.

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

Model presets use the current DeepSeek V4 API IDs: `flash` maps to
`deepseek-v4-flash`, `pro` maps to `deepseek-v4-pro`, and `auto` starts on Flash
with one-turn Pro escalation for harder turns.

## License And Attribution

Carbon Code is MIT licensed.

Third-party MIT notices are preserved in:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

Do not remove copyright or MIT notices from derived files.
