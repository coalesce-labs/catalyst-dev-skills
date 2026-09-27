# Safety model

The script decides everything below. Read this to explain a verdict, not to act around one.

## How a tree is classified

Discovery walks the worktrees root two levels deep (`<project>/<ticket>`). A leaf is a directory whose `.git` is a gitdir pointer file. A `.git` directory is a full clone: it is reported and never touched. A directory with neither is a stray, removed by `apply` only when empty.

Each leaf's pointer names its owner repo. Per owner, the script reads `git worktree list --porcelain` and one full `gh pr list --state all`. A leaf the owner does not list is reported as unregistered and never touched. Then, per tree, in order:

1. **LIVE.** A process has its cwd at or under the tree. The scan is `lsof -a -d cwd -Fpn` on macOS and `/proc/*/cwd` on Linux. It runs once per run and must see the script's own process, or it counts as failed. A failed scan marks every tree LIVE, removes nothing, and exits 3.
2. **Locked** worktrees are ACTIVE.
3. **Own PR.** A PR whose head is the tree's branch, or whose head is the Mergify stack rename `stack/<user>/<branch>/…`. Any open PR wins (ACTIVE), then merged (MERGED), then closed (CLOSED_NO_MERGE).
4. **No evidence yet:** ACTIVE, or STALE past `CATALYST_WORKTREE_STALE_DAYS` (14) by the tree directory's mtime.
5. **Fresh.** A tree younger than 2 days stops here. A just-created tree sits at main with no PR while its agent starts.
6. **HEAD_IN_MAIN.** HEAD is an ancestor of `origin/HEAD` (else `origin/main`). Removal loses no commit.
7. **Ticket PRs.** The ticket comes from the branch name. If any PR names the ticket (title or head) and one merged with none open, the class is TICKET_SHIPPED. An open ticket PR keeps the tree.
8. **Linear.** Done, Canceled or Duplicate in Linear gives TICKET_DONE. The replica is read once per run. Without one, `linearis issues read <ticket>` runs for each ticket that reaches this step, up to `CATALYST_PRUNE_LINEARIS_MAX` (100). linearis reports only the state's name, so only a stage named Done, Canceled, Cancelled or Duplicate counts. A renamed stage keeps the tree.

If `gh pr list` fails twice for a repo, its trees get no PR evidence and stay ACTIVE or STALE. Every row carries a `reason`, and `scan`/`apply` print a "kept, by reason" summary.

## How a tree is removed

`apply` walks the prunable set. For each tree:

1. **Inside the root.** A path outside the worktrees root is refused.
2. **LIVE again.** The process scan reruns. A holder, or a failed scan, gives `kept-live`.
3. **Recent.** If HEAD, the reflog or any changed file moved in the last 6 h (`CATALYST_PRUNE_RECENT_HOURS`), the tree is `kept-recent`. The index is ignored, because `git status` rewrites it on every scan.
4. **Real changes.** Any changed or untracked file outside the residue list gives `kept-dirty`, with the first paths in the reason.
5. **Residue only.** The residue list is `.envrc`, `.catalyst/config.json.bak-*`, `__pycache__/`, `.turbo/`, `coverage/`, `.session-id` and the context file the retired Claude workflow hook left behind (`TRIVIAL_DIRTY` in the script is the exact list). Tracked edits go to `changes.patch` and untracked files to `untracked.tar.gz`, under `<archive>/<date>/<repo>__<tree>/`. Only then does `git worktree remove --force` run. `--force` is used in no other case.
6. **Branch.** `git branch -d` runs first. If it refuses (a squash merge always does) and the class is MERGED, CLOSED_NO_MERGE, TICKET_SHIPPED or TICKET_DONE, the commits not on origin's default branch go to `unpushed.bundle`. The bundle is verified, then the branch is deleted with `-D`. Any other class keeps the branch. `meta.json` beside the archive records the class and reason.

Remote branches are never deleted.

## Restore

```bash
git -C <repo> fetch <archive>/unpushed.bundle <branch>:<branch>
git -C <repo> worktree add <path> <branch>
cd <path> && git apply <archive>/changes.patch && tar -xzf <archive>/untracked.tar.gz
```

## Why the classifier moved inside the skill (CTC-3644)

The script used to call the execution-core classifier from the retired catalyst plugin. That classifier read only the newest 500 PRs, matched head branches literally (so every Mergify stack PR looked like "no PR"), and stubbed its Linear lookup. On 2026-09-25 it marked about 440 of 461 catalyst-cloud worktrees protected. A second pass in this script already fixed each gap, so the classification now lives here alone, and the live-session join became the process cwd scan.
