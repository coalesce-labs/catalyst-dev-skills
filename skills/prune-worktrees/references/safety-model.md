# Safety model

The script decides everything below. Read this to explain a verdict, not to act around one.

## How a tree is classified

Discovery walks the worktrees root in both layouts: the flat `<project>/<ticket>` and the by-org `<org>/<repo>/<ticket>` create-worktree writes. Symlinks are never followed, so a compatibility link left at an old flat path is not counted twice. A leaf is a directory whose `.git` is a gitdir pointer file. A `.git` directory is a full clone: it is reported and never touched. A directory with neither is a stray, removed by `apply` only when empty.

Each leaf's pointer names its owner repo. Per owner, the script reads `git worktree list --porcelain` and one full `gh pr list --state all`. A leaf the owner does not list is reported as unregistered and never touched. Then, per tree, in order:

1. **PROTECTED.** Checked before anything else, in classification and again at removal. A tree is protected when its directory name or its branch basename matches `/^(deploy|release)-|-R\d+(-|$)/`, when it contains `.catalyst/keep-worktree`, or when `<worktrees root>/.keep-worktrees` lists it by path relative to the root or by bare name (one entry per line, `#` comments). The reason: a release build can read a prior release tree's gitignored build output, so removing an idle, clean release tree whose HEAD is in main can break the next build. An in-use check cannot catch that, because such trees sit idle. A protected tree is reported as `kept-protected`, counted in `totals.keptProtected`, and never removed, by `apply` or `remove --path` alike; `remove` exits 1. Scheduled references also protect trees, including explicit removal. A reason for removal does not bypass these rules.
2. **LIVE.** A visible process has its cwd at or under the tree, or names a path in it in its arguments. The scan is `lsof -a -d cwd -Fpn` on macOS and `/proc/*/cwd` and NUL-separated cmdline on Linux. macOS also reads untruncated `ps` arguments. Only the scanner's own arguments are ignored; its cwd still counts. It runs once per run and must see the script's own process, or it counts as failed. A failed scan marks every tree LIVE, removes nothing, and exits 3.
3. **Locked** worktrees are ACTIVE.
4. **Own PR.** A PR whose head is the tree's branch, or whose head is the Mergify stack rename `stack/<user>/<branch>/…`. Any open PR wins (ACTIVE), then merged (MERGED), then closed (CLOSED_NO_MERGE).
5. **No evidence yet:** ACTIVE, or STALE past `CATALYST_WORKTREE_STALE_DAYS` (14) by the tree directory's mtime.
6. **Fresh.** A tree younger than 2 days stops here. A just-created tree sits at main with no PR while its agent starts.
7. **HEAD_IN_MAIN.** HEAD is an ancestor of `origin/HEAD` (else `origin/main`). Removal loses no commit.
8. **Ticket PRs.** The ticket comes from the branch name. If any PR names the ticket (title or head) and one merged with none open, the class is TICKET_SHIPPED. An open ticket PR keeps the tree.
9. **Linear.** Done, Canceled or Duplicate in Linear gives TICKET_DONE. The replica is read once per run, and the state is the workflow state joined by `state_id`. `issues.state_type` and `issues.state` are never read, because they go stale: a reopened ticket can still say `completed`. An issue with no joined workflow state gives no Linear evidence. Without a replica, `linearis issues read <ticket>` runs for each ticket that reaches this step, up to `CATALYST_PRUNE_LINEARIS_MAX` (100). linearis is read for `state.name` only, never a top-level status or type field, so only a stage named Done, Canceled, Cancelled or Duplicate counts. A renamed stage keeps the tree. linearis is skipped, with a warning, when `CATALYST_PHASE` is set (a phase container holds no Linear credential) or `command -v linearis` fails; with neither replica nor linearis there is no Linear trigger.

If `gh pr list` fails twice for a repo, its trees get no PR evidence and stay ACTIVE or STALE. Every row carries a `reason`, and `scan`/`apply` print a "kept, by reason" summary.

## How a tree is removed

`apply` walks the prunable set. For each tree:

1. **Protected.** Keep rules and a fresh scheduler inventory are checked again before any archive or deletion. A match gives `kept-protected`.
2. **Inside the root.** A path outside the worktrees root is refused.
3. **LIVE again.** The process scan reruns. A holder, or a failed scan, gives `kept-live`.
4. **Recent.** If HEAD, the reflog or any changed file moved in the last 6 h (`CATALYST_PRUNE_RECENT_HOURS`), the tree is `kept-recent`. The index is ignored, because `git status` rewrites it on every scan.
5. **Real changes.** Any changed or untracked file outside the residue list gives `kept-dirty`, with the first paths in the reason.
6. **Residue only.** `TRIVIAL_DIRTY` in the script is the exact list:
   - anywhere in the tree: `.envrc`, `__pycache__/`, `.turbo/`, `coverage/`, `.session-id`, and the context file an agent workflow hook leaves behind;
   - these exact paths from the tree root: `.catalyst/config.json.bak-*`, `.catalyst/hosts.json`, `.catalyst/findings/current.jsonl`, `.claude/rules/skill-references.md`, `.codex/agents/<name>.toml` and `.claude/scheduled_tasks.lock`. Any other `.claude/rules/` file is real work.

   A residue file may be an edit, a deletion or untracked. A repository that tracks `scheduled_tasks.lock` shows it deleted in its worktrees. Tracked edits and deletions go to `changes.patch` (`git diff HEAD`), and untracked files to `untracked.tar.gz`, under `<archive>/<date>/<repo>__<tree>/`, or `<repo>__<tree>-2/` and so on when that name is already taken that day (two owners' clones can share a repo name), so no archive is ever overwritten. Only then does `git worktree remove --force` run. `--force` is used in no other case.
7. **Branch.** `git branch -d` runs first. If it refuses (a squash merge always does) and the class is MERGED, CLOSED_NO_MERGE, TICKET_SHIPPED or TICKET_DONE, the commits not on origin's default branch go to `unpushed.bundle`. The bundle is verified, then the branch is deleted with `-D`. Any other class keeps the branch. `meta.json` beside the archive records the class and reason.

Remote branches are never deleted.

## Restore

```bash
git -C <repo> fetch <archive>/unpushed.bundle <branch>:<branch>
git -C <repo> worktree add <path> <branch>
cd <path> && git apply <archive>/changes.patch && tar -xzf <archive>/untracked.tar.gz
```

## Scheduled references and visibility

The scanner reads user LaunchAgents in `~/Library/LaunchAgents` and readable system plists in `/Library/LaunchAgents` and `/Library/LaunchDaemons`. Native `plutil` decodes XML and binary plists. It checks `Program`, `ProgramArguments`, `WorkingDirectory`, `StandardOutPath` and `StandardErrorPath`. Reasons name the label or plist filename and field. Only `crontab -l` for the invoking user is read. Reasons include the user, source line and active entry.

Both reference and tree paths resolve symlinks through their longest existing ancestor, including missing scripts and future log files. Relative launchd paths use the declared WorkingDirectory. Cron paths use its static HOME. Relative process arguments use that process's visible cwd; absolute arguments still count without cwd access. Home forms `~/`, `$HOME/` and `${HOME}/` expand without executing shell code. Shell substitutions, arbitrary variables and dependencies inside sourced scripts are not evaluated. Matching uses path boundaries.

Missing scheduler directories and a normal no-crontab result are empty sources. An absent crontab command is reported as unavailable. Unreadable system directories are skipped with a diagnostic. An unreadable user directory, malformed plist, decoder error, or unexpected cron failure makes scheduler safety unknown. All otherwise unprotected trees are kept with `scheduled reference scan failed; removal refused`. Scan/apply exit 3, including a failure on the final refresh. Explicit removal returns `kept-protected`, preserves the source error, and exits 1. Known keep reasons survive failures in other sources.

Each removal refreshes both scheduler and process inventories before archiving or mutating branches. Sources are collected once per snapshot. Permission-denied processes and unreadable system scheduler locations are visibility limits. This does not inspect other users' crontabs, systemd, every open file, or sourced-script dependency graphs. macOS adapter and process formatting have fixture coverage; native host confirmation is still needed.
