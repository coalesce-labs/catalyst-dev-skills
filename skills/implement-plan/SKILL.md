---
name: implement-plan
description: "Implement an approved technical plan from thoughts/shared/plans/, phase by phase, test first (Red-Green-Refactor). **ALWAYS use when** the user says 'implement the plan', 'start implementing', 'build from the plan', or wants to execute a previously created implementation plan. Supports team mode for parallel implementation."
disable-model-invocation: false
allowed-tools: Read, Write, Edit, Grep, Glob, Task, TodoWrite, Bash
version: 1.0.0
---

# Implement Plan

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

**Automated runs.** When `CATALYST_PHASE` or `CATALYST_STAGE` is set, also follow [references/automated-phase.md](references/automated-phase.md): a commit and draft-PR push after every Green step, and the dispatch prompt's one gate in place of the local quality gates.

## 1. Find the plan and prepare

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2
if [[ -n "${CATALYST_PHASE:-}" ]]; then echo "unattended: CATALYST_PHASE=$CATALYST_PHASE, so never ask and wait"; fi
# explicit-input discovery: begin
# Find the plan to implement on disk for the ticket this run was given: $CATALYST_TICKET under a
# phase, else a ticket named in the skill's argument text (Claude Code substitutes the token in
# the heredoc below; another harness leaves it literal, which names no ticket). Nothing is
# remembered between runs. `[!0-9]` keeps PROJ-1 from matching PROJ-10's documents.
TICKET_ID="${TICKET_ID:-${CATALYST_TICKET:-}}"
if [[ -z "$TICKET_ID" ]]; then
  SKILL_ARGS=$(cat <<'CATALYST_SKILL_ARGS'
$ARGUMENTS
CATALYST_SKILL_ARGS
)
  TICKET_ID=$(printf '%s' "$SKILL_ARGS" | grep -oE '[A-Z]+-[0-9]+' | head -1)
  [[ -n "$TICKET_ID" ]] || TICKET_ID=$(printf '%s' "$SKILL_ARGS" | tr '[:lower:]' '[:upper:]' | grep -oE '[A-Z]+-[0-9]+' | head -1)
fi
RECENT_PLAN=""
if [[ -n "$TICKET_ID" ]]; then
  RECENT_PLAN=$(find -H thoughts/shared/plans -type f -name '*.md' -ipath "*${TICKET_ID}[!0-9]*" -exec ls -t {} + 2>/dev/null | head -1)
elif [[ -z "${CATALYST_PHASE:-}" ]]; then
  RECENT_PLAN=$(find -H thoughts/shared/plans -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -1)
fi
# explicit-input discovery: end
if [[ -n "$RECENT_PLAN" ]]; then
  echo "📋 Found plan: $RECENT_PLAN"
else
  echo "⚠️ No plan found on disk for ${TICKET_ID:-this run}"
fi

# Session tracking uses the installed catalyst-session CLI when this host has one; skipped otherwise.
SESSION_SCRIPT="$(command -v catalyst-session 2>/dev/null || true)"
if [[ -n "$SESSION_SCRIPT" ]]; then
  CATALYST_SESSION_ID=$("$SESSION_SCRIPT" start --skill "implement-plan" \
    --ticket "${TICKET_ID:-}" \
    --workflow "${CATALYST_SESSION_ID:-}")
  export CATALYST_SESSION_ID
  "$SESSION_SCRIPT" phase "$CATALYST_SESSION_ID" "implementing" --phase 1
fi
```

A plan path passed as an argument wins. When `CATALYST_PHASE` is set, never ask and wait: use that path or the found plan, and with neither, stop and report `no_plan_found`. Otherwise, after `📋 Found plan`, show the path and ask "**Proceed with this plan?** [Y/n]". Otherwise, or on no, list the five most recent plans in `thoughts/shared/plans/` with dates and ticket numbers, and wait for the user to pick one.

Read the plan whole (no limit or offset), the ticket in its `source_ticket` frontmatter (this skill moves no ticket; when someone asks for a move, read [references/linear.md](references/linear.md)), and every file it mentions. Checked items (`- [x]`) are done: resume from the first unchecked one. On an adopted branch, where `git fetch origin main && git log --oneline origin/main..HEAD` lists commits before you change anything, run `git merge --no-edit origin/main` first and resolve any conflict as part of this phase. Record the merge commit and main SHA used; later validation must separate main's movement from this plan's changes. Then make a todo list.

## 2. Implement each phase: Red → Green → Refactor

Finish each phase before the next, always in this order: **Red**, write the tests from the phase's "Tests First" section (or for its expected behaviour when it has none) and watch them fail; **Green**, write the minimum code from "Implementation" that passes them; **Refactor**, clean up with the tests green, applying the plan's refactoring notes.

After each phase, run its success-criteria commands, fix what fails, check its items off in the plan file, and print the context status in [references/context-and-handoff.md](references/context-and-handoff.md), which sets when to hand off. Record friction worth fixing (a bug in adjacent code, a missing tool) the moment you see it, with `add-finding.sh` from [references/improvement-queue.md](references/improvement-queue.md). Follow the plan unless code evidence requires a departure. Record departures for `validate-plan` in `thoughts/shared/plans/<TICKET-ID>/deviations.json` using [references/deviations.md](references/deviations.md); write no file when the plan was followed.

When the code has drifted and the plan cannot be followed, stop and present `Issue in Phase [N]:` with `Expected:` (what the plan says), `Found:` (the actual situation), `Why this matters:`, and `How should I proceed?`. With `--team`, or when the plan spans three or more independent domains, follow [references/team-mode.md](references/team-mode.md).

## 3. Quality gates and finish

After the last phase, run the local gates in [references/quality-gates.md](references/quality-gates.md): the `validate-type-safety` skill, this pack's `review-security` and `review-code` skills, and a test-coverage subagent. Then file the recorded findings with the end-of-run block in [references/improvement-queue.md](references/improvement-queue.md), and end the session:

```bash
if [[ -n "${CATALYST_SESSION_ID:-}" && -x "$SESSION_SCRIPT" ]]; then
  "$SESSION_SCRIPT" end "$CATALYST_SESSION_ID" --status done
fi
```
