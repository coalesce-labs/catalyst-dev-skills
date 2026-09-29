---
name: linearis-cli
description:
  Linearis CLI reference for Catalyst operators (an admin of the cloud account). On a cloud account every Linear read, list, search and supported write goes through `catalyst` (the Cloud pack's `catalyst-linear` skill). Linearis covers only what that route does not support (relations; editing a ticket after it exists, such as title, description, priority, estimate, project, milestone, cycle or assignee; cycle and milestone writes; assigning a ticket to a person or an agent) and a Linear workspace with no cloud account. Use for those operator exceptions with Linear tickets, cycles, projects, milestones, or ticket IDs like TEAM-123.
metadata:
  internal: true
---

# Linearis CLI Reference

> Verified against Linearis v2026.4.9 ([github.com/czottmann/linearis](https://github.com/czottmann/linearis)). On a cloud account, Linear work goes through `catalyst`; this skill holds the operator exceptions. Read [Gotchas](#gotchas--traps) before scripting.

## When to use this
For Catalyst operators, meaning an admin of the cloud account; customers never need it. On a cloud account every read, list, search and supported write goes through `catalyst` (the Cloud pack's `catalyst-linear` skill; without it on PATH, `npx -p @catalyst-cloud/cli catalyst <verb>`):
- reads: `catalyst query issue <ID>`, `catalyst query issues --team K --state S`, `catalyst query search <terms>`, `query projects|cycles|pulls|changes`, `catalyst replica sql "<select>"`;
- writes: `catalyst write comment|state|label|create|reaction|attachment|session`.

Use `linearis` for what that route does not support, and for a Linear workspace with no cloud account:
- relations (blocked-by, related, parent/child);
- editing a ticket after it exists: title, description, priority, estimate, project, milestone, cycle, assignee;
- cycle and milestone writes (create, rename, move a ticket between them);
- assigning a ticket to a person or an agent.

## Setup check (first, every session)
`node "${CLAUDE_SKILL_DIR}/scripts/identity-report.mjs"` — one line per identity (the cloud account, printed as `tenant`; then human, team, cloud host), and every `unresolved` line is a stop-and-say. Paths like that name files inside this skill: Claude Code fills in `${CLAUDE_SKILL_DIR}`; on another harness set CLAUDE_SKILL_DIR to this SKILL.md's directory, or stop and report `skill_dir_unresolved`. A write addressed to the wrong team or the wrong workspace does not error; it lands somewhere plausible, which is why this runs before the first read as well as the first write.

## Reading Linear
On a cloud account, read with `catalyst query …` (add `--json` for scripts). Its freshness gate is built in: `--source replica|api` defaults to the replica when it is fresh, else the API. It needs no helper and no re-check against live Linear.

Off the cloud, or on a machine without the CLI, an operator reads through the raw helper. It is the freshness gate, not a convenience wrapper; never run a bare `sqlite3` query against the replica yourself:
```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/linear-read-replica.sh"
json=$(linear_read_ticket ENG-123) || return 1   # freshness gate → SQL → loud linearis fallback, ONE call
```
When the gate fails it says so loudly and falls back to direct `linearis` reads, which spend the workspace's shared API quota. Gate internals, raw SQL, schema discovery and the apply-drift caveat: [`references/reading-linear-detail.md`](references/reading-linear-detail.md).

## Core Operations
The `linearis` commands below are for the exceptions only; run `linearis usage` / `linearis <domain> usage` for current flag syntax. **Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.

```bash
linearis issues update ENG-123 --blocked-by ENG-100
linearis issues update ENG-123 --priority 1 --project "Auth System"
```

> ⛔ On a cloud account `catalyst write comment <ticket> --body …` is the comment path. Off the cloud, **agent comments → `linear-reply.mjs`, never `issues discuss`/`reply`** — those post AS THE HUMAN (personal token; ask-resolution gate reads that as the human deciding).
```bash
direnv exec . node "${CLAUDE_SKILL_DIR}/scripts/linear-reply.mjs" ENG-123 --as <AGENT> --body-file <path> --top  # --body-file for any multi-line body; --body REFUSES a path
```
`issues discussions <id>` (read-only) is safe. Full CRUD, comment-thread commands, common mistakes, other domains: [`references/core-operations.md`](references/core-operations.md).

## Workflow: Status Transitions
This stage table is not an instruction to move cards. Cards move by events: the cloud moves a ticket when a phase outcome is recorded and when its PR merges. An operator uses the table only when a person explicitly asks for a move off the cloud; on a cloud account a requested move is `catalyst write state <ticket> --slot <slot>`.

⛔ **A stage is addressed by SLOT, never by name**: a cloud account renames its stages freely. Resolve it with `linear-transition.sh --print-state --transition <slot> --team <KEY>`, which walks per-project `stateMap` → global `stateMap` → registry `triageStatus` → bootstrap, and REFUSES when a declared `stateMap` lacks the slot (`null` skips a transition). `--status` fails empty on a typo (Gotcha 4). UUID calls and the team-key cache: [`references/status-transitions.md`](references/status-transitions.md).

| Workflow Phase | Slot (config key) |
| --- | --- |
| New tickets | `stateMap.backlog` |
| Acknowledged | `stateMap.todo` |
| Research / Planning started | `stateMap.research` / `.planning` |
| Implementation | `stateMap.inProgress` |
| Verify / Review phase | `stateMap.verifying` / `.reviewing` |
| PR created | `stateMap.inReview` |
| Completed / Canceled | `stateMap.done` / `.canceled` |

## Gotchas & Traps
1. `issues list` **hides the done stage** (shows the canceled one) — pass `--status "$(state done)"`, or `issues read <ID>` for one.
2. `linearis` **consumes stdin** in a loop — append `</dev/null`.
3. **No `--json` flag** — JSON is the default; pipe to `jq`.
4. `--status` is server-side and **fails empty on a typo** — not an error; also deprecated `--query` (use `issues search`).
5. `--status`/`--cycle` require `--team`; `--milestone` requires `--project`; names collide across projects/teams.
6. `project-milestones` fails **silently** to the help dump — the domain is `milestones`.
7. `status`/`state` are zsh read-only vars (`st`/`s`/`lstate`); `auth status` is the diagnostic entry point when calls return nothing.

Cookbook, one topic per file: off-cloud grooming and edits — [`references/backlog-grooming.md`](references/backlog-grooming.md); milestone create/rename/audit — [`references/milestones.md`](references/milestones.md); labels + the cross-team same-name trap — [`references/labels.md`](references/labels.md); cycle review — [`references/cycles.md`](references/cycles.md).
