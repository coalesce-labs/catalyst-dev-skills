# Merging (Step 5)

## Check the actual failing checks first

```bash
# Blocking = anything not a clean terminal success. FAILURE/ERROR alone is too narrow:
# TIMED_OUT / CANCELLED / ACTION_REQUIRED / STARTUP_FAILURE are terminal-bad, and an
# empty conclusion means still PENDING — none of which should be merged over silently.
gh pr view <N> --repo "$REPO" --json statusCheckRollup --jq '
  [ .statusCheckRollup[]?
    | {n:(.name//.context), c:(.conclusion//""), s:(.status//.state//"")}
    | select( (.c|IN("SUCCESS","NEUTRAL","SKIPPED")) | not )
    | "\(.n): \(if .c == "" then "PENDING("+.s+")" else .c end)" ]'
```

If something is red, decide deliberately:

- **Compare against the base branch.** The same failure on `$BASE` is pre-existing.
- **Re-run locally against the merge base.** `git stash` shelves only uncommitted work, so once your fix is pushed a stash rerun still tests your head, and a failure you introduced gets labelled pre-existing. Check out the base instead:
  ```bash
  git stash list            # only meaningful if you have UNCOMMITTED work
  BASECOMMIT="$(git merge-base HEAD "origin/$BASE")"
  git -c advice.detachedHead=false checkout -q "$BASECOMMIT"
  <run the failing suite>   # note the failing test NAMES, not just the count
  git checkout -q -         # back to your branch
  ```
  Compare which tests fail, not how many: two unrelated flakes can match a count.
- **Re-run the job.** Different tests failing on a re-run of the same commit means a flaky suite.
- Only then merge over it, and say in your report that you did, and why.

## Merge one PR

```bash
# Capture head ref + head repo BEFORE merge for checkout-free remote cleanup after confirm.
HEAD_REF=$(gh api "repos/${REPO}/pulls/<N>" --jq '.head.ref' 2>/dev/null || true)
HEAD_REPO=$(gh api "repos/${REPO}/pulls/<N>" --jq '.head.repo.full_name' 2>/dev/null || true)
# Merge via REST only — no local branch-cleanup flag; worktree-safe.
gh pr merge <N> --repo "$REPO" --squash
# Confirm the merge landed via REST BEFORE any branch cleanup — REST is authoritative, and the
# branch must go ONLY on a successful merge. A comment is not a gate: an unconfirmed/failed merge
# here must NOT reach the delete, or it orphans the PR's head ref.
MERGED_OK=$(gh api "repos/${REPO}/pulls/<N>" --jq '.merged' 2>/dev/null || echo "false")
# Delete the remote head ref checkout-free (idempotent, best-effort) ONLY when BOTH hold:
#  - the merge is REST-confirmed, and
#  - the head branch actually lives in ${REPO}. A fork PR's `.head.ref` names a branch in the
#    FORK, so deleting repos/${REPO}/git/refs/heads/${HEAD_REF} could hit a SAME-NAMED branch in
#    the base repo. The raw API call does not tell a fork branch from a same-repo one, so gate
#    on `.head.repo.full_name == ${REPO}`.
#    triage-aging-prs processes arbitrary aging PRs, which may be fork PRs.
if [[ "$MERGED_OK" == "true" && -n "${HEAD_REF:-}" && "${HEAD_REPO:-}" == "${REPO}" ]]; then
  # URL-encode the head ref (preserve '/') so a metacharacter like '#' in a branch name
  # (e.g. feature#123) can't truncate the endpoint into deleting the wrong ref.
  enc_ref=$(printf '%s' "$HEAD_REF" | jq -sRr @uri | sed 's|%2F|/|g')
  gh api --method DELETE "repos/${REPO}/git/refs/heads/${enc_ref}" >/dev/null 2>&1 \
    || echo "triage-aging-prs: remote branch ${HEAD_REF} delete skipped (already gone or protected)" >&2
elif [[ "$MERGED_OK" != "true" ]]; then
  # NOT REST-confirmed: `gh pr merge` may have failed, or (with a merge queue) only ENQUEUED the PR
  # without landing it (`gh pr merge --help`). This PR is NOT merged — its head ref must survive AND
  # it must NOT flow into Step 6 as a merged PR. Treat it as a failed merge for this PR: record the
  # not-merged status in your report and move to the NEXT aging PR (`continue`) — do NOT reconcile
  # its ticket to Done and do NOT report it as merged. Never `exit` here: that would abort the whole
  # burndown over a single unmergeable PR.
  echo "triage-aging-prs: merge of #<N> NOT REST-confirmed — PR still open; skipping branch cleanup AND ticket reconciliation for it" >&2
  continue
fi
```

## Ordering

When strict/up-to-date is enforced, merges serialize: bring one PR up to date, let it merge, then the next. Advancing a batch wastes build slots on heads that go stale before they finish.

When the required check is a deploy integration, update the branch with a real push rather than the API's update-branch: an API-created merge commit may not trigger it, leaving the PR blocked on a check that never appears.
