---
name: create-handoff
description:
  "Write a handoff document so a fresh session can continue this work. Use when the user says
  'create a handoff', 'hand this off', 'save progress for later' or 'I need to stop here', or when
  context usage passes 60% during implementation and the work must continue in a new session."
disable-model-invocation: false
allowed-tools: Write, Bash, Read
version: 1.0.0
---

# Create Handoff

Compact your context into one document that another agent, in a new session, can resume from without losing a key detail.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

```bash
# Thoughts must exist for this skill's documents. Set them up with `humanlayer thoughts init` in
# the repo root, or create the worktree with the create-worktree skill, which runs it.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2
```

Ticket ids look like `PROJ-123`: take the prefix from `.catalyst/config.json`, else write `TICKET-XXX`.

## 1. Resolve the path with the helper

Write only under `thoughts/shared/` (`thoughts/searchable/` is a read-only index), at the path the helper computes. `thoughts/shared` is a per-project symlink, and a hand-typed `HH-MM-SS` drifts between filename, frontmatter and citation, so a composed path is one the next turn cannot find.

```bash
source "${CLAUDE_SKILL_DIR}/scripts/lib/handoff-durability.sh"

# <scope> = the ticket id (e.g. PROJ-123), or `general` when there is no ticket.
# <description> = brief kebab-case description.
HANDOFF_PATHS="$(handoff_resolve_path "<scope>" "<description>")"
HANDOFF_REL="$(printf '%s\n' "$HANDOFF_PATHS" | sed -n '1p')"   # thoughts/shared/handoffs/...
HANDOFF_ABS="$(printf '%s\n' "$HANDOFF_PATHS" | sed -n '2p')"   # /Users/.../repos/<project>/shared/...
printf 'relative: %s\nabsolute: %s\n' "$HANDOFF_REL" "$HANDOFF_ABS"
```

Capture both lines (e.g. `thoughts/shared/handoffs/PROJ-123/2025-01-08_13-55-22_auth-feature.md` and its absolute path). The frontmatter `date` is the timestamp in `$HANDOFF_REL`. Before writing, fetch `origin/main`; record the full `git rev-parse HEAD`, `git branch --show-current`, fetched `origin/main` SHA, `git merge-base origin/main HEAD`, and repository name. These refs identify the handoff's exact source and its main baseline.

## 2. Write the document to a temp file

```bash
HANDOFF_TMP="$(mktemp -t handoff-XXXXXX)"   # Write your document content here.
```

```markdown
---
date: [ISO date-time with timezone]
researcher: [name from thoughts status]
git_commit: [full commit SHA]
branch: [branch]
git_main_sha: [fetched origin/main full SHA]
git_merge_base: [merge-base of git_main_sha and git_commit]
repository: [repository name]
topic: "[Feature/Task Name] Implementation Strategy"
tags: [implementation, strategy, relevant-component-names]
status: complete
last_updated: [YYYY-MM-DD]
last_updated_by: [researcher name]
type: handoff
source_ticket: [TICKET-ID or null]
source_plan: "[[plan-filename]]" # or null
source_research: "[[research-filename]]" # or null
---

# Handoff: {TICKET or General} - {very concise description}

## Resume contract

- **Stopped at:** {the exact point you stopped: the file:line, command, or step you were in the middle of, and whether it finished}
- **Next step:** {ONE concrete action the next session takes first, e.g. "run `bun run test` in <worktree>, then fix the failing contract test"}
- **Re-arm:** {every loop, wakeup, monitor, watch or background task that was running and died with this session, with the command that restarts it; "none" if none}
- **Open questions:**
  - {question} **Default if unanswered:** {what the next session does if no human answers}
  - {"none" if none}
- **Autonomy:** {whether this work may continue unattended; list every action that needs a human first (merge, deploy, delete, a message to a person), or "none beyond the repo's normal gates"}

## Task(s)

{each task and its status (completed, in progress, planned); the plan phase you are on; wiki-links to the plan and research, e.g. [[plan-filename]]}

## Critical References

{the 2-3 specs, decisions or design docs that must be followed, as wiki-links; blank if none}

## Recent changes

{the changes you made, as file:line references}

## Learnings

{patterns, root causes and anything else the next agent must know, with file paths}

## Artifacts

{an exhaustive list of files you produced or updated, as paths or file:line references}

## Action Items & Next Steps

{the next agent's action items, from the task statuses above}

## Other Notes

{anything else useful: where the relevant code and documents live}
```

The Resume contract is required, filled in place (never "see below"): an automated context reset resumes from it with nobody watching (the `resume-handoff` skill's unattended mode). Elsewhere, cite `path/to/file.ext:12-24` rather than pasting code.

## 3. Install, sync, and report the durability verdict

```bash
# Installs atomically, then RE-READS the destination and byte-compares. Non-zero means the
# handoff is NOT on disk: say so and stop, do not announce a path that does not exist.
HANDOFF_ABS="$(handoff_write_verified "$HANDOFF_ABS" "$HANDOFF_TMP")" || exit 1
rm -f "$HANDOFF_TMP"

# Echoes exactly one verdict token: `synced`, or `local-only:<reason>`.
HANDOFF_VERDICT="$(handoff_sync_and_classify "$HANDOFF_ABS")"
printf 'absolute: %s\nrelative: %s\nverdict: %s\n' "$HANDOFF_ABS" "$HANDOFF_REL" "$HANDOFF_VERDICT"
```

Cite the echoed paths and verdict verbatim. Do NOT re-type the path or the timestamp from memory: a stamp off by one second misses a file that exists.

## Durability contract

Report the verdict you actually got. Each carries this guarantee:

| Verdict | What it guarantees |
|---|---|
| `synced` | Sync exited 0 **and** the bytes are in the thoughts repo's upstream tree. Safe to cite **from any host, now**. |
| `local-only:sync-failed` | `humanlayer thoughts sync` exited non-zero (typically a rebase conflict). |
| `local-only:not-in-pushed-tree` | Sync exited 0 but the file never reached the pushed tree: the silent-abort case. |
| `local-only:sync-unavailable` | No `humanlayer` on PATH. |
| `local-only:git-unavailable` | No `git`, or the thoughts tree is not a checkout, so durability is unprovable here. |

- Every `local-only:*` verdict still means the file is written and verified at `$HANDOFF_ABS`: nothing is lost, and the path is safe to cite on this host now. Leave the sync to its own retries; a second retry ladder on one failure is a storm.
- The next-tick guarantee applies to `not-in-pushed-tree` only: the sync ran, and the next tick (≤300 s) usually carries the bytes up. `sync-failed`, `sync-unavailable` and `git-unavailable` persist until someone fixes the conflict or the tooling, so call them host-local until something verifies the pushed bytes.
- `$HANDOFF_ABS` is this host's absolute path. Cite it for same-host use, and cite `$HANDOFF_REL` as the portable identity a reader on another host resolves in their own tree.
- Say "synced" only on the `synced` verdict.

**Unattended mode** is ON when the arguments contain `--unattended`, `CATALYST_UNATTENDED=1` is set, the run is a pipeline phase (`$CATALYST_TICKET` set with no interactive user), or the invoking prompt says the session is unattended. In unattended mode the response below is the whole reply: add no question, no offer, and no "want me to…" line, and put `--unattended` on the resume command so the next session inherits the mode.

Reply with the template for your verdict, without the tags.

**When `HANDOFF_VERDICT` is `synced`:**

<template_response> Handoff written, verified, and synced — the pushed bytes are this handoff. Resume from it in a new session with:

```text
Use the resume-handoff skill with <`--unattended` when this run is unattended> <the echoed absolute path>
```

On another host, resolve `<the echoed relative path>` in that host's thoughts tree.

</template_response>

**When `HANDOFF_VERDICT` is `local-only:not-in-pushed-tree`** (the async case, a tick may still carry it up):

<template_response> Handoff written and verified on disk, but **not yet in the pushed tree** — safe to cite on this host now; cross-host resume follows the next sync tick (≤300 s). Resume from it with:

```text
Use the resume-handoff skill with <`--unattended` when this run is unattended> <the echoed absolute path>
```

</template_response>

**When `HANDOFF_VERDICT` is any other `local-only:*`** (`sync-failed`, `sync-unavailable`, `git-unavailable`, none of which waits on a tick):

<template_response> Handoff written and verified on disk, but **host-local** (`<the verdict>`) — it is safe to cite on this host now, and it will **not** become cross-host on its own: this verdict means the sync could not run or could not complete, so it stays here until that is resolved. Resume from it on this host with:

```text
Use the resume-handoff skill with <`--unattended` when this run is unattended> <the echoed absolute path>
```

</template_response>
