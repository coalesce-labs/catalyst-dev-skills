# Fail-closed — the invariant this skill exists to protect

**A wrong deletion is worse than a full disk.** Every classification starts at `KEEP`. A gate may
only move a tree *toward* `KEEP`, never away from it. `git worktree remove` is never called with
`--force`/`-f`, so git itself is a second, independent refusal layer even if this script's own logic
is wrong. The skill removes **directories only** — never a branch, never a ref, never an object —
so even a misclassification loses no commits (verified: after removal the branch, its tip sha and
the commit object all still resolve in the primary checkout).

If you are here to make this more aggressive: don't. Read the rest of this file first, then open a
new ticket that changes this file's own text, so the change is visible in the diff and not merely in
behavior.

## The oracle: measured, not assumed

A cleanup needs to answer "is this branch's content already in the default branch, with nothing of
mine left unpushed?" Five candidate answers were built against a real git fixture (two branches
squash-merged in sequence, matching an ordinary repository) and four were falsified:

- `git merge-base --is-ancestor <branch> origin/main` — a squash merge is never an ancestor, so this
  alone says "not merged" for a genuinely squash-merged branch. It is still **sound in the positive
  direction**, and the skill uses it that way: a tip that IS an ancestor of the default branch is in
  the default branch's history, commits and bytes both, with nothing left unpushed. Without that
  positive arm, a repository that merges with merge commits or fast-forwards reclaims nothing at all
  — every such tree reads `no-commits-beyond-base` forever.
- `git rev-list --count origin/main..branch` — still counts the branch's own commits after a squash
  merge. Always > 0.
- `git cherry -v origin/main branch` — reports `+` (not upstream) for every squash-merged commit.
- `git branch -d branch` — refuses with "not fully merged" for the same reason.
- Whole-tree equality (`git diff --quiet origin/main branch`) — passes for the FIRST branch merged
  into an otherwise-empty repo, then breaks the moment a SECOND branch also merges: `main` now
  differs from the first branch's tree because it also carries the second branch's files. A
  single-merge fixture cannot see this failure; a two-merge fixture can, and
  `tests/prune-worktrees.test.sh`'s fixture always carries at least two merges for exactly this
  reason.

**The oracle that holds is path-scoped content equality**, restricted to the paths the branch
actually touched:

```
git merge-base --is-ancestor refs/heads/<branch> <default>    # merged outright → REMOVE-eligible
base  = git merge-base <default> refs/heads/<branch>
paths = git diff -z --name-only <base> refs/heads/<branch>    # must be non-empty
git diff --quiet <default> refs/heads/<branch> -- "${paths[@]}"   # must exit 0
```

**The pathspec must stay quoted.** `-z` into an array, never an unquoted `$paths`: a path containing
a space splits into two pathspecs that match nothing, and `git diff --quiet` with a pathspec matching
nothing exits **0** — which reads as "every path this branch touched is already in the default
branch" for a branch that was never merged. That is a fail-OPEN, the one thing this skill may never
do, and it is covered by a fixture branch whose only change is a filename with a space in it.

plus a second, independent check that nothing is unpushed: `refs/remotes/origin/<branch>` is absent,
or it points at the same commit as `refs/heads/<branch>` — required because many repositories do not
auto-delete a merged remote branch, so "the remote ref is gone" is not by itself proof of anything.

**Known conservatism, on purpose:** a branch that was genuinely merged, whose touched files the
default branch later modified again, reads `content-not-in:<default>` and is kept. That is the
correct direction to be wrong in — the alternative (removing it) risks losing the branch's specific
version of a file nothing else preserves.

**Established, but not merged**: `git merge-base` resolves but the touched-path set is empty (a
branch that adds and then reverts within itself) — reads `no-commits-beyond-base` and is kept, so a
net-zero branch never slips through as "content already in main".

## Every `KEEP` reason this skill can emit

| reason | meaning |
| --- | --- |
| `dirty` | `git status --porcelain` is non-empty in the worktree |
| `locked` | `git worktree list --porcelain` reports the tree as locked |
| `prunable` | the directory is gone; only `git worktree prune`'s administrative cleanup applies |
| `detached` | the worktree has no branch (`--detach`) — a normal state, not an anomaly |
| `within-retention-window:<N>d` | a file in the tree has an mtime newer than the retention window |
| `content-not-in:<default>` | the merge proof's path-scoped equality check failed |
| `no-commits-beyond-base` | the branch has no commits beyond its merge-base with the default branch |
| `unpushed-commits` | `refs/heads/<b>` and `refs/remotes/origin/<b>` disagree |
| `no-merge-base` | the branch and the default branch share no common ancestor |
| `unsupported-farm-depth:<n>` | the candidate is not exactly two path segments under the farm root (the execution-host, multi-tenant farm — CTC-2551 — is out of scope here) |
| `no-primary-checkout` | the candidate's primary checkout could not be resolved by any means |
| `not-a-registered-worktree` | the directory exists but `git worktree list` does not know it |
| `refs-stale:fetch-failed` | `git fetch --prune origin` failed for this candidate's primary — every candidate in that repo is kept |
| `default-branch-unresolved` | no default branch could be established for this candidate's primary — every candidate in that repo is kept |
| `cwd-containment` | the removal guard's cwd is at or under the target (`worktree-remove-guard.sh`, exit 3) |
| `liveness-unprovable` | the removal guard could not probe for live process handles, e.g. no `lsof` (exit 4) |
| `live-handles` | the removal guard found a live, foreign process handle under the target (exit 5) |
| `removal-refused-by-git` | `git worktree remove` itself refused (dirty/locked changed between classify and act) |
| `hook-keep:<reason>` | `CATALYST_WT_CLASSIFIER` returned `KEEP` with this reason |
| `hook-unusable:crashed` | `CATALYST_WT_CLASSIFIER` exited non-zero — a downgrade-only safety valve that crashed told us nothing, and nothing is not consent to delete |
| `hook-unusable:unparseable` | the hook's output could not be read (no `jq` on this host, or malformed JSON) — same reasoning |
| `hook-upgrade-ignored` | the classifier hook returned `REMOVE` for a tree the built-in gates called `KEEP`; the hook's verdict is logged and ignored — a hook may only ever downgrade toward `KEEP`, never upgrade toward `REMOVE` (`CATALYST_WT_CLASSIFIER`, D7) |

Two reasons — and only these two — are `REMOVE`-eligible:

- `merged:content-in-<default>+nothing-unpushed` — the path-scoped oracle above (squash merges).
- `merged:ancestor-of-<default>` — the branch tip is an ancestor of the default branch (merge-commit
  or fast-forward merges), so every commit it carries is already in the default branch's history.

The retention window is a gate, never a trigger: it can only ever *prevent* a removal. A window this
skill cannot evaluate — a non-numeric `CATALYST_WORKTREE_STALE_DAYS`, a `find` that failed — keeps
the tree. `find -mtime -N` is used rather than a `touch -d "-N days"` threshold file precisely
because the latter is GNU-only and its fallback silently disabled the gate on macOS.

## Why `merged` proves closed, not "merged-or-closed"

The ticket's language is "merged-or-closed". This skill only proves **merged**: a closed-without-merge
branch's content is, by definition, not in the default branch, so it reads `content-not-in:<default>`
and is kept — strictly safer than the ticket's wording, and it needs no GitHub credential (D13), which
keeps this skill runnable on a build machine with none configured.

## What this skill deliberately does not vendor

`worktree-presweep.sh` (which stops live `claude --bg` sessions whose cwd is under a tree) is not
vendored here. Stopping a live process is an action taken against something outside this skill's
control — the opposite of "report and keep". The vendored `worktree-remove-guard.sh` already refuses
a tree with a foreign live process handle (`live-handles`, exit 5), which is the fail-closed answer
to the same hazard without killing anything. Vendoring the presweep would also pull in ~1,250 lines
across four more files and a dependency on the `claude` binary a build machine may not have.
