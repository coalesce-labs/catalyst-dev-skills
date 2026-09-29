---
name: resume-handoff
description:
  "Resume work from a handoff document: verify the codebase against it, then plan and continue the work. Use when the user says 'resume handoff', 'pick up where we left off' or 'continue from handoff', or gives a handoff document path."
disable-model-invocation: false
allowed-tools: Read, Bash, TodoWrite
version: 1.0.0
---

# Resume work from a handoff document

Resume interactively by default, or unattended when automation reset the session. The handoff's state may no longer match the codebase: verify it before acting.

| when | read |
| -- | -- |
| finding the handoff (no path given, a path or ticket given, or the cited path is missing on disk) | [`references/discovery.md`](references/discovery.md) |
| reading and verifying the handoff, building the plan, and the unattended rules | [`references/process.md`](references/process.md) |
| the codebase has diverged from the handoff | [`references/scenarios.md`](references/scenarios.md) |

## Prerequisites

```bash
# Thoughts must exist for this skill's documents. Set them up with `humanlayer thoughts init` in
# the repo root, or create the worktree with the create-worktree skill, which runs it.
[[ -e thoughts/shared ]] || echo "⚠️ thoughts/shared is missing in $(pwd) — run \`humanlayer thoughts init\` in the repo root, or create the worktree with the create-worktree skill, which does it; if the prompt names an output path, write there" >&2

# explicit-input discovery: begin
# Find the handoff to resume on disk for the ticket this run was given: $CATALYST_TICKET under a
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
RECENT_HANDOFF=""
if [[ -n "$TICKET_ID" ]]; then
  RECENT_HANDOFF=$(find -H thoughts/shared/handoffs -type f -name '*.md' -ipath "*${TICKET_ID}[!0-9]*" -exec ls -t {} + 2>/dev/null | head -1)
elif [[ -z "${CATALYST_PHASE:-}" ]]; then
  RECENT_HANDOFF=$(find -H thoughts/shared/handoffs -type f -name '*.md' -exec ls -t {} + 2>/dev/null | head -1)
fi
# explicit-input discovery: end
# Guard the discovered path anyway — thoughts/shared is a per-project symlink and a path can vanish mid-run; an unguarded read of a phantom path yields an empty document that reads like an empty handoff.
if [[ -n "$RECENT_HANDOFF" && ! -f "$RECENT_HANDOFF" ]]; then
  echo "⚠️ Cited handoff is not on disk: $RECENT_HANDOFF"
  echo "   The channel is authoritative — recover from the last turn's text, see references/discovery.md."
  RECENT_HANDOFF=""
elif [[ -n "$RECENT_HANDOFF" ]]; then
  echo "📋 Found handoff: $RECENT_HANDOFF"
else
  echo "⚠️ No handoff found on disk for ${TICKET_ID:-this run}"
fi
```

Ticket ids look like `PROJ-123`: take the prefix from `.catalyst/config.json`, else write `TICKET-XXX`.

## Invariants

- **Read the handoff document completely** (no `limit`/`offset`) yourself, and every research or plan document it references, before proposing anything. Sub-agents verify the codebase state it describes, never read the handoff itself.
- **Unattended mode is ON** when the arguments contain `--unattended`, `CATALYST_UNATTENDED=1` is set, the run is a pipeline phase (`$CATALYST_TICKET` set with no interactive user), or the invoking prompt says the session is unattended. Then skip every confirmation gate, act on the handoff's recorded next step, and **never end the turn on a question** ([`references/process.md`](references/process.md), "Unattended mode").
- **Otherwise, get user confirmation** before acting on the analysis, and again before starting implementation.
- **A missing handoff file is not lost work.** The channel or ticket thread is authoritative: recover from it rather than redo landed work ([`references/discovery.md`](references/discovery.md)).

## Ticket context

On a cloud account, run `catalyst query issue <ID>` (the Cloud pack's `catalyst-linear` skill); off the cloud, an operator reads Linear with the Linearis CLI directly. Skip every `linearis` call when `CATALYST_PHASE` is set (a phase container holds no Linear credential; the runner owns the ticket write-back) or when `command -v linearis` fails, and say so in one line.
