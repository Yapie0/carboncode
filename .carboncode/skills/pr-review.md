---
name: pr-review
description: Triage, review, and merge Carbon Code pull requests using the project queue policy — classifies, tests, merges with credit, and records decisions.
---

# PR Review

Triage, review, and merge Carbon Code pull requests following the project's contributor-friendly governance policy.

## Toolset

- **Read PRs**: use `github_list_pull_requests`, `github_get_pull_request`, `github_get_pull_request_files`.
- **Merge (primary)**: `gh pr merge <id> --repo Yapie0/carboncode --squash --subject "..." --body "..."`.
  - Server-side operation — does NOT trigger local `pre-push` / `verify` hooks.
  - Auto-closes the PR on success.
  - Fails cleanly on conflicts → fall back to manual path.
- **Merge (fallback — conflict resolution)**: `git fetch origin pull/<id>/head:pr-<id>` → `git merge --squash` → resolve conflicts → commit → `git push origin main --no-verify`.
- **Comment on PRs**: `gh pr comment <number> --repo Yapie0/carboncode --body "..."` (terminal) or `github_add_issue_comment` (API).
- **Close PR**: `gh pr close <number> --repo Yapie0/carboncode` for rejected PRs only.
  **Never use `gh pr close` on a merged PR** — it marks the PR as "Closed" (rejected) instead of "Merged" (purple badge).

## Pre-flight

1. **Verify `gh` is available and authenticated:**
   ```bash
   gh --version && gh auth status
   ```
   If `gh` is missing, install it or fall back to the manual git path for everything.

2. **Sync local main:**
   ```bash
   git fetch origin main
   ```
   Local main is NOT required for `gh pr merge` (server-side), but is needed for the fallback path.

3. **Check worktree**: `git status --porcelain`. If dirty, stash before the fallback path.

## Pre-requisites

1. Local worktree: check for dirty files (`git status --porcelain`). If dirty, `git stash push -m "pre-pr-review stash"` before touching branches, and `git stash pop` after.
2. Verify `git push` access to `origin` (Yapie0/carboncode).

## Rules

1. Do not merge or close a PR without reading its diff.
2. Do not trust old CI or old approvals when the PR base is stale.
3. Do not bulk merge old PRs.
4. Prefer small, focused, tested PRs.
5. Treat draft PRs as out of the merge queue.
6. Check for duplicates — verify the change is NOT already on current `origin/main` before merging.
7. Preserve unrelated local work; stash before resetting/checking out.
8. Record every decision in `docs/pr-review-record.md`.
9. During the early project phase, prefer maintainer repair over rejection for harmless, useful PRs.
10. Keep contributor-facing comments specific, respectful, and encouraging.
11. **Always prefer `gh pr merge --squash`** over manual git push. It is faster, safer, and correctly marks PRs as merged.
12. **Always leave a PR comment** after every review action — merge, close, or draft-skip. `gh pr merge` auto-closes the PR but does NOT post a visible comment; the contributor gets no notification without one.

## Classification

| Label | Condition |
|-------|-----------|
| `merge-candidate` | Useful, focused, current with main, verified, not duplicated |
| `needs-refresh` | Useful but `gh pr merge` rejected it (conflict / stale base that can't auto-merge).
  **Do not pre-classify as `needs-refresh` just because the base is old** — try `gh pr merge` first; it handles most stale-but-clean PRs. |
| `needs-split` | Useful but too broad — mixed scope prevents a safe review |
| `superseded` | Already covered by main or a newer PR |
| `close` | Not useful, unsafe, directionally wrong, abandoned/broken, or unreviewable |
| `draft-only` | Draft PR — skip, no merge review yet |

## Merge Gate (from AGENTS.md)

- It fixes a real issue or advances Carbon Code productization.
- It has no known bug after review.
- Its behavior is verifiable.
- Its scope is clear.
- It is not duplicated.
- Its compatibility story is intentional.

Maintainer repairs must satisfy the same gate. Do not use small corrective commits to bypass review, tests, or attribution.

## Contributor-Friendly Handling

Useful contributor PRs should not be bounced for small issues that maintainers can safely fix.

- **`merge-candidate`**: PR is useful, scoped, verified, clean (or clean after maintainer repair).
- **`needs-refresh`**: PR is useful but must be rebased onto current main or re-verified.
- **`needs-split`**: mixed scope prevents a safe review.
- **`close`**: only for duplicate, unsafe, directionally wrong, abandoned/broken, or unreviewable work.
- If a PR has small issues (formatting, naming, copy, test gaps), repair it directly when branch permissions allow.
- For fork PRs without maintainer edit: cherry-pick the changes locally, push to main, and close the PR with an attribution comment.

## Merge Message Template

Every merge must include a meaningful body, not just a generic "thanks". Model after #92:

```
✅ Reviewed & merged by Carbon Code

Tests: <test-files> — <N>/<N> passed
<Type>: <one-line summary of the actual change>
Thanks @<author> for <specific contribution>.

Co-Authored-By: Carbon Code <carboncode@code.ai6666.com>
```

- **Tests line**: list the test file(s) the PR adds or touches, with pass count if available.
- **Type line**: `Fix:`, `Feat:`, `Doc:`, `Test:`, `Chore:` — summarizes what the PR actually does.
- **Thanks line**: be specific ("the focused parser fix", "the thorough storage migration", "the clean doc update") — never just "Thanks @user!"

## Contributor Credit

**Always preserve contributor credit** — never close a useful PR without attribution.

- For fork PRs merged via local cherry-pick: add attribution in the commit message and in the PR close comment.
- Carbon Code signature: `— Carbon Code`

---

## Procedure

### Step 1 — Read the PR

Use `github_get_pull_request` then `github_get_pull_request_files`. Summarize intent in one sentence. Skip if already merged or closed.

### Step 2 — Classify

Apply the classification table. Check changed files and risk level. **Verify the change is not already on `origin/main`** — use `search_content` against the current codebase for the key symbols/strings the PR touches.

### Step 3 — If merge-candidate

**Primary path — `gh pr merge` (no-conflict, server-side):**

```bash
gh pr merge <number> --repo Yapie0/carboncode --squash \
  --subject "<PR title> (#<number>)" \
  --body "✅ Reviewed & merged by Carbon Code

Tests: <test-files> — <pass-count>
<Type>: <one-line summary>
Thanks @<author> for <specific contribution>.

Co-Authored-By: Carbon Code <carboncode@code.ai6666.com>"
```

This is the preferred path. It creates the squash merge on GitHub's servers, auto-closes the PR, and does NOT trigger local `verify` hooks. Reference: #92 was merged this way — note the rich body with test results, change summary, and specific thanks.

**The body must be filled in from the PR review** — extract test file names and pass counts from the PR description's Verification section, write a one-line summary of the actual code change, and give specific praise.

**After merge succeeds**, immediately post a PR comment so the contributor is notified. Use this exact format (modeled after #101):

```bash
gh pr comment <number> --repo Yapie0/carboncode --body "## Review Summary

Reviewed & merged by Carbon Code

Tests: <verification> — <N>/<N> passed
<Type>: <one-line summary>

Thanks @<author> for <specific contribution>.

Co-Authored-By: Carbon Code <carboncode@code.ai6666.com>

-- Carbon Code"
```

The comment should mirror the merge body but use `## Review Summary` as the header so it renders as a structured review on the PR page.

**Fallback path — local conflict resolution:**

When `gh pr merge` fails with "the merge commit cannot be cleanly created".

**Why this happens with fork PRs**: the contributor's branch (on their fork) has diverged from main. Even after we resolve the conflict locally and push to main, `gh pr merge` will still fail — it tries to merge the contributor's OLD head into main, and that old head still conflicts. We don't have push access to their fork, so we can't fix their branch. This is the fundamental limitation of fork PR conflict resolution: **we can get the code onto main, but we can't make GitHub mark the PR as "Merged" without the contributor rebasing.**

**What "code on main but PR open" means**: the change is live and deployed. The PR staying open is purely a cosmetic issue — the purple "Merged" badge is missing, but the code is in production. Contributors should still be asked to rebase so the badge can be applied.

Steps:

1. **Fetch, reset, squash:**
   ```bash
   git fetch origin pull/<number>/head:pr-<number>
   git checkout main
   git reset --hard origin/main
   git merge --squash pr-<number>
   ```

2. **Resolve conflicts** (list conflicted files):
   ```bash
   git diff --name-only --diff-filter=U
   ```
   Read each file, fix the `<<<<<<<` / `>>>>>>>` markers, stage, commit.

3. **Commit:**
   ```bash
   git commit -m "<PR title> (#<number>)" -m "Reviewed & merged by Carbon Code. Thanks @<author>!"
   ```

4. **Push (skip verify — pre-existing lint errors are not this PR's fault):**
   ```bash
   git push origin main --no-verify
   ```

5. **Mark as merged — NEVER use `gh pr close` (it shows "closed" not "merged"):**
   - First try `gh pr merge --squash` again now that main has the resolved code.
   - If still "not mergeable": post a comment using the **same rich format** as the merge body (with `## Review Summary` header), including the merge commit sha, and leave the PR open.

   ```bash
   gh pr comment <number> --repo Yapie0/carboncode --body "## Review Summary

   ✅ **Reviewed & merged by Carbon Code**

   **Tests**: <test-files> — <N>/<N> passed
   **<Type>**: <one-line summary>

   **Conflict resolved**: <brief description>. Code squashed to main at \`<sha>\`.

   Thanks @<author> for <specific contribution>.

   Co-Authored-By: Carbon Code <carboncode@code.ai6666.com>

   — Carbon Code"
   ```

   **Do NOT `gh pr close`** — that marks it as rejected.

6. **Ask the contributor to rebase** — post a second comment with:
   - The exact conflict (which file, what clashed)
   - Request to rebase their branch onto latest main and force-push
   - Note that the resolved code is already on main, so this is just to get the PR properly marked as merged

   This step is not optional — otherwise the PR stays open indefinitely and the contributor doesn't know what to do.

6. **Clean up:**
   ```bash
   git branch -D pr-<number>
   ```

### Step 4 — If needs-refresh

1. Comment on the PR explaining the stale base and requesting a rebase.
2. If the contributor is unresponsive and the change is simple, cherry-pick locally onto current main (same squash flow as Step 3).
3. Record the decision.

### Step 4.5 — If draft-only

1. **Leave a comment** acknowledging the draft:
   ```bash
   gh pr comment <number> --repo Yapie0/carboncode --body "👋 Thanks for the PR @<author>! This is marked as draft — I'll review it when it's ready for merge. No action needed now.

   — Carbon Code"
   ```
2. Record in `docs/pr-review-record.md`.

### Step 5 — If close / superseded

1. Comment with the reason (duplicate, already on main, etc.).
2. Close via `github_update_issue` or `gh pr close`.
3. Record the decision.

### Step 6 — Record the decision

Update `docs/pr-review-record.md` with: PR number, title, classification, action taken, date.

---

## Fork PR specifics

- Fork head branches live at contributor forks (e.g. `Star-Star66/carboncode`). Fetch via `git fetch origin pull/<id>/head` (GitHub exposes every PR as a ref under the base repo).
- **We cannot push to contributor forks** (no SSH key / token for their repo). This means we can't fix their branch after resolving conflicts.
- **Conflict resolution limitation**: we can squash the resolved code to main, but `gh pr merge` will still fail because the PR's head branch (on their fork) still has the old conflicting code. Only the contributor rebasing their branch can make `gh pr merge` succeed.
- **Result**: conflict PRs from forks end up with code on main but the PR staying open. Accept this — the code is live. Always ask the contributor to rebase (see fallback step 6).
- **If maintainer edits are enabled** on the fork (rare), push the resolved state to their branch before running `gh pr merge`.
