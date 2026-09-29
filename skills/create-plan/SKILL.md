---
name: create-plan
description:
  "Create an implementation plan with the person, step by step, or revise an existing one. **ALWAYS use
  when** the user says 'plan this', 'create a plan', 'let's plan the implementation', 'design the approach',
  or wants a structured TDD implementation plan before writing code; and when they say 'update the plan', 'change
  the plan', 'the requirements changed' or 'revise the approach' for a plan in thoughts/shared/plans/. Works best after the research-codebase skill."
disable-model-invocation: false
allowed-tools: Read, Write, Grep, Glob, Task, TodoWrite, Bash, mcp__serena__activate_project, mcp__serena__list_memories, mcp__serena__read_memory, mcp__serena__get_symbols_overview, mcp__serena__find_symbol, mcp__serena__find_referencing_symbols, mcp__serena__search_for_pattern, mcp__serena__find_file, mcp__serena__list_dir
version: 1.0.0
---

# Create plan

Build the plan with the person and get their agreement at each step. Be skeptical: verify every requirement against the code, and research each correction the person makes before accepting it. When the person names an existing plan and asks for changes, follow [Revising an existing plan](#revising-an-existing-plan) instead.

**Paths.** `${CLAUDE_SKILL_DIR}` is this skill's directory, which Claude Code fills in. On another harness, set it to the directory holding this SKILL.md, or stop and report `skill_dir_unresolved`.

## Start

Run this, then start session tracking as [references/session-tracking.md](references/session-tracking.md) shows.

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2

# explicit-input discovery: begin
# Find the research to plan from on disk for the ticket this run was given: $CATALYST_TICKET under a
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
RECENT_RESEARCH=""
if [[ -n "$TICKET_ID" ]]; then
  RECENT_RESEARCH=$(find -H thoughts/shared/research -type f -name '*.md' -ipath "*${TICKET_ID}[!0-9]*" -exec ls -t {} + 2>/dev/null | head -1)
elif [[ -z "${CATALYST_PHASE:-}" ]]; then
  RECENT_RESEARCH=$(find -H thoughts/shared/research -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -1)
fi
# explicit-input discovery: end
if [[ -n "$RECENT_RESEARCH" ]]; then
  echo "📋 Found research: $RECENT_RESEARCH"
else
  echo "⚠️ No research found on disk for ${TICKET_ID:-this run} — ask for it (or read the paths the prompt names)"
fi
```

- **Input given** (a path or ticket): it overrides discovery. Read those files, ask whether any research the block found (📋) should inform the plan, then begin.
- **No input, research found (📋):** show its path, ask whether to plan from it, and wait.
- **Nothing found (⚠️):** ask for the task or ticket, its constraints, and related research, and wait.

## Steps

1. **Gather context.** Read every mentioned file yourself, in full (no limit or offset), before spawning subagents. Take the ticket from the research's `source_ticket`, the argument, or the conversation. Run `codebase-locator`, `codebase-analyzer` and `thoughts-locator` scoped to the ticket (the `research-codebase` skill's agents) and read what they find in full. Check the requirements against the code, present your understanding with file:line references, and ask only what the code cannot answer.
2. **Research.** Track the work in TodoWrite and run in parallel `codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`, `external-research` (framework patterns), `thoughts-locator` and `thoughts-analyzer`. Each agent's instructions ship as `${CLAUDE_SKILL_DIR}/assets/agents/<name>.md`; run a subagent with that file plus your request, or do the task inline when the harness has no subagents. Wait for all of them, then present design options with pros and cons.
3. **Outline.** Once you agree on an approach, show the phases and what each does, and get feedback before writing details.
4. **Write.** Save to `thoughts/shared/plans/YYYY-MM-DD-PROJ-123-description.md`, or `YYYY-MM-DD-description.md` with no ticket, where `PROJ` is the team prefix in `.catalyst/config.json`. Write only under `thoughts/shared/plans/`; `thoughts/searchable/` is a read-only index. Fill the template in [references/plan-template.md](references/plan-template.md): every phase runs Red, Green, Refactor, and success criteria split into Automated Verification (prefer `make check`) and Manual Verification. Resolve every open question before saving.
5. **Review.** Run `humanlayer thoughts sync`, show the plan's path, and ask whether the phases are scoped right, the criteria specific, and any edge case missing. Revise until the person is satisfied, syncing after each change. Above 60% context, recommend clearing before implementation.
6. **Hand off.** End session tracking, then tell the person to start a fresh session and use the implement-plan skill with `[--team] thoughts/shared/plans/{PLAN_FILENAME}`. Add `--team` for 3+ parallel phases in distinct domains with non-overlapping files, or 10+ files.

Planning moves no ticket; a person who asks for a move uses `catalyst write state <ID> --slot <slot>` (the Cloud pack's `catalyst-linear` skill), or the operator-only `linearis-cli` skill. Once the plan is saved, comment its path on the ticket through the app actor: `catalyst write comment <ID>` on a Catalyst Cloud account, or `linear-reply.mjs --as <role>` from `linearis-cli`. Bare `linearis issues discuss`/`reply` posts as the token's owner, so leave it unused. Skip the comment when `CATALYST_PHASE` is set, and skip silently when `command -v catalyst` and `command -v linearis` both fail.

## Revising an existing plan

Use this when the person names an existing plan (a path, or a ticket with a plan on disk) and asks for changes. Back each change with research, not just text edits.

1. **Find the plan.** Use the path given, or the newest plan for `TICKET_ID`: `find -H thoughts/shared/plans -type f -name '*.md' -ipath "*${TICKET_ID}[!0-9]*" -exec ls -t {} + 2>/dev/null | head -1`. Show it, ask "**Update this plan?** [Y/n]", then ask what should change. With no plan found, ask for its path.
2. **Read it in full**, noting which phases are done.
3. **Research when the change needs it**, with the agents from Step 2. Show the findings (file:line) and their impact before editing.
4. **Update the plan.** Keep completed phases unchanged unless asked. Update pending phases, add or remove phases as the scope moved, and give every change matching success criteria. Append to an `## Iteration History` section the reason, what changed per phase, and any research document used. Resolve every open question.
5. **Save over the existing file** in `thoughts/shared/plans/`, run `humanlayer thoughts sync`, and summarise what changed and which phases it affects.
