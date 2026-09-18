# Farm shape and variable resolution

## The shape this skill supports

`<farm-root>/<project>/<ticket>` — exactly two path segments under the farm root. A candidate at any
other depth is reported `KEEP / unsupported-farm-depth:<n>` and never touched.

The execution host's multi-tenant farm (`/srv/.../tenants/<tenant>/worktrees/<org>/<repo>/<ticket>`,
five segments, arbitrated by `catalyst-cloud`'s `docker-broker` regex) is **out of scope** — that is
CTC-2551, in the `catalyst-cloud` repository. Refusing any depth other than 2 by name, rather than
guessing at tenancy, is what makes this skill safe to install on a machine that also hosts the deeper
farm: it reports every deep-farm tree and removes none of them.

## Variable resolution order

Both directory-variable vocabularies are honoured, canonical name first, so this skill needs no
change whichever way CTC-2548 (the canonical directory-variable contract) finally lands:

- **Farm root**: `${CATALYST_WORKTREES_DIR:-${CATALYST_WORK_TREES:-<profile default>}}`.
  `CATALYST_WORKTREES_DIR` is CTC-2548's canonical name; `CATALYST_WORK_TREES` is its registered
  legacy alias. `<profile default>` is `$HOME/catalyst/wt`, but **only** when `CATALYST_PROFILE` is
  unset or `workstation`. For any other profile, with neither variable set, this skill refuses by
  name and exits 3 rather than guessing a path.
- **Logs**: `${CATALYST_LOGS_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/catalyst/logs}`.
- **Primary-checkout fallback** (used only when a candidate's own git-common-dir can't be read, e.g.
  a prunable stub with no sibling to ask): `${CATALYST_REPO_ROOT:-${CATALYST_HOME:-$HOME/catalyst}/repos}/<project>`.
- **Retention window**: `${CATALYST_WORKTREE_STALE_DAYS:-14}` days. A gate, not a trigger — it can
  only ever *prevent* a removal, never cause one on its own.
- **Actor** (recorded on every log line): `${CATALYST_PRUNE_ACTOR:-$USER@$(hostname)}`.
- **Classifier hook**: `${CATALYST_WT_CLASSIFIER:-}` — see `fail-closed.md`'s `hook-*` reasons. If
  set, it must name an executable; a set-but-non-executable value refuses the whole run (exit 3)
  rather than silently running without the hook the operator configured.
- **Default branch**: `symbolic-ref refs/remotes/origin/HEAD` → `git remote set-head origin -a` and
  retry → `$CATALYST_PRUNE_DEFAULT_BRANCH` if set → the first of `origin/main`, `origin/master`,
  `origin/trunk` that exists. None resolving refuses that whole repository
  (`KEEP / default-branch-unresolved` for every candidate in it) — an unresolvable default must never
  be silently guessed, because the entire merge proof is stated against it.

## Candidate enumeration

Candidates are the **union** of a filesystem walk (`find <farm> -mindepth 2 -maxdepth 2 -type d`) and
each project's primary checkout's own `git worktree list --porcelain` output filtered to paths under
that project. The union matters: a worktree whose directory was deleted behind git's back is invisible
to the filesystem walk alone, but still appears — and needs pruning — in git's own porcelain listing.
Every per-tree question is asked of that tree's own primary checkout
(`git -C <candidate> rev-parse --path-format=absolute --git-common-dir`), never of the farm root
directly — asking the farm root for a worktree list fails outright (`fatal: not a git repository`),
because git discovery only walks up from a directory, never down into children.
