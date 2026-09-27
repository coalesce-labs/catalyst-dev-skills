# Workflows

## Interactive: a human or a space-crunched agent asked

1. **Read history first.** `bun "$S" history --json` (`$S` is the script path from SKILL.md), and `explain <ticket>` for one tree. It says what was already pruned, by whom, and what was kept-dirty. Don't re-litigate settled decisions.
2. **Scan.** `bun "$S" scan --json`. Report the prunable count and GB, the protected breakdown, kept-dirty and unregistered leftovers. If the user says go, run `apply`.
3. **If space is still tight** (the prunable set was small next to what ACTIVE holds), run `bun "$S" candidates --json`. Each row carries hints: PR open days, branch last-commit age, idle days, size, draft flag. Present a table sorted by size, split by repo, and let the user pick. Offer review subagents for a repo with many candidates (below).
4. **Act on decisions only through `remove --path … --why "…"`.** The `--why` lands in the run log, so future agents inherit the reasoning.
5. **Re-check with `df -h`** and report freed space. APFS may take time to return purgeable space.

## Scheduled: the installer's housekeeping job

The Catalyst installer schedules one command on every box:

```bash
bun <skills>/prune-worktrees/scripts/prune-worktrees.mjs apply --include-shipped --actor housekeeping
```

`<skills>` is the installed skills directory (the paths.json `skills` role). The job needs the machine paths file, or `CATALYST_WORKTREES_DIR` in its environment, plus `PATH` with `bun`, `git`, `gh` and, on macOS, `lsof`. Exit codes: 0 done, 2 refused (no declared root; nothing touched), 3 the process scan failed (nothing removed), 1 any other error.

The same apply then runs the event-log step (an installer that runs it as its own step sets `CATALYST_HK_EVENTS_STEP=1`, and the apply skips it). By hand:

```bash
node <skills>/prune-worktrees/scripts/events-housekeeping.mjs run
```

The events directory is `CATALYST_EVENTS_DIR`, else `paths.events` in the machine paths file, else `~/.local/state/catalyst/events`.

- **Migrate:** each month older than the current one moves from the legacy `~/catalyst/events` into that directory. The legacy file is claimed first by renaming it to `<name>.migrating`, so an unwritable legacy directory fails before anything is copied. A month found in both is merged, legacy lines first, with a newline added if the legacy file lacks a final one. The staged file is removed only after the merged file's size matches the inputs. A staged file left behind by a failure is never merged again. The current month's legacy file stays until next month, because an older writer may still be appending to it.
- **Prune:** month files (`YYYY-MM.jsonl`, the writer's rotated `YYYY-MM.jsonl.legacy[.<ts>.<pid>]`, and `YYYY-Www.jsonl`, which counts in the month of its Sunday so a week reaching into a kept month is kept) older than the retention are deleted from both directories. The retention is `--keep-months N`, else `CATALYST_EVENTS_RETENTION_MONTHS`, else 6, and the current month always counts as one of them. Nothing else in the directory is touched.
- **Exit codes:** 0 done, 1 a file failed (named in the output), 2 a bad or missing retention value or an unresolvable events directory (checked before either step, so nothing is touched).

`list` shows every month file in both directories. Use it until the legacy one is empty. `--dry-run` prints the plan without changing anything.

A headless agent that reads the result afterwards may summarise `history --limit 5` and flag kept-dirty trees and repos whose `gh` failed. It never deletes or forces anything itself, and never widens the set past `--include-shipped`.

## Per-repo review subagent: the ambiguous middle ground

When a repo holds many protected trees, fan out one subagent per repo, pointed at the main checkout so it can absorb project context.

- **Workspace:** the repo's owner path, from the candidates JSON `owner` field. It reads `AGENTS.md` or `CLAUDE.md` and skims docs first.
- **Input:** that repo's candidate rows (branch, ticket, PR number, state and open days, last-commit age, size, hints), inline as JSON.
- **Job:** for each row, gather context (PR review activity, CI state, whether the branch diverged from a later refactor, recent activity on those paths) and return `{branch, verdict: keep|prune-safe|uncertain, evidence, one_line_reason}`.
- **The subagent never deletes anything.** It returns verdicts, the human approves, and you run `remove --why "reviewed by subagent <repo>: <reason>"`.

## Report space honestly

Per-tree `du` (the `sizeKb` fields) is logical size. bun and pnpm install `node_modules` as APFS clones with shared blocks, so a du sum counts the same bytes several times. Use `sizeKb` only to rank trees. For what was reclaimed, trust the `df` delta that `apply` logs as `physicalFreedKb`, and say "nominal" or "physical" whenever you report a number.

## The run log

`$CATALYST_LOGS_DIR/worktree-prune/runs.jsonl` holds one JSON line per scan, apply or remove: `{ts, mode, actor, root, totals, liveScan, prunable|result, protected, why}`. `history` tails it and `explain` searches it. A worktree that vanished without a log line was deleted by something else, which is worth surfacing.
