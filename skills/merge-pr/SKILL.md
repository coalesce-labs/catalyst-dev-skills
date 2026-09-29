---
name: merge-pr
description:
  "Safely merge a pull request after verification. Use when the user says 'merge the PR', 'merge
  this' or 'ship it', or wants an approved pull request merged. Runs tests, checks CI, verifies
  approvals, squash merges or hands the PR to the repository's merge queue, cleans up branches,
  and verifies the deploy."
disable-model-invocation: false
allowed-tools: Bash(linearis *), Bash(git *), Bash(gh *), Read
version: 1.0.0
---

# Merge Pull Request

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Prerequisites

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2
```

## Safety rules

Resolve every blocker legitimately, or escalate with specifics. Never use `--admin`, `--force` or any flag that bypasses branch protection. The full rules are in `"${CLAUDE_SKILL_DIR}/assets/references/merge-blocker-diagnosis.md"`.

**Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.

## Process

1. **Identify the PR** from the argument, else `gh pr view` / `gh pr list`. See [pr-identification.md](references/pr-identification.md).
2. **Verify it is open and mergeable.** Rebase if behind; resolve conflicts or exit. An already-merged PR skips to step 5, which resumes at cleanup.
3. **Run local tests**, unless `--skip-tests`.
4. **Wait out the blockers until the PR is CLEAN.**
   - The event log is live when `<events dir>/YYYY-MM.jsonl` exists and its producer is running. The events dir is `CATALYST_EVENTS_DIR`, else `paths.events` in `~/.config/catalyst/paths.json`, else `~/.local/state/catalyst/events`.
   - Live: run [blocker-loop.md](references/blocker-loop.md)'s single disjunctive `wait-for` (CI, reviews, push, merge/close), with an authoritative `gh api` REST re-check on every wake-up.
   - Absent: poll on [bounded-poll.md](references/bounded-poll.md)'s merge/review cadence. On each tick, take the same resolution actions as blocker-loop.md's table (CI fix-up, bot-thread resolve via the `review-comments` skill, BEHIND update), and test readiness with [gh-signal-traps.md](references/gh-signal-traps.md)'s combined CI-ready and review-ready check. `bounded_poll_pr_state` alone only detects `MERGED`/`CLOSED`, which a CI-green, reviewed, unmerged PR never reaches.
5. **Merge and clean up.** `scripts/merge-route.sh` decides who merges: this skill squash-merges only when the repository has no merge queue; otherwise the queue merges and this skill enters the PR the way the queue's config names. Then delete the remote ref checkout-free and the local branch worktree-safely. The step is re-entrant: on a PR someone else merged, it skips the merge call and runs cleanup, so deploy verification and the compound close still fire. The ticket is not moved here; on Catalyst Cloud the merge moves it to done. See [worktree-safe-merge.md](references/worktree-safe-merge.md) and [squash-merge.md](references/squash-merge.md).
6. **Post-merge.** Detect and verify the deployment. Once that verification is terminal, run compound-estimate, ticket-compound and ticket-retro, then report success. See [post-merge.md](references/post-merge.md).

## Load on demand

| Situation | Reference |
|---|---|
| CI fix-up and BEHIND rebase in depth (hooks-disabled push, bounded fix attempts, human-vs-bot threads, empty `merge_commit_sha` retry) | [ci-fixup-and-behind.md](references/ci-fixup-and-behind.md) |
| Checking a ticket is done before calling it done (other open PRs, orphan-PR reconciliation) | [done-judgment.md](references/done-judgment.md) |
| Adversarial pre-merge review of a risky diff (8-gate table, regression-risk scoring) | [verify-gates.md](references/verify-gates.md) |
| Confirming a merged change deployed, with a live smoke check | [post-merge-deploy-verify.md](references/post-merge-deploy-verify.md) |
| Flags (`--skip-tests`, `--keep-branch`), errors, examples | [flags-errors.md](references/flags-errors.md) |
| Configuration (`.catalyst/config.json` schema, safety features) | [config-safety.md](references/config-safety.md) |
