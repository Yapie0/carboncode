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
9. During the early project phase, prefer maintainer repair over rejection for harmless, useful PRs.
10. Keep contributor-facing comments specific, respectful, and encouraging; acknowledge the useful part before explaining any blocker.

## Classification

- `merge-candidate`: useful, focused, current, verified, not duplicated.
- `needs-refresh`: useful but stale, conflicted, or needing current verification.
- `needs-split`: useful but too broad.
- `superseded`: already covered elsewhere.
- `close`: not useful or unsafe.
- `draft-only`: draft PR; no merge review yet.

## Contributor-friendly handling

Useful contributor PRs should not be bounced for small issues that maintainers can safely fix.

- Use `merge-candidate` when the PR is useful, scoped, verified, and either already clean or clean after maintainer repair.
- Use `needs-refresh` when the PR is useful but must be updated against current `main` or rerun verification.
- Use `needs-split` only when mixed scope prevents a safe review.
- Use `close` only for duplicate, unsafe, directionally wrong, abandoned broken, or unreviewable work.
- If a PR has small issues such as formatting, naming, copy, focused test gaps, or simple compatibility fixes, repair it directly when branch permissions allow.
- For fork PRs without maintainer edit permission, write the exact requested change or create a maintainer follow-up branch that credits the PR.
- Preserve contributor credit in comments, merge messages, or follow-up branch notes.

## Procedure

1. Fetch PR metadata and diff.
2. Summarize intent in one sentence.
3. Check changed files and risk level.
4. Compare with current `main` for duplication.
5. Decide whether any remaining issue is small enough for maintainer repair.
6. If repair is appropriate, apply the smallest maintainer fix on an editable PR branch or a separate credited maintainer branch.
7. Run targeted tests or identify the exact verification needed.
8. Produce findings first if reviewing code.
9. Update `docs/pr-review-record.md` with the decision.

## Remote handling

- Reading PRs can use GitHub API plus `git fetch origin pull/<id>/head` and does not require `gh`.
- Merging code can use normal git merge/cherry-pick plus push, when repository permissions allow.
- Commenting, closing, labeling, or submitting formal reviews requires GitHub API permissions or a configured GitHub client.
- Directly modifying a fork PR requires the contributor to allow maintainer edits and the maintainer to have a pushable remote.

## Merge gate

A PR is mergeable only when it satisfies the project rules:

- It fixes a real issue or advances productization.
- It has no known bug after review.
- Its behavior is verifiable.
- Its scope is clear.
- It is not duplicated.
- Its compatibility story is intentional.

When GitHub merge queue is unavailable, emulate it manually by updating against latest `main`, running verification, and merging immediately after the green result.

Maintainer repairs must satisfy the same merge gate. Do not use small corrective commits to bypass review, tests, or attribution.
