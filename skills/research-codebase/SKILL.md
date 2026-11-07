---
name: research-codebase
description: "Research how the codebase works for a question or a ticket, using parallel subagents, and write a research document with file:line references to thoughts/shared/research/. Use when asked to research, investigate or explore the codebase, or how something works."
allowed-tools: Read, Write, Grep, Glob, Task, TodoWrite, Bash
metadata:
  version: "2.0.0"
---

# Research codebase

Describe what exists, with evidence. Critique or propose changes only when asked. The job ends when the research document is saved and synced.

**Unattended.** When `CATALYST_PHASE` is set, or a coordinator started you, take the question from the ticket (the argument or `$CATALYST_TICKET`) and never ask and wait. Otherwise ask for the question if none was given.

**Paths.** `${CLAUDE_SKILL_DIR}` is this skill's directory. On a harness that does not fill it in, set it to the directory holding this file.

## Steps

1. **Read what is named.** Read the ticket and every file it mentions, whole, before starting any subagent.
2. **Split the question** into areas, one todo each.
3. **Run subagents in parallel.** The instructions for each live in `${CLAUDE_SKILL_DIR}/assets/agents/<name>.md`: `codebase-locator` (where code lives), `codebase-analyzer` (how it works), `codebase-pattern-finder` (existing examples), `thoughts-locator` and `thoughts-analyzer` (earlier documents), and `external-research` only when outside sources are asked for. Each file's `model` line names the tier to run it on. With no subagents, do the same work inline.
4. **Synthesize.** The live code is the source of truth; thoughts documents add history. Cite `path:line` for every claim, with the path relative to the repository root (`apps/runner/src/loop.ts:42`, never `loop.ts:42`), so a checker can open each one.
5. **Write** `thoughts/shared/research/YYYY-MM-DD-<TICKET>-<slug>.md` (drop `<TICKET>` when there is none) from [references/research-template.md](references/research-template.md). Fetch `origin/main` first and record the full HEAD sha, branch, `origin/main` sha and merge-base in the frontmatter.
6. **Sync** with `humanlayer thoughts sync`. If the sync fails, the document is still saved: say so in the report and carry on.
7. **Report** a short summary and end with the document's path on its own last line.

A follow-up question goes into the same document under `## Follow-up: <question>`, with `last_updated` bumped, then sync again.
