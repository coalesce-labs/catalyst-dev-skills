---
name: describe-pr
description:
  "Generate or update a PR's description and title, incrementally, preserving manual edits. Use
  when the user says 'describe the PR', 'update PR description' or 'generate PR description', or
  after new commits are pushed to an existing PR."
disable-model-invocation: false
allowed-tools: Bash, Read, Write
version: 2.0.0
---

# Generate/Update PR Description

Runs fully automated, with no interactive prompts: it regenerates the auto-generated sections, preserves manual edits, updates the title, and names the Linear ticket.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Prerequisites

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2
```

## Rules

- **Author:** descriptions are professional and attributed to the human author. The PR title and body carry no "Generated with Claude Code", "Co-Authored-By: Claude" or other AI-assistance reference.
- **Ticket:** write nothing to it; the ticket stays where it is until the PR merges.
- **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.

## Process

1. **Gather.** Read the template, identify the PR, extract its ticket, and gather its diff, commits and checks. See [process.md](references/process.md).
2. **Merge and title.** Merge the new analysis into the existing description, add the Linear reference, and generate the title. On a cloud account, read the ticket with `catalyst query issue <ID> --json`. Reference sibling tickets by GitHub PR number, never a bare Linear token; the own ticket's `Fixes https://linear.app/{workspace}/issue/{ticket}` line stays. See [merge-and-title.md](references/merge-and-title.md); the reason for the sibling rule is in [linear-sibling-guard.md](references/linear-sibling-guard.md).
3. **Verify and write back.** Run the verification checks, save to `thoughts/shared/prs/`, and write the description and title to GitHub with the Linear sibling-skip guard block from `linear-pr-skip.sh`'s `linear_sibling_skip_block_from_branch` + `linear_sibling_skip_block_from_body`. See [verify-and-writeback.md](references/verify-and-writeback.md).
4. **Report** whether this was a first-time generation or an incremental update. See [metadata-and-errors.md](references/metadata-and-errors.md), which also covers error handling and the `.catalyst/config.json` schema (`teamKey`, `pr.testCommand`).
