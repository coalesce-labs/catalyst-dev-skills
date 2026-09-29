---
name: triage-aging-prs
description: "Drive an aging pull-request backlog to zero in any repo with the gh CLI. Finds the structural blockers first (a required check that can never run, a reviewer that never fires, chronically red CI), triages every unresolved review thread in parallel, verifies each finding against the code before fixing it, then merges serially. ALWAYS use when the user says 'burn down the PRs', 'stale PRs', 'PR backlog', 'get these PRs merged', 'clear the PR queue', or asks why PRs are not merging."
disable-model-invocation: false
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
version: 1.0.0
argument-hint: "[--repo owner/name] [--limit N]"
---

# Triage Aging PRs

Drive a stale pull-request backlog to zero without breaking the base branch. Fix the structural gate before grinding through review comments; otherwise a night's work merges nothing.

**Paths.** This skill reads files inside its own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before reading them. If you cannot, stop and report `skill_dir_unresolved`.

**Review findings follow one rulebook.** Read `${CLAUDE_SKILL_DIR}/assets/references/resolving-review-findings.md` before Step 2, and give every triage and fix agent the same file. It owns verifying, classifying, scoping, replying to and deferring a finding; this skill keeps the backlog mechanics.

## Step 0: Inventory before you touch anything

Resolve the target repo from `--repo` and its default branch first. Every ruleset change and merge below uses them, so an invocation naming another repo must not fall back to the current checkout, and a `master` or `develop` repo must never be probed as `main`.

```bash
REPO="$(printf '%s' "${ARGUMENTS:-}" | sed -n 's/.*--repo[= ]\([^ ]*\).*/\1/p')"
REPO="${REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
BASE="$(gh repo view "$REPO" --json defaultBranchRef --jq .defaultBranchRef.name)"   # never hardcode main
gh pr list --repo "$REPO" --limit 60 \
  --json number,title,isDraft,mergeStateStatus,isCrossRepository,createdAt,headRefName \
  --jq '.[]|[.number,(if .isCrossRepository then "FORK" else "base" end),.mergeStateStatus,
             (if .isDraft then "DRAFT" else "-" end),(.createdAt[0:10]),(.title|.[0:50])]|@tsv' |
  sort -k2,2 -k1,1n | column -t
```

Classify every PR before doing any work:

| Class           | Meaning                                     | Action                                             |
| --------------- | ------------------------------------------- | -------------------------------------------------- |
| Genuinely stale | Opened well before the current work window  | The target                                         |
| Fresh           | Opened in the last day or two               | Steady-state flow, not backlog                     |
| Draft           | `isDraft`                                   | Exclude                                            |
| Do-not-land     | The user said to leave it                   | Exclude, and re-check every bulk action against it |
| Release PR      | e.g. release-please's `chore: release main` | The user's call; never auto-merge                  |

Report the split ("3 genuinely stale, 12 opened today, 4 drafts"), not the raw count. A count that stays flat while you merge steadily means arrivals match your throughput, which is a different problem.

## Step 1: Find the structural blocker first

Read `${CLAUDE_SKILL_DIR}/references/structural-blockers.md` and run its four checks: what the branch's rulesets require (1a), whether a required check can never run on fork PRs (1b), whether the automated reviewer fires at all (1c), and whether the base branch is green (1d). It also holds the only safe way to relax a ruleset.

## Step 2: Triage every thread in parallel, and verify

With many PRs, fan out one read-only agent per PR (a subagent each, or a workflow if available). Each agent reads the cited code on the PR's branch and classifies the finding per the reference (rules 2 and 3). Triage agents make no edits, commits, pushes or thread replies; remediation is a separate phase.

Require per thread: `threadId`, `severity`, `class` (the reference's five), `assessment` (citing what was read), `fix_approach` (file, function and change; `valid` only), `complexity` (trivial, moderate or deep).

Expect about one finding in ten to be non-`valid`: fixed by a later commit (`already-fixed`), or an unreachable path (`invalid`). When another PR already landed the fix, close the whole PR with evidence instead. Rank by `complexity` and clear whole PRs rather than skimming easy findings across many: a PR merges only when every thread is resolved.

## Step 3: Fix, honoring the severity policy

Fix `valid` findings, and answer, defer or escalate the rest as the reference says (rules 4 to 13).

- P0 and P1 are always fixed, every round; P2 and below defer after round one (reference rule 8). Match the severity string exactly, P0 explicitly: a regex whose fallback bucket is "P3" mislabels a P0 as low priority.
- When a change contradicts a documented invariant, delete it and fix the root cause rather than layering a guard.
- Mutation-test any fix whose whole value is catching a failure: break the code and confirm the new test fails.

## Step 4: Resolve conflicts by judgment

When a PR conflicts with the base, read `${CLAUDE_SKILL_DIR}/references/conflicts.md` and resolve each conflict by its case (union, drop the duplicate, or decide), then re-validate.

## Step 5: Merge, and judge CI honestly

Read `${CLAUDE_SKILL_DIR}/references/merging.md` before the first merge. It holds the failing-check query, how to tell a pre-existing failure from yours, the merge block (it deletes the head branch only after REST confirms the merge, and skips an unconfirmed PR), and the serial merge order.

## Step 6: Reconcile the tickets

Check every ticket referenced by a merged PR and advance any still open. The repo's ticket-CLI skill has the commands; prefer the local replica for reads.

## Reporting

State how many merged, how many stale remain, and how many arrived during the run. Name the structural blocker and whether it is fixed or worked around. List anything merged over a red check, and why. If a ruleset is still relaxed, say so prominently with the restore command: it is a security-relevant state you are leaving behind.
