---
name: create-plan
description: "Write or revise a test-first implementation plan in thoughts/shared/plans/, with numbered acceptance criteria that each name the test proving them. Use when asked to plan a change, design the approach, or update a plan because requirements changed. Works best after research-codebase."
allowed-tools: Read, Write, Grep, Glob, Task, TodoWrite, Bash
metadata:
  version: "2.0.0"
---

# Create plan

A plan is done when someone else could implement it without asking you anything, and when every acceptance criterion names the test that proves it. The implementer proves each criterion, and the reviewer checks the criteria, so they are the contract for everything after this stage.

**Unattended.** When `CATALYST_PHASE` is set, or a coordinator started you, plan from the research file you were given (or from the ticket alone, saying so), decide every open question from the evidence, record each decision in the plan, and never ask and wait. Otherwise agree the approach with the person before writing details.

**Paths.** `${CLAUDE_SKILL_DIR}` is this skill's directory. On a harness that does not fill it in, set it to the directory holding this file.

## Steps

1. **Read what is named.** The research document, the ticket, and every file they cite, whole.
2. **Check the code.** Verify each requirement against the code with the agents in `${CLAUDE_SKILL_DIR}/assets/agents/` (`codebase-locator`, `codebase-analyzer`, `codebase-pattern-finder`), in parallel, or inline without subagents. Research every correction a person makes before accepting it.
3. **Write the acceptance criteria first.** `AC1`, `AC2`, …: each one observable behaviour, taken from the ticket's scenarios when it has them, and the test that will prove it. Then the phases that deliver them, each test first.
4. **Write** `thoughts/shared/plans/YYYY-MM-DD-<TICKET>-<slug>.md` from [references/plan-template.md](references/plan-template.md). Fetch `origin/main` first and record the full HEAD sha, branch, `origin/main` sha and merge-base in the frontmatter. Set `source_research` to the research document's own thoughts filename (`YYYY-MM-DD-<TICKET>-<slug>`), never to a copy such as `research.md`. List the real paths under `## Files in scope`, including existing test files that gain tests. Leave no open question in the file.
5. **Sync** with `humanlayer thoughts sync` (if it fails, the plan is still saved: say so in the report), then report and end with the plan's path on its own last line.

## Revising a plan

Read the plan whole, research what the change needs, then edit only the pending phases and their criteria. Append the reason and what changed to `## Iteration history`, save over the same file, and sync.
