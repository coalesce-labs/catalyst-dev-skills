---
name: research-codebase
description:
  "Conduct comprehensive codebase research using parallel sub-agents. **ALWAYS use when** the user
  asks to 'research', 'investigate', 'explore the codebase', 'how does X work', 'find out about', or
  needs deep analysis of how existing code is structured. Produces a research document in
  thoughts/shared/research/ with file:line references."
disable-model-invocation: false
allowed-tools:
  Read, Write, Grep, Glob, Task, TodoWrite, Bash,
  mcp__serena__activate_project, mcp__serena__list_memories, mcp__serena__read_memory,
  mcp__serena__get_symbols_overview, mcp__serena__find_symbol, mcp__serena__find_referencing_symbols,
  mcp__serena__search_for_pattern, mcp__serena__find_file, mcp__serena__list_dir
version: 1.0.0
---

# Research codebase

Answer the person's question by running parallel subagents over the codebase and writing up their findings. You are a documentarian: describe what exists, and critique it or propose changes only when the person asks.

Your job ends when the research document is saved under `thoughts/shared/research/` and synced. Save it there and nowhere else (not memory, not personal notes). Planning and implementation belong to the `create-plan` skill, so stay out of EnterPlanMode.

**Paths.** `${CLAUDE_SKILL_DIR}` is this skill's directory, which Claude Code fills in. On another harness, set it to the directory holding this SKILL.md, or stop and report `skill_dir_unresolved`.

## Start

```bash
# Thoughts must exist for this skill's documents. That is the only host check here: the skill runs anywhere.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2
if [[ -n "${CATALYST_PHASE:-}" ]]; then echo "unattended: CATALYST_PHASE=$CATALYST_PHASE, so never ask and wait"; fi
```

Start session tracking as [references/session-tracking.md](references/session-tracking.md) shows; it also holds the phase and end calls used below. When `CATALYST_PHASE` is set, never ask and wait: there is no second turn, so take the research question from the arguments and the prompt, skip the reply below, and go straight to the steps. Otherwise reply, and wait for the research query:

```
I'm ready to research the codebase. Please provide your research question or area of interest,
and I'll analyze it thoroughly by exploring relevant components and connections.
```

Before the first thoughts read, fast-forward the thoughts checkouts so you read the freshest peer state:

```bash
# Pull-before-read: ff-only, non-fatal, host tooling — never a dependency of the research.
if command -v thoughts-pull-sync >/dev/null 2>&1; then thoughts-pull-sync >/dev/null 2>&1 || true; fi
```

## Steps

0. **Orient with Serena** when the `mcp__serena__*` tools exist; otherwise go straight to Step 1 without a warning. Call `mcp__serena__activate_project` on the repo root, read `mcp__serena__list_memories` and `mcp__serena__read_memory("codebase_map")`, then map the area with `mcp__serena__get_symbols_overview`, `mcp__serena__find_symbol` and `mcp__serena__find_referencing_symbols`, so your agent prompts name specific places for the agents to verify.
1. **Read mentioned files** (tickets, docs, JSON) yourself, in full with no limit or offset, before spawning any subagent.
2. **Decompose the question** into research areas and track each in TodoWrite.
3. **Spawn subagents in parallel**, all at once: `codebase-locator` (where code lives), `codebase-analyzer` (how it works), `codebase-pattern-finder` (existing examples), `thoughts-locator` and `thoughts-analyzer` (past documents in thoughts/), and `external-research` only when the person asks for outside sources. Each agent's instructions ship as `${CLAUDE_SKILL_DIR}/assets/agents/<name>.md`; run a subagent with that file plus your request, or do the task inline when the harness has no subagents. Start with locators, point analyzers at the best findings, and remind each agent it documents rather than evaluates. Record the `researching` phase.
4. **Synthesize** once every agent has finished. Live code is the source of truth; thoughts/ documents add history. Research the code fresh rather than relying on existing docs. Connect findings across components, cite `file.ext:line`, and write `thoughts/searchable/` paths as their `thoughts/shared/` equivalents. Mark the todos complete.
5. **Name the document** `thoughts/shared/research/YYYY-MM-DD-PROJ-XXXX-description.md`, or `YYYY-MM-DD-description.md` with no ticket, where `PROJ` is the ticket prefix in `.catalyst/config.json`. Write only under `thoughts/shared/research/`; `thoughts/searchable/` is a read-only index. Collect the date and time, `git rev-parse HEAD`, `git branch --show-current` and the repository name.
6. **Write the document** from [references/research-template.md](references/research-template.md).
7. **Add GitHub permalinks** (`https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}`) when on main or master or the commit is pushed; on an unpushed branch keep local references.
8. **Sync, comment and present.** Do all three before presenting results.

   **8a.** Run `humanlayer thoughts sync`.

   **8b. Linear comment** (when a ticket is known): comment that research is complete with the document path, through the app actor as [Linear Integration](#linear-integration) describes. Skip this when `CATALYST_PHASE` is set, since the runner publishes the phase outcome itself; if that tooling is not available, skip silently and continue.

   **8c.** Present the summary from the research template, then end session tracking. If context is above 60%, recommend clearing it before planning. Research is complete: stop here, and leave plans and implementation for the person to start.
9. **Follow-up questions** go into the same document. Update `last_updated` and `last_updated_by`, add `last_updated_note`, add a `## Follow-up Research: {Question}` section, spawn agents as needed, and sync again.

## Linear Integration

This skill moves no ticket between workflow stages; on Catalyst Cloud the cloud does that when a phase outcome is recorded.

When a ticket is known (an argument, the query, or context), after the document is saved, post its link as an agent-authored comment through the app actor: `catalyst write comment <ID>` (the Cloud pack's `catalyst-linear` skill) on a Catalyst Cloud account; off the cloud, an operator posts it as the app actor, never with bare `linearis issues discuss`/`reply`, which post as the token's owner. Skip it when `CATALYST_PHASE` is set, and skip silently when `command -v catalyst` and `command -v linearis` both fail.
