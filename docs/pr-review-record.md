# PR review record

Last refreshed: 2026-06-11

Source: GitHub API, open PRs for `Yapie0/carboncode`.

## Queue summary

There are 19 open PRs at the time of this audit.

| PR | Title | Author | Draft | Base | Head | Initial disposition |
| --- | --- | --- | --- | --- | --- | --- |
| #93 | `[carboncode] Add project initialization command` | Star-Star66 | yes | `734e32b` | `0437479` | draft-only; review later |
| #92 | `test(git-diffs): add parseGitDiff tests and fix regex bugs` | yvng-jie | no | `734e32b` | `fe6d70e` | merge-candidate after focused review |
| #91 | `Prefer Carbon dashboard storage keys` | Star-Star66 | no | `e44989c` | `ff6aa18` | needs-refresh; old base |
| #90 | `Skip symlink version test when permissions block symlinks` | Star-Star66 | no | `e44989c` | `7fa7641` | needs-refresh; likely useful CI unblock |
| #89 | `Unskip status row balance tests` | Star-Star66 | no | `e44989c` | `6fd4d62` | needs-refresh; verify current tests |
| #88 | `Stop stats after missing transcript` | Star-Star66 | no | `e44989c` | `50c0b76` | needs-refresh |
| #87 | `Reject empty session title slugs` | Star-Star66 | no | `e44989c` | `4b092cd` | needs-refresh |
| #86 | `Strictly parse CLI count options` | Star-Star66 | no | `e44989c` | `b338495` | needs-refresh |
| #85 | `Validate prune session days` | Star-Star66 | no | `e44989c` | `b6052b9` | needs-refresh |
| #84 | `Fix npm update prefix for symlinked bins` | Star-Star66 | no | `e44989c` | `93a2a4c` | needs-refresh |
| #83 | `Validate dashboard checkpoint ids` | Star-Star66 | no | `e44989c` | `b45c916` | needs-refresh |
| #82 | `Handle malformed dashboard URL encodings` | Star-Star66 | no | `e44989c` | `d38a7a9` | needs-refresh |
| #81 | `Make dashboard auth diagnostics ASCII-safe` | Star-Star66 | no | `e44989c` | `053984b` | likely superseded by local dashboard auth fixes; verify before close |
| #80 | `Replace stale preset max slash copy` | Star-Star66 | no | `e44989c` | `7da5610` | needs-refresh |
| #79 | `Fix filesystem MCP package in config docs` | Star-Star66 | no | `e44989c` | `0cd83e7` | needs-refresh |
| #78 | `Clarify slash command documentation contract` | Star-Star66 | no | `e44989c` | `d5ea72e` | needs-refresh |
| #77 | `Document new slash commands` | Star-Star66 | no | `e44989c` | `95200c7` | needs-refresh |
| #76 | `Sync memory slash help copy` | Star-Star66 | no | `e44989c` | `04b13ef` | needs-refresh |
| #75 | `Fix dashboard diff line counts` | Star-Star66 | no | `e44989c` | `3d26fc4` | needs-refresh |

## Next review pass

Recommended first batch:

1. Review #92 first because it is recent, non-draft, and appears to include focused parser tests.
2. Review #90 next if current CI still has Windows symlink noise.
3. Review small stale fixes #75-#88 one by one after rebasing or checking whether current `main` already absorbed them.
4. Keep #93 out of merge decisions until it exits draft.
5. Treat #81 as likely superseded by the dashboard auth/token work already applied locally; verify exact diff before closing.

Contributor-friendly handling for the next pass:

- For harmless contributor PRs, prefer `repair-and-merge` over asking the author to fix small formatting, naming, copy, or test-polish issues.
- For fork PRs, first check whether maintainer edits are allowed. If not, either leave an exact friendly request or create a credited maintainer follow-up branch.
- Close only with a concrete reason and a short explanation of what would make a future PR acceptable.

## Review record template

Use this for each PR:

```md
### PR #N - title

- Decision: merge-candidate | needs-refresh | needs-split | superseded | close | draft-only
- Reviewer:
- Date:
- Base checked:
- Diff summary:
- Risks:
- Tests run:
- Maintainer action: none | repair-and-merge | comment-for-author | maintainer-follow-up
- Contributor note:
- Outcome:
- Follow-up:
```
