# Preflight — Branch, Base, and Existing-PR Checks (Steps 1–6)

## Step 1 — Check for uncommitted changes

```bash
git status --porcelain
```

If dirty, offer to commit ("Create commits now? [Y/n]"). Yes → run the `commit` skill's workflow. No → proceed; the user may commit manually later.

## Step 2 — Verify not on main/master

```bash
branch=$(git branch --show-current)
```

On `main`/`master` → error "Cannot create PR from main branch. Create a feature branch first." and exit.

## Step 3 — Detect base branch

```bash
if git show-ref --verify --quiet refs/heads/main; then
    base="main"
elif git show-ref --verify --quiet refs/heads/master; then
    base="master"
else
    base=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
fi
```

## Step 4 — Check if behind base; auto-rebase

```bash
git fetch origin $base
git log HEAD..origin/$base --oneline | grep -q . && echo "Branch is behind $base"
```

If behind: `git rebase origin/$base`. On conflicts: show conflicting files, error "Rebase conflicts detected. Resolve conflicts and run the create-pr skill again.", exit.

## Step 5 — Check for an existing PR

```bash
# On a Mergify stack the pull request is on the stack tool's own branch, where a lookup by this
# branch's name finds nothing, so the stack is asked first.
source "${CLAUDE_SKILL_DIR}/scripts/lib/draft-pr.sh"
LOOKUP_RC=0
stack_pr="$(draft_pr_stack_change_number)" || LOOKUP_RC=$?
[[ $LOOKUP_RC -ne 0 ]] && { echo "create-pr: could not tell whether this stack change already has a pull request (rc=${LOOKUP_RC}); run again" >&2; exit "$LOOKUP_RC"; }
if [[ -n "$stack_pr" ]]; then
  gh pr view "$stack_pr" --json number,url,title,state
else
  gh pr view --json number,url,title,state 2>/dev/null
fi
```

If one exists, show it and ask: "[D] Describe/update this PR  [S] Skip  [A] Abort". D → run the `describe-pr` skill and exit. S → exit success. A → exit. **This is the only interactive prompt in the happy path.**

## Step 6 — Extract ticket from branch name

```bash
# The team key is `linear_team` under [project] in .catalyst/catalyst.toml; a checkout without the
# file falls back to PROJ.
TEAM_KEY=$(awk -F'"' '/^\[project\]/{p=1;next} /^\[/{p=0} p && /^linear_team/{print $2; exit}' .catalyst/catalyst.toml 2>/dev/null)
TEAM_KEY=${TEAM_KEY:-PROJ}

branch=$(git branch --show-current)
[[ "$branch" =~ ($TEAM_KEY-[0-9]+) ]] && ticket="${BASH_REMATCH[1]}"
```
