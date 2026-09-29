---
name: merge-pr
description:
  "Safely merge PR with verification and Linear integration. **ALWAYS use when** the user says
  'merge the PR', 'merge this', 'ship it', or wants to merge an approved pull request. Runs tests,
  checks CI, verifies approvals, squash merges, cleans up branches, and moves Linear ticket to Done."
disable-model-invocation: false
allowed-tools: Bash(linearis *), Bash(git *), Bash(gh *), Read
version: 1.0.0
---

# Merge Pull Request

Safely merges a PR after comprehensive verification, with Linear integration and automated cleanup.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Prerequisites

```bash
# Thoughts must exist for this skill's documents. The full host setup check belongs to the
# Cloud pack's catalyst-setup skill, not to a skill that must run anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\`; if the prompt names an output path, write there" >&2
```

## Safety rules

**NEVER** use `--admin`, `--force`, or any flag that bypasses branch protection. Always resolve
blockers legitimately or escalate with specifics. See
`"${CLAUDE_SKILL_DIR}/assets/references/merge-blocker-diagnosis.md"` for the full safety rules section.

## Process overview

1. **Identify PR** — use argument or `gh pr view`/`gh pr list` if none given.
2. **Verify open + mergeable** — rebase if behind, resolve conflicts or exit.
3. **Run local tests** — skip with `--skip-tests`.
4. **Diagnose blockers + reactive wait** — check whether the unified event log is live first (`<events dir>/YYYY-MM.jsonl`, where the events dir is `CATALYST_EVENTS_DIR`, else `paths.events` in `~/.config/catalyst/paths.json`, else `~/.local/state/catalyst/events` present and its producer running): if so, [blocker-loop.md](references/blocker-loop.md)'s single disjunctive `wait-for` (CI, reviews, push, merge/close) with authoritative `gh api` REST re-check on every wake-up; if the event log is absent, poll instead, on [bounded-poll.md](references/bounded-poll.md)'s merge/review cadence (interval/ceiling), performing the SAME resolution actions as blocker-loop.md's table (CI fix-up, bot-thread resolve via the `review-comments` skill, BEHIND update) each tick, and checking readiness each tick with [gh-signal-traps.md](references/gh-signal-traps.md)'s combined CI-ready + review-ready check — not `bounded-poll.md`'s bare `bounded_poll_pr_state` alone, which only detects `MERGED`/`CLOSED` and has no way to ever cause either, so a CI-green, fully-reviewed-but-not-yet-merged PR would poll uselessly to the ceiling on that check alone. Proceed to Step 5 once CLEAN.
5. **Squash merge + cleanup** — checkout-free remote-ref delete, Linear ticket to Done,
   worktree-safe local branch delete. **Merge queue:** in a repository that sets `catalyst.pr.queueLabel`
   in `.catalyst/config.json`, an eligible PR (no `hold:hand-steps`, no `handStepPaths` match) gets
   that label applied and this step stops instead of calling `gh pr merge`: the queue bot owns the
   actual merge, and its merge is the terminal signal your coordinator watches for, not this
   session. Hand-step PRs and every repository without a queue label hand-merge unchanged. Re-entrant: re-running this skill against an
   already-mergify-merged PR skips straight past the merge call into cleanup, so
   Linear/deploy/compound still fire. See
   [worktree-safe-merge.md](references/worktree-safe-merge.md) Step 9 for the exact conditions. **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.
6. **Post-merge** — deployment detection + verification, then (once that verification is terminal) compound-estimate, ticket-compound, ticket-retro, and the success summary.

## Load on demand

| Situation | Reference |
|---|---|
| Identifying the PR, checking mergeable, rebasing, running tests | [pr-identification.md](references/pr-identification.md) |
| Reactive blocker-wait loop (ci/review/push/merge) | [blocker-loop.md](references/blocker-loop.md) |
| Deeper CI fix-up / BEHIND-rebase technique (hooks-disabled push, bounded fix attempts, human-vs-bot threads, empty `merge_commit_sha` retry) | [ci-fixup-and-behind.md](references/ci-fixup-and-behind.md) |
| Squash merge, checkout-free remote-branch delete, Linear update, worktree guard | [worktree-safe-merge.md](references/worktree-safe-merge.md) |
| Merge queue: apply the configured `queueLabel` instead of `gh pr merge` when eligible, hand-step exceptions, re-entrant post-merge | [queue-merge.md](references/queue-merge.md) |
| Verifying a ticket is genuinely done before Linear Done (other open PRs, orphan-PR reconciliation) | [done-judgment.md](references/done-judgment.md) |
| Deeper pre-merge adversarial review (8-gate table + regression-risk scoring) for a risky diff | [verify-gates.md](references/verify-gates.md) |
| Post-merge tasks, compound close, deployment detection, success summary | [post-merge.md](references/post-merge.md) |
| Confirming a merged change actually deployed + a live smoke check (bounded-poll, no broker dependency) | [post-merge-deploy-verify.md](references/post-merge-deploy-verify.md) |
| Blocking on a GitHub state change (CI, review, merge) with a foreground, bounded, quota-conscious loop, no event log needed | [bounded-poll.md](references/bounded-poll.md) |
| GitHub signal shapes that look like an answer and aren't (empty-string `conclusion`, empty check-run set, reaction-only clean review pass) | [gh-signal-traps.md](references/gh-signal-traps.md) |
| Flags (`--skip-tests`, `--no-update`, `--keep-branch`), errors, examples | [flags-errors.md](references/flags-errors.md) |
| Configuration (`.catalyst/config.json` schema, safety features) | [config-safety.md](references/config-safety.md) |
