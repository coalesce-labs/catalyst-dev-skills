---
name: prune-worktrees
description: "Reclaim disk from a git worktree farm without ever deleting unmerged work: classify
  every tree under CATALYST_WORKTREES_DIR, remove only the ones provably merged with a clean working
  copy past the retention window, and report every ambiguous tree with a named reason instead of
  deleting it. Dry-run by default and on any machine it has never run on. **ALWAYS use when** the
  user says 'prune worktrees', 'clean up worktrees', 'reclaim disk', 'the worktree farm is full', or
  when setup reaches its housekeeping step."
disable-model-invocation: false
allowed-tools: Bash, Read
argument-hint: "[--dry-run | --apply] [--farm <dir>] [--json]"
version: 1.0.0
---

# Prune worktrees (fail-closed disk reclamation)

## Fail-closed — read this before changing anything

Only trees this skill can **prove** are merged, clean and past the retention window are removed;
every ambiguous tree is reported and left in place. On a shared machine a wrong deletion is worse
than a full disk, and no amount of reclaimed disk justifies relaxing a gate. The full contract —
every `KEEP` reason, the rejected oracles and why — is in `references/fail-closed.md`, enforced by
`tests/prune-worktrees.test.sh`.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

## Run it

```bash
"${CLAUDE_SKILL_DIR}/scripts/prune-worktrees.sh"              # dry run: classify, log, remove nothing
"${CLAUDE_SKILL_DIR}/scripts/prune-worktrees.sh" --apply      # remove what is provably safe (first run on a machine still removes nothing — see below)
"${CLAUDE_SKILL_DIR}/scripts/install-schedule.sh" --render systemd   # preview the recurring schedule
"${CLAUDE_SKILL_DIR}/scripts/offer-schedule.sh"                # propose a schedule + retention window; writes nothing
"${CLAUDE_SKILL_DIR}/scripts/offer-schedule.sh" --accept       # accept and install the schedule
"${CLAUDE_SKILL_DIR}/scripts/offer-schedule.sh" --decline      # decline, recorded once — not asked again
```

A machine with no receipt on disk yet always dry-runs, even with `--apply`: the run reports what it
would remove, removes nothing, and writes the receipt. A second, explicit `--apply` is required to
delete anything. Every run — removing something or not — writes a parseable JSONL log under
`${CATALYST_LOGS_DIR}/prune-worktrees/` (`references/log-format.md`).

## Provenance and reconciliation

CTC-2550 asked to publish a `prune-worktrees` skill already authored on a separate laptop session.
That session and its files were unreachable from this container (no `~/.claude/skills`, no other
Claude session in `ListAgents`), so this implementation was written directly to the ticket's stated
contract rather than forked. If the laptop original arrives later, it may freely add: an interactive
review mode, staleness hints, and per-repo review subagents — none of that changed the fail-closed
invariant here. What may **not** change without a new ticket: the invariant in
`references/fail-closed.md` — only provably merged, clean, past-retention trees are auto-removed.

## References

- `references/fail-closed.md` — the invariant, every `KEEP` reason, and the oracles this plan
  measured and rejected.
- `references/farm-shape.md` — the `<project>/<ticket>` farm shape, variable resolution order, and
  the execution-host farm's out-of-scope depth.
- `references/schedule.md` — the three scheduling platforms and what each installer verb does.
- `references/log-format.md` — the JSONL record schema and how to read a run.
