# PR review governance

This document defines how Carbon Code should handle existing and new pull requests.

## Sources checked

- GitHub merge queue / branch protection:
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue
  - https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
  - Summary: keep protected branches green by requiring checks before merge, and use a queue or equivalent latest-main validation before landing.
- Google engineering review guidance:
  - https://google.github.io/eng-practices/review/developer/small-cls.html
  - https://google.github.io/eng-practices/review/reviewer/standard.html
  - Summary: prefer small, focused changes because they are easier to review correctly and safer to revert; review should improve overall code health.
- Open source maintainer practice:
  - https://opensource.guide/best-practices/
  - https://opensource.guide/how-to-contribute/
  - Summary: triage first, keep contributions moving, and treat draft/WIP PRs as early collaboration rather than merge-ready work.

## Operating model

Use one queue for all open PRs, but classify each PR before reviewing details:

- `merge-candidate`: useful, focused, current with `main`, tests pass, no duplicate.
- `needs-refresh`: useful idea, but base is stale, conflicts with current product direction, or tests need rerun.
- `needs-split`: useful parts exist, but scope bundles unrelated behavior.
- `superseded`: already covered by `main` or by a newer/smaller PR.
- `close`: not useful, unsafe, unmaintained, or contrary to Carbon Code direction.
- `draft-only`: draft PRs stay out of the merge queue until explicitly marked ready.

## Review order

1. Security, data loss, auth, and crash fixes.
2. Failing-test fixes or CI unblockers.
3. Small correctness fixes with focused tests.
4. User-visible product polish with screenshots or clear reproduction.
5. Docs-only cleanup.
6. Large features and draft PRs.

## Existing PRs

Existing PRs must not be merged in bulk. For each one:

1. Check whether `main` already contains the behavior.
2. Check whether a newer PR supersedes it.
3. Check whether the base SHA is old enough that latest-main verification is required.
4. Review the diff as if it were new; old approval text is advisory, not decisive.
5. Record the decision in `docs/pr-review-record.md`.

## New PRs

New PRs should enter the same queue and receive a quick triage label within one review pass:

- Does it solve one understandable problem?
- Does it include focused verification?
- Does it preserve Carbon Code naming and Chinese-first defaults?
- Does it avoid unrelated product, UI, docs, and generated-file churn?
- Does it avoid modifying review-governance files unless authored by a project member?

## Merge gate

Before merge, require all of:

- The PR is useful and scoped.
- The diff has been reviewed for behavior, compatibility, and tests.
- Relevant tests, lint, typecheck, or a justified narrower command have passed on latest `main`.
- The PR does not overwrite unrelated work.
- The PR is not duplicated by a better or smaller change.

If GitHub merge queue is unavailable, emulate it manually: update/rebase against latest `main`, run verification, then merge immediately if still green.

## Protected review branch

The review-governance branch is `codex/pr-review-governance`.

Policy:

- Only project members may propose PRs targeting this branch.
- External contributors should propose normal product changes against `main`.
- Changes to review policy, review records, and review skills must be made by a project member.

Implementation in this branch:

- `.github/workflows/protect-pr-review-governance.yml` fails PRs targeting `codex/pr-review-governance` unless `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`.
- Repository admins should mark that workflow as a required status check for `codex/pr-review-governance` in GitHub branch protection.
