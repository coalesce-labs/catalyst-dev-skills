# PR Identification and Pre-Merge Verification (Steps 1–5)

_Steps to identify the target PR, verify it is open and mergeable, merge the base in if behind, and run local tests before entering the blocker-diagnosis loop._

## Step 1 — Identify PR to merge

If a PR number was passed as argument, use it. Otherwise:

```bash
gh pr view --json number,url,title,state,mergeable 2>/dev/null
```

If no PR on current branch:
```bash
gh pr list --limit 10 --json number,title,headRefName,state
```
Ask: "Which PR would you like to merge? (enter number)"

## Step 2 — Get PR details

```bash
gh pr view $pr_number --json \
  number,url,title,state,mergeable,mergeStateStatus,\
  baseRefName,headRefName,reviewDecision
```

Extract: PR number, URL, title, mergeable status, base branch, head branch, review decision.

## Step 3 — Verify PR is open and mergeable

```bash
state=$(gh pr view $pr_number --json state -q .state)
mergeable=$(gh pr view $pr_number --json mergeable -q .mergeable)
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
```

If PR is not OPEN:
- `state == "MERGED"` → skip Steps 4–8 (the base merge and local tests do not apply to an already-merged PR) and go directly to Step 9 in [squash-merge.md](squash-merge.md), whose `already_merged` check resumes post-merge (Steps 9b–15: branch cleanup, deploy verify, compound close) even though this session never called `gh pr merge` — this is the rerun after someone else, a person or a merge queue, merged the PR.
- Any other non-OPEN state → report current state and exit.

If `mergeable == "CONFLICTING"`:
```
❌ PR has merge conflicts — resolve first:
  gh pr checkout $pr_number
  git fetch origin $base_branch
  git merge origin/$base_branch
  # ... resolve conflicts ...
  git push
```
Exit with error.

## Step 4 — Check if head branch is up-to-date with base

```bash
gh pr checkout $pr_number
base_branch=$(gh pr view $pr_number --json baseRefName -q .baseRefName)
git fetch origin $base_branch
if git log HEAD..origin/$base_branch --oneline | grep -q .; then
  echo "Branch is behind $base_branch"
fi
```

If behind, merge the base in. The branch is published, so never rebase or force-push it ([ci-fixup-and-behind.md](ci-fixup-and-behind.md)):
```bash
if ! git merge --no-ff --no-edit origin/$base_branch; then
  echo "❌ Merge conflicts — conflicting files:"
  git diff --name-only --diff-filter=U
  git merge --abort
  exit 1
fi
git push
```

On conflict:
```
❌ Merge conflicts detected — conflicting files:
  $(git diff --name-only --diff-filter=U)
Resolve: git merge origin/$base_branch, fix files, git add, git commit, git push,
then re-run the merge-pr skill.
```

## Step 5 — Run local tests

```bash
test_cmd=$(jq -r '.catalyst.pr.testCommand // "make test"' .catalyst/config.json)
echo "Running tests: $test_cmd"
if ! $test_cmd; then
  echo "❌ Tests failed"
  exit 1
fi
```

Skip with `--skip-tests` flag.
