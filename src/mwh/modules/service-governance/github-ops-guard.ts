import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: GitHub Ops Guard Middleware

## Purpose

Use this module when an agent or automation needs to operate around GitHub issues, PRs, comments, labels, reviews, or merges without confusing git transport credentials with GitHub API credentials.

The module captures two reusable lessons:

- Being able to \`git push\` does not prove permission to use the GitHub API for PR comments, merges, labels, closes, or reviews.
- Prefer GitHub CLI account workflows (\`gh auth login\`, \`gh auth switch\`, \`gh auth status\`) before asking users for PATs.

## Sources

- Carbon collaboration inbox note: "GitHub CLI / PAT permission note for collaborator PR operations".
- oh-my-openagent \`github-triage\` skill: read-only GitHub issue/PR triage, exhaustive pagination, zero mutation, evidence-backed reports.

## Recommended Architecture

- \`core.ts\`: pure auth diagnosis, command classification, mutation guard, pagination plans, and issue/PR triage classification.
- \`memory-store.ts\`: stateful auth snapshot, mutation policy, command guard audit log, and batch triage classification.
- provider adapters:
  - \`gh-cli.ts\`: executes read-only \`gh\` commands and checks \`gh auth status\`.
  - \`github-api.ts\`: non-interactive API adapter using an acting-account token.
  - \`report-writer.ts\`: writes evidence-backed issue/PR reports.

## Credential Policy

1. Distinguish \`git\` credentials from GitHub API credentials.
2. For API operations, first check whether \`gh\` is installed and authenticated.
3. If \`gh\` is installed but authenticated as the wrong account, prefer \`gh auth switch\`.
4. If \`gh\` is unavailable or unsuitable, use a token owned by the acting account.
5. For collaborator repositories, expect fine-grained PAT limitations; classic PAT or \`gh auth login\` may be required.
6. Explain that PR API operations require repo/public_repo and PR-related permissions as appropriate.

## Read-Only Triage Policy

Use this mode for automated issue/PR analysis:

- Allowed: \`gh issue view\`, \`gh pr view\`, \`gh api\` GET, local code reads, \`git log\`, \`git show\`, \`git blame\`.
- Forbidden: comments, closes, edits, labels, merges, reviews, POST/PUT/PATCH/DELETE API calls.
- Every factual claim in reports should include a commit-SHA GitHub permalink.
- Fetch basic metadata first; fetch full bodies/comments per item to avoid large JSON/control-character failures.
- Paginate with a 500-item batch and \`created:<lastCreatedAt\` until all items are covered.

## Public API Sketch

\`\`\`ts
const guard = new MemoryGitHubOpsGuard({
  auth: {
    gitRemoteUser: "Yapie0",
    ghInstalled: true,
    ghAuthenticatedUser: "Cyberforker",
  },
});

const diagnosis = guard.diagnose();
const read = guard.guard(["gh", "pr", "view", "1", "--json", "files"]);
const write = guard.guard(["gh", "pr", "merge", "1"]);
\`\`\`

## Verification Checklist

- Stateless tests cover auth diagnosis, preferred auth flow, git-vs-gh operation classification, mutation blocking, pagination plan generation, and issue/PR classification.
- Stateful tests cover auth updates, read-only guard audit, mutation policy changes, triage batch classification, and clone-safe audit reads.
- Adapter tests should mock \`gh auth status\`, missing \`gh\`, wrong-account \`gh auth switch\`, and token fallback behavior.
`;

export const GITHUB_OPS_GUARD_MODULE: MwhModule = {
  id: "github-ops-guard",
  title: "GitHub Ops Guard Middleware",
  summary:
    "Reusable GitHub operations guard for gh/PAT auth diagnosis, mutation blocking, read-only triage, and exhaustive issue/PR pagination.",
  version: "0.1.0",
  tags: ["github", "gh-cli", "auth", "triage", "pull-request", "service-governance", "middleware"],
  source: {
    kind: "builtin",
    label: "Carbon Code built-in",
    url: "refs/oh-my-openagent/.agents/skills/github-triage/SKILL.md",
  },
  content: CONTENT,
};
