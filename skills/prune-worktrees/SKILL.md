---
name: prune-worktrees
description: "Reclaim disk by scanning and pruning stale git worktrees in a Catalyst worktree farm on any box. Use when disk space runs low or agents are blocked on writes: 'low on disk', 'disk full', 'no space left on device', 'ENOSPC', 'cannot write', 'worktrees are eating my disk', 'free up space', or a scheduled headless run. Also use to review protected worktrees (open PRs, stale branches) with staleness hints and per-repo review subagents. Fail-closed: it refuses to run until the installer declares the worktrees root, and it removes only provably merged, closed or Done trees that are clean or hold only archived agent residue."
---

# Prune worktrees

A Catalyst worktree farm holds one checkout per dispatched ticket, and each can carry its own `node_modules` (about 1.8 GB). A few hundred finished tickets silently eat hundreds of GB. One deterministic script does all of the work. Run it; do not prune by hand.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

```bash
S="${CLAUDE_SKILL_DIR}/scripts/prune-worktrees.mjs"
bun "$S" scan --no-sizes --include-shipped   # fast dry-run: the widest safe set
bun "$S" scan                                # dry-run with sizes
bun "$S" apply                               # remove that set (each removal still fails closed)
bun "$S" candidates                          # the protected set, with staleness hints
bun "$S" remove --path <tree> --why "<who/why>"   # human-approved, one tree at a time
bun "$S" history                             # past runs from the JSONL log
bun "$S" explain CTC-1889                    # was a tree ever pruned? why?
```

Add `--json` for the full machine report on stdout; human lines go to stderr. `--actor NAME` labels a run in the log.

## Where it works: declared roots only

The script refuses, exits 2 and touches nothing unless the worktrees root is declared. It never guesses one.

1. The installer's machine paths file: `$CATALYST_PATHS_FILE`, else `$XDG_CONFIG_HOME/catalyst/paths.json`. It reads the roles `worktrees`, `repoRoot` and `replicaDb`. When the file exists it wins over env, and a broken file refuses.
2. Otherwise env: `CATALYST_WORKTREES_DIR` (legacy `CATALYST_WORK_TREES`), `CATALYST_REPO_ROOT` and `CATALYST_REPLICA_DB`.

Residue archives go to `<dirname(worktrees)>/wt-cleanup-archive/<date>/` unless `CATALYST_WT_ARCHIVE` is set. The run log is `$CATALYST_LOGS_DIR/worktree-prune/runs.jsonl`, default `${XDG_STATE_HOME:-~/.local/state}/catalyst/logs`. If a box refuses, tell the user to run the Catalyst installer or export `CATALYST_WORKTREES_DIR`. Never type a path into the command.

## How safety is decided

Every leaf lands in one class. The full rules, the removal steps and restore are in [`references/safety-model.md`](references/safety-model.md).

| Class | Meaning | Verdict |
|---|---|---|
| `LIVE` | a process has its cwd inside the tree | never touched |
| `ACTIVE` | open PR, locked, or young with no evidence | human review only |
| `MERGED` / `CLOSED_NO_MERGE` | its PR merged, or closed unmerged | auto-prunable |
| `HEAD_IN_MAIN` | no PR, HEAD already in origin's default branch | auto-prunable |
| `STALE` | no evidence, idle over 14 days | only with `--include-stale` |
| `TICKET_SHIPPED` | no PR of its own; its ticket has a merged PR, none open | only with `--include-shipped` |
| `TICKET_DONE` | no open PR; its ticket is Done, Canceled or Duplicate | only with `--include-shipped` |

- LIVE is checked once per run and again right before each removal. If the process scan fails, every tree counts as LIVE, nothing is removed, and the run exits 3.
- A tree touched in the last 6 h is kept. A tree with any change outside the residue list is kept.
- A branch is deleted only after `git branch -d`, or after its commits are bundled and the bundle verifies. There is never a remote delete.

**Linear.** `TICKET_DONE` reads the replica in one query when one is declared. Otherwise it runs `linearis issues read` once per ticket that reaches that check, up to 100 per run. It skips linearis when `CATALYST_PHASE` is set (a phase container holds no Linear credential) or when `command -v linearis` fails, and logs a warning. With neither, there is no Linear trigger.

## Workflow

- **Interactive:** read `history` first, then `scan --json` and report the prunable count and GB, the protected breakdown, kept-dirty and unregistered dirs. Run `apply` only when the user says go. If space is still tight, run `candidates` and let the user pick. Act on picks only through `remove --path … --why "…"`, never `rm -rf` or a forced `git worktree remove`.
- **Scheduled:** the Catalyst installer's housekeeping job runs `bun <skills>/prune-worktrees/scripts/prune-worktrees.mjs apply --include-shipped --actor housekeeping`. Never widen the set further in a headless run.
- **Review subagents** for a repo with many protected trees, and how to report space honestly: [`references/workflows.md`](references/workflows.md).

## Environment

`bun`, `git` and an authenticated `gh` (a repo whose `gh pr list` fails twice gets no PR evidence and nothing in it is removed). macOS needs `lsof`; Linux reads `/proc`. Tunables: `CATALYST_WORKTREE_STALE_DAYS` (14), `CATALYST_PRUNE_RECENT_HOURS` (6), `CATALYST_PRUNE_LINEARIS_MAX` (100).
