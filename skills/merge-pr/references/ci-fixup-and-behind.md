# CI fix-up and BEHIND merge — deeper know-how

[`blocker-loop.md`](blocker-loop.md) already covers the reactive wait and the top-level blocker table (BEHIND/DIRTY/UNSTABLE/…); this file adds the specific techniques that table doesn't spell out.

## BEHIND: merge the base, never rebase a published branch

`blocker-loop.md`'s BEHIND row uses the REST `update-branch` endpoint (safe default — GitHub does the merge commit). When `update-branch` itself is blocked, make the same merge commit locally and push it fast-forward. Never rebase or force-push here: the branch's commits are published, other writers (the upkeep robot, review threads) build on them, and the merge queue squashes, so a merge commit on the branch costs nothing at merge. Disable local hooks on the push so a pre-push hook cannot reject it:

```bash
git fetch origin "$BASE_BRANCH"
git merge --no-ff --no-edit "origin/${BASE_BRANCH}"
git -c core.hooksPath=/dev/null push
```

The push is a plain fast-forward. If it is rejected because the branch moved, `git pull --no-rebase` and push again; never add `--force` or `--force-with-lease`.

On merge conflict: `git merge --abort` and report the conflicting files (`git diff --name-only --diff-filter=U`, read before the abort) rather than guessing at a resolution — same rule as `merge-blocker-diagnosis.md`'s `conflicts` entry.

A stack-managed branch (its commits carry a Mergify `Change-Id` trailer) is the exception: `mergify stack push` owns it and would discard a merge commit. Bring it current with `mergify stack sync`, then `mergify stack push`.

## CI fix-up: bound the attempt count, then go back to the reactive wait

An inline CI fix-up (read the failing check's log, patch, push) is worth attempting autonomously, but only within a hard cap — an unbounded fix-retry loop on a CI failure that isn't fixable this way just burns the 24h/session budget without ever surfacing to the operator. Cap at **3 attempts**; on the 4th consecutive failure of the same check, stop and report the failure instead of retrying again. (`merge-blocker-diagnosis.md`'s `MAX_RESOLVE_ATTEMPTS=3` loop is the same discipline generalized across all blocker types, not just CI.)

After each push, don't re-poll on your own — re-enter `blocker-loop.md`'s `catalyst events wait-for` loop and let the next `github.check-suite.completed` wake-up (paired with the mandatory authoritative REST re-check) tell you whether the fix landed. A standalone re-poll here duplicates that reactive wait, burns the same shared GitHub API quota it exists to conserve, and can miss a reaction-only review signal that arrives in the same window.

## Bot threads vs. human threads are never the same branch

When an automated reviewer (Codex, claude-code-review) leaves unresolved threads, dispatch the `review-comments` skill to address them — that's the existing `blocker-loop.md` path. A **human** reviewer's unresolved thread is different and must not be routed the same way:

- An unresolved human review **thread** left on a `COMMENTED` or `APPROVED` review does not always flip `mergeable_state` to `blocked` and never surfaces as `CHANGES_REQUESTED` — so a check that only branches on `mergeable_state` or looks for `CHANGES_REQUESTED` can miss it and merge past an open human conversation.
- Never attempt to resolve a human thread programmatically. Stop and report: "human reviewer `<login>` left an unresolved thread — operator action required." Check this **before** the bot-thread auto-remediation path, so a PR carrying both kinds doesn't get half auto-remediated and merged with the human half still open.

## `merge_commit_sha` can be empty right after a squash merge

GitHub can return `merge_commit_sha: null` for a few seconds after `gh pr merge --squash` confirms `.merged == true`, while it's still computing the commit. Capture the cloud cursor, then retry with a bounded, portable loop — **do not use `seq`**: stock macOS ships no `seq` binary unless GNU coreutils is installed, so `$(seq 1 N)` silently expands to nothing and a `for i in $(seq 1 N)` loop runs zero times, leaving the SHA permanently unread on every successful merge.

```bash
RETRIES="${RETRIES:-5}"
MERGE_COMMIT_SHA=""
SHA_CLOUD=false
if ! command -v catalyst >/dev/null 2>&1; then
  echo 'REST fallback: catalyst CLI absent; 2s interval, 5 reads maximum.' >&2
elif SHA_STATUS=$(catalyst events status --json 2>/dev/null); then
  SHA_HEAD=$(printf '%s' "$SHA_STATUS" | jq -er '.head | select(type == "number" and . >= 0 and . == floor)') || exit 1
  SHA_CURSOR=$SHA_HEAD
  SHA_CLOUD=true
else
  echo 'REST fallback: catalyst events status failed; 2s interval, 5 reads maximum.' >&2
fi
_i=1
while [ "$_i" -le "$RETRIES" ]; do
  MERGE_COMMIT_SHA=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}" --jq '.merge_commit_sha // empty') || exit 1
  [ -z "$MERGE_COMMIT_SHA" ] || break
  [ "$_i" -lt "$RETRIES" ] || break
  if [ "$SHA_CLOUD" = true ]; then
    SHA_WAIT_UNTIL=$(( $(date +%s) + 2 ))
    while [ "$(date +%s)" -lt "$SHA_WAIT_UNTIL" ]; do
      SHA_WAIT_SECONDS=$((SHA_WAIT_UNTIL - $(date +%s)))
      [ "$SHA_WAIT_SECONDS" -gt 0 ] || break
      SHA_WAIT_RC=0
      SHA_EVENT=$(catalyst events wait-for --after "$SHA_CURSOR" --timeout "$SHA_WAIT_SECONDS") || SHA_WAIT_RC=$?
      case "$SHA_WAIT_RC" in
        0)
          SHA_NEXT=$(printf '%s' "$SHA_EVENT" | jq -er '.sequence | select(type == "number" and . == floor)') || exit 1
          [ "$SHA_NEXT" -gt "$SHA_CURSOR" ] || exit 1
          SHA_CURSOR=$SHA_NEXT ;; # Drain events without spending another REST read.
        1) break ;;
        130) exit 130 ;;
        *)
          if catalyst events status --json >/dev/null 2>&1; then
            echo "cloud SHA wait failed (exit $SHA_WAIT_RC); stopping." >&2; exit 1
          fi
          SHA_CLOUD=false
          echo 'REST fallback: catalyst events status failed after wait error; 2s interval, 5 reads maximum.' >&2
          break ;;
      esac
    done
  else
    sleep 2
  fi
  _i=$((_i + 1))
done
if [ -z "$MERGE_COMMIT_SHA" ]; then
  echo "merge-pr: merge_commit_sha still empty after ${RETRIES} reads for pr#${PR_NUMBER}" >&2
  exit 1
fi
```

The readback captures a fresh cloud head and drains events within each two-second retry window. Unrelated events cannot spend the REST read budget. Only an absent CLI or a failed `catalyst events status` probe permits the sleep fallback. A cloud timeout keeps the cloud wait. A GitHub failure stops the readback. Use this whenever a step (a follow-on step such as deploy verification) needs the actual squash SHA rather than `git rev-parse HEAD` from a checkout that may not have fetched the merge yet.

## Why REST, never GraphQL, for mergeable state

`gh pr view --json mergeable` reads GraphQL's `mergeable`/`mergeable_state` fields, which are eventually consistent and frequently lag or lie right after a push. Every check in this file and in `blocker-loop.md` reads `gh api repos/${REPO}/pulls/${PR_NUMBER}` (REST) instead — REST is the authoritative source for merge state.
