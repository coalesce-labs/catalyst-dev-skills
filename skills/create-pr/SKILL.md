---
name: create-pr
description:
  "Create a pull request and carry it to a clean merge state. Use when the user says 'create a PR',
  'open a pull request', 'ship this' or 'ready for review', or wants changes pushed as a GitHub PR.
  Handles commit, rebase, push, PR creation, the description, and monitoring CI and reviews."
disable-model-invocation: false
allowed-tools: Bash, Read, Task
version: 1.0.0
---

# Create Pull Request

The flow is commit → rebase → push → create → describe → monitor.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Prerequisites

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2
```

## Rules

- **Author:** the git user alone. The PR title and body carry no "Generated with Claude Code", "Co-Authored-By: Claude" or other AI-assistance reference.
- **Ticket:** opening a PR moves nothing; the ticket stays where it is until the PR merges.
- **Phase-container guard:** this skill makes no `linearis` call; if you are asked for one, skip it when `CATALYST_PHASE` is set (a phase container holds no Linear credential) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.

## Process

1. **Preflight.** Handle uncommitted changes, refuse main/master, detect the base branch, rebase if behind, check for an existing PR, and extract the ticket from the branch name with `.catalyst/config.json`'s `linear.teamKey`. See [preflight.md](references/preflight.md).
2. **Title, push, create.** The title prefers the first commit subject (`git log --no-merges`, `draft_pr_title`, the `<type>(<scope>): <ticket>` convention); with no commit, it runs `tr '-' ' '` on the branch slug. Push through `draft_pr_push_verify` (`git fetch`-verified, never forced; when the branch moved it replays only the unpublished commits onto the remote tip). The PR body gets the Linear sibling-skip guard from `linear-pr-skip.sh`'s `linear_sibling_skip_block_from_branch`, which references sibling tickets by **PR number**, never a bare token (the describe-pr skill's `linear-sibling-guard` reference explains why). Then run the `describe-pr` skill. See [push-and-create.md](references/push-and-create.md).
3. **Monitor to a clean merge state:** CI, automated reviewers and blocker resolution. Use `catalyst events wait-for` after a successful `catalyst events status` probe. Only an absent CLI or failed probe permits bounded REST polling, with one line naming the reason. This step is required; "PR created" is not the end. Stop only at a clean or genuinely human-blocked state. See [monitoring-loop.md](references/monitoring-loop.md).
4. **Report the real outcome.** See [outcomes-and-errors.md](references/outcomes-and-errors.md) for the final-state reports, error handling, examples, and how this fits with the `commit`, `describe-pr` and `merge-pr` skills.

Acceptance evals and their runner are in [evals/README.md](evals/README.md).
