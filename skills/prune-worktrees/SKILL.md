---
name: prune-worktrees
description: "Reclaim disk by scanning and pruning stale git worktrees in a Catalyst worktree farm. Use when disk runs low or agents are blocked on writes ('disk full', 'no space left on device', 'ENOSPC', 'free up space'), for a scheduled headless run, or to review protected worktrees (open PRs, stale branches) with staleness hints. Fail-closed: it refuses to run until the installer declares the worktrees root, and removes only provably merged, closed or Done trees that are clean or hold only archived agent residue."
---

# Prune worktrees

A worktree farm holds one checkout per dispatched ticket, each with its own `node_modules` (about 1.8 GB). One deterministic script decides and does every removal: run it rather than pruning by hand.

**Paths.** Commands below name files inside this skill's own directory as `${CLAUDE_SKILL_DIR}/…`. Claude Code fills that in. On any other harness, set CLAUDE_SKILL_DIR to the absolute directory that contains this SKILL.md before running them. If you cannot, stop and report `skill_dir_unresolved`.

```bash
S="${CLAUDE_SKILL_DIR}/scripts/prune-worktrees.mjs"
bun "$S" scan --no-sizes --include-shipped   # fast dry-run: the widest safe set
bun "$S" scan                                # dry-run with sizes
bun "$S" apply                               # remove that set (each removal still fails closed)
bun "$S" candidates                          # the protected set, with staleness hints
bun "$S" remove --path <tree> --why "<who/why>"   # human-approved, one tree at a time
bun "$S" history                             # past runs from the JSONL log
bun "$S" explain ENG-123                     # was a tree ever pruned? why?
```

Add `--json` for the full machine report on stdout; human lines go to stderr. `--actor NAME` labels a run in the log.

## Where it works: declared roots only

The script refuses, exits 2 and touches nothing unless the worktrees root is declared. It never guesses one.

1. Env: `CATALYST_WORKTREES_DIR`, `CATALYST_REPO_ROOT` and `CATALYST_REPLICA_DB`. Env wins, so the scan covers the farm create-worktree writes to.
2. For any role env leaves unset, the installer's machine paths file: `$CATALYST_PATHS_FILE`, else `$XDG_CONFIG_HOME/catalyst/paths.json`, with roles `worktrees`, `repoRoot` and `replicaDb`. A broken file refuses whenever it is consulted.
3. Last, the legacy alias `CATALYST_WORK_TREES`. create-worktree never reads it, so it never outranks the manifest.

Residue archives go to `<dirname(worktrees)>/wt-cleanup-archive/<date>/` unless `CATALYST_WT_ARCHIVE` is set. The run log is `$CATALYST_LOGS_DIR/worktree-prune/runs.jsonl`, default `${XDG_STATE_HOME:-~/.local/state}/catalyst/logs`. If a box refuses, tell the user to run the Catalyst installer or export `CATALYST_WORKTREES_DIR`; pass the root only through those, never as a typed path.

## How safety is decided

Every leaf lands in one class. To explain a verdict, a removal step or a restore, read [`references/safety-model.md`](references/safety-model.md).

| Class | Meaning | Verdict |
|---|---|---|
| `PROTECTED` | a `deploy-`/`release-`/`-R<n>` name or branch, `.catalyst/keep-worktree`, or listed in `<worktrees root>/.keep-worktrees` | never touched, `remove` included |
| `LIVE` | a process has its cwd inside the tree | never touched |
| `ACTIVE` | open PR, locked, or young with no evidence | human review only |
| `MERGED` / `CLOSED_NO_MERGE` | its PR merged, or closed unmerged | auto-prunable |
| `HEAD_IN_MAIN` | no PR, HEAD already in origin's default branch | auto-prunable |
| `STALE` | no evidence, idle over 14 days | only with `--include-stale` |
| `TICKET_SHIPPED` | no PR of its own; its ticket has a merged PR, none open | only with `--include-shipped` |
| `TICKET_DONE` | no open PR; its ticket is Done, Canceled or Duplicate | only with `--include-shipped` |

If the process scan fails, every tree counts as LIVE, nothing is removed, and the run exits 3. A tree touched in the last 6 h, or with any change outside the residue list, is kept. Remote branches are never deleted.

## Workflow

- **Interactive:** read `history`, then `scan --json`; report the prunable count and GB, the protected breakdown, kept-dirty and unregistered dirs. Run `apply` only when the user says go. If space is still tight, run `candidates` and let the user pick, then act on each pick only through `remove --path … --why "…"` (never `rm -rf` or a forced `git worktree remove`).
- **Scheduled:** the Catalyst installer's housekeeping job runs `bun <skills>/prune-worktrees/scripts/prune-worktrees.mjs apply --include-shipped --actor housekeeping`. A headless run keeps to that set. A housekeeping apply also runs `events-housekeeping.mjs run` beside the script, unless `CATALYST_HK_EVENTS_STEP=1`: it migrates legacy event months and prunes months past the retention (default 6).
- For the event-log steps by hand, review subagents for a repo with many protected trees, and how to report space honestly, read [`references/workflows.md`](references/workflows.md).

## Environment

`bun`, `git` and an authenticated `gh` (a repo whose `gh pr list` fails twice gets no PR evidence and nothing in it is removed). macOS needs `lsof`; Linux reads `/proc`. Tunables: `CATALYST_WORKTREE_STALE_DAYS` (14), `CATALYST_PRUNE_RECENT_HOURS` (6), `CATALYST_PRUNE_LINEARIS_MAX` (100).
