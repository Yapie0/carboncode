# Carbon Code

Chinese-first, DeepSeek-powered terminal coding agent for personal developer
workflows.

Carbon Code is aimed at personal developer workflows: open a repository, let the
agent read and search the codebase, review planned edits, approve shell commands,
run validation, and keep a concise session trail.

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
| `carboncode` / `carboncode code [dir]` | Coding agent rooted at the current project. |
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

## Release

npm publishing is tag-driven through GitHub Actions after the package is
configured for Trusted Publishing on npmjs.com. In the npm package settings, add
a GitHub Actions trusted publisher with repository `Yapie0/carboncode`, workflow
file `publish.yml`, and environment `npm`.

To release, update `package.json`, commit the release, then push a matching
semver tag:

```bash
git tag v0.1.0
git push origin main --tags
```

The `Publish npm package` workflow verifies the package, checks that the tag
matches `package.json`, and runs `npm publish --access public --provenance`. If
the exact version already exists with the same `gitHead`, the workflow treats the
tag as an idempotent release marker and skips the publish step.

## Current Scope

Carbon Code is currently early-stage and focused on the personal CLI workflow:
package identity, command names, Carbon config paths, update/install commands,
Chinese-first CLI copy, npm publishing, and license compliance.

## License And Attribution

Carbon Code is MIT licensed.

Third-party MIT notices are preserved in:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

Do not remove copyright or MIT notices from derived files.
