---
name: pr-review-governance
description: Triage and review Carbon Code pull requests using the project queue policy and record decisions.
runAs: inline
---

# PR review governance skill

Use this skill when asked to review, triage, merge, close, or prioritize Carbon Code pull requests.

## Inputs

- PR number or PR range.
- Current open PR list from GitHub.
- Local `main` status and whether the worktree is dirty.
- Any user priority such as "merge safe fixes first" or "review external PRs first".

## Rules

1. Do not merge or close a PR without reading its diff.
2. Do not trust old CI or old approvals when the PR base is stale.
3. Do not bulk merge old PRs.
4. Prefer small, focused, tested PRs.
5. Treat draft PRs as out of the merge queue.
6. Check for duplicates and behavior already present on `main`.
7. Preserve unrelated local work; do not reset or checkout over dirty files.
8. Record every decision in `docs/pr-review-record.md`.

## Classification

- `merge-candidate`: useful, focused, current, verified, not duplicated.
- `needs-refresh`: useful but stale, conflicted, or needing current verification.
- `needs-split`: useful but too broad.
- `superseded`: already covered elsewhere.
- `close`: not useful or unsafe.
- `draft-only`: draft PR; no merge review yet.

## Procedure

1. Fetch PR metadata and diff.
2. Summarize intent in one sentence.
3. Check changed files and risk level.
4. Compare with current `main` for duplication.
5. Run targeted tests or identify the exact verification needed.
6. Produce findings first if reviewing code.
7. Update `docs/pr-review-record.md` with the decision.

## Merge gate

A PR is mergeable only when it satisfies the project rules:

- It fixes a real issue or advances productization.
- It has no known bug after review.
- Its behavior is verifiable.
- Its scope is clear.
- It is not duplicated.
- Its compatibility story is intentional.

When GitHub merge queue is unavailable, emulate it manually by updating against latest `main`, running verification, and merging immediately after the green result.
