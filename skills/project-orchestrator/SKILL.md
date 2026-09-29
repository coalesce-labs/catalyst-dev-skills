---
name: project-orchestrator
description:
  Run the project orchestrator — the long-lived, single-threaded owner of ONE project that moves
  ready backlog tickets to Todo, lets the tenant's scheduler dispatch them, watches the work, and
  communicates in threaded Linear comments. Use when asked to run/own/coordinate a project or its
  backlog. It never dispatches a worker; Todo is its only dispatch verb.
user-invocable: true
---

# Project orchestrator — move ready tickets to Todo, watch, and speak in threads

This is the **project-scoped invocation of the `steward` skill**, which is the canonical implementation of this role. The role is named `steward` in code and docs because *orchestrator* is reserved for the pipeline MACHINERY, never for an agent — so **run the `steward` skill with scope = your project** and follow its loop. This file states the shape and points at the steward mechanics.

## The shape you run (steward implements each step)

1. **CLAIM** — assignee on the tracking ticket + 👀 the human's latest comment (the `ask` skill's `scripts/linear-ack.mjs`).
2. **SCOPE** — read the project + its tickets from the **replica** (freshness-gate the `-wal`).
3. **SELECT** — keep the READY tickets: four readiness tests → the `steward` skill's `references/readiness.md`.
4. **PLAN** — ONE top-level `Project orchestrator — <date>` comment; everything threads under it.
5. **DISPATCH** — move ready tickets to **Todo**, priority order, capped at the scheduler's free slots →
   the `steward` skill's `references/cloud-dispatch.md`.
6. **WATCH** — bounded replica poll ≤ 5 min: state changes, comments, PRs on your scope.
7. **SPEAK** — reply in the thread the message arrived in; a human decision → an **ask**, then
   proceed on the default → the `steward` skill's `references/threads.md`, the `ask` skill's `references/threading.md`.
8. **CLOSE** — a merged PR's ticket goes to **Done**, stated in the project thread.

(Steward adds STATUS DOC and HAND OFF — the `steward` skill's `references/status-doc.md` and `references/resume.md`. A stalled ticket gets a nudge in its own thread — the `steward` skill's `references/stalls.md`.)

## Invariants (must survive codification)

- **Todo is your only dispatch verb** — never a worker, worktree, `claude -p`, or phase agent, and
  you write **no product code**: you change ticket state and post comments.
- **Never dispatch a worker directly** — you change state; the tenant's *existing* pull-based
  scheduler dispatches. That is the architectural point.
- **A cap is never silent** — every ready ticket you did not dispatch is named, with why.
- **Reads → the replica** (freshness-gate the `-wal`, not the `.db`); **writes → the cloud proxy**
  (comment/state/label/reaction routes), not `api.linear.app`.
- **Comment threads are ONE level deep** — a `parentId` must be a top-level comment.
- **Never reply as the human** — anything needing them is an ask (Options + Default if silent).

## Pointers

`steward` (canonical engine) · `ask` · `linearis` · `gherkin-ticket`.

**Phase-container guard:** skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails (the CLI is not installed); say so in one line and continue.
