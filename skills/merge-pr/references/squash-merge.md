# Step 9 — Merge, or let the merge queue merge

Step 9 of [worktree-safe-merge.md](worktree-safe-merge.md). `scripts/merge-route.sh` decides who merges, from the PR and the repository's own queue config:

| route | who merges | what this step does |
| -- | -- | -- |
| `queue <how>` | the repository's merge queue: a Mergify config with `queue_rules`, or GitHub's native merge queue on the base branch | enters the PR the way the config says (`auto`: nothing to do; `label <name>`: apply exactly that label; `comment`: the `@mergifyio queue` command; `github`: `gh pr merge --auto`; `unclear`: stop and report), stops if the queue is paused, then waits for the queue's merge, bounded, and confirms it |
| `hand-merge` | a person, by the repository's hand-merge procedure: the PR has `hold:hand-steps`, or changes a file or uses a branch the queue config excludes | stops and names the procedure (the one the repository's `AGENTS.md` points to) |
| `held` | nobody yet: a `hold` label keeps it out | stops; the label's owner releases it |
| `merged` | someone already did | resumes post-merge |
| `direct` | this skill: the repository has no merge queue | `gh pr merge --squash` |
| `unknown` | nobody: the PR could not be read | stops; never merge on a guess |

```bash
# Capture head ref + head repo BEFORE any merge so the branch can be deleted checkout-free after a
# REST-confirmed merge.
head_ref=$(gh api "repos/${REPO}/pulls/${pr_number}" --jq '.head.ref' 2>/dev/null || true)
head_repo=$(gh api "repos/${REPO}/pulls/${pr_number}" --jq '.head.repo.full_name' 2>/dev/null || true)

read -r route how how_arg <<<"$("${CLAUDE_SKILL_DIR}/scripts/merge-route.sh" "$pr_number")"
case "$route" in
  merged)
    echo "merge-pr: #$pr_number is already merged — resuming post-merge." >&2
    ;;
  direct)
    # No merge queue: this skill merges, via REST only (no local branch-cleanup flag).
    gh pr merge "$pr_number" --squash || { echo "❌ merge-pr: gh pr merge failed for #$pr_number" >&2; exit 1; }
    ;;
  queue)
    # The queue merges it. Enter it the one way the repository's config names, never by merging.
    case "$how" in
      auto) ;; # a queue rule enqueues every eligible PR by itself; entering by hand only adds noise
      label)
        labels=$(gh api "repos/${REPO}/pulls/${pr_number}" --jq '[.labels[].name] | join(",")' 2>/dev/null || true)
        if [[ ",$labels," != *",$how_arg,"* ]]; then
          gh pr edit "$pr_number" --add-label "$how_arg" >/dev/null \
            || { echo "❌ merge-pr: could not add $how_arg to #$pr_number — not queued." >&2; exit 1; }
        fi
        ;;
      comment)
        gh pr comment "$pr_number" --body "@mergifyio queue" >/dev/null \
          || { echo "❌ merge-pr: could not post the queue command on #$pr_number." >&2; exit 1; }
        ;;
      github)
        gh pr merge "$pr_number" --auto \
          || { echo "❌ merge-pr: GitHub did not add #$pr_number to its merge queue." >&2; exit 1; }
        ;;
      unclear)
        echo "merge-pr: the queue's entry rule for #$pr_number is compound (its label is one alternative" >&2
        echo "   among others). Read the rule with the mergify-config skill and report what #$pr_number still lacks." >&2
        exit 0
        ;;
      *) echo "❌ merge-pr: unknown queue entry '$how' for #$pr_number — not merging." >&2; exit 1 ;;
    esac
    # The agent resumes blocker-loop.md's cloud lifecycle wait after enqueueing.
    if command -v catalyst >/dev/null 2>&1; then
      if QUEUE_EVENT_STATUS=$(catalyst events status --json 2>/dev/null); then
        QUEUE_EVENT_HEAD=$(printf '%s' "$QUEUE_EVENT_STATUS" | jq -er '.head | select(type == "number" and . >= 0 and . == floor)') || exit 1
        EVENT_CURSOR=${EVENT_CURSOR:-$QUEUE_EVENT_HEAD}
        echo "QUEUE_WAIT_REQUIRED: resume blocker-loop.md from cursor $EVENT_CURSOR, then resume merge readback." >&2
        exit 0
      fi
      echo 'REST fallback: catalyst events status failed; 180s interval, 30 active reads maximum.' >&2
    else
      echo 'REST fallback: catalyst CLI absent; 180s interval, 30 active reads maximum.' >&2
    fi
    # Fallback only. A pause has a separate 20-read ceiling; inspect it on each wake.
    outcome=PENDING; polls=0; paused=0; pause=""
    while (( polls < 30 )); do
      state=$(gh api "repos/${REPO}/pulls/${pr_number}" 2>/dev/null \
        | jq -r 'if .merged then "MERGED" elif .state == "closed" then "CLOSED" else "OPEN" end' 2>/dev/null) || state=ERROR
      [[ "$state" == "MERGED" || "$state" == "CLOSED" ]] && { outcome=$state; break; }
      pause=""
      if command -v mergify >/dev/null 2>&1; then
        pause=$(mergify queue status --json 2>/dev/null \
          | jq -r 'if .pause != null then (.pause.reason // "no reason given") else empty end' 2>/dev/null || true)
      fi
      if [[ -n "$pause" ]]; then
        paused=$((paused + 1))
        (( paused >= 20 )) && { outcome=PAUSED; break; }
      else
        polls=$((polls + 1))
      fi
      sleep 180
    done
    case "$outcome" in
      MERGED) ;;
      PAUSED)
        echo "merge-pr: the merge queue is paused ($pause). #$pr_number waits for it; ending this run." >&2
        exit 0
        ;;
      *)
        echo "merge-pr: #$pr_number is the merge queue's to merge and is not merged yet ($outcome)." >&2
        echo "   Ending this run; run merge-pr again once it merges to finish post-merge." >&2
        exit 0
        ;;
    esac
    ;;
  hand-merge)
    echo "merge-pr: #$pr_number is excluded from the merge queue — a person merges it by the" >&2
    echo "   repository's hand-merge procedure (its AGENTS.md names it). merge-pr does not merge it." >&2
    exit 0
    ;;
  held)
    echo "merge-pr: #$pr_number is held — its hold label's owner releases it. Not merging." >&2
    exit 0
    ;;
  *)
    echo "❌ merge-pr: could not tell who merges #$pr_number — not merging." >&2
    exit 1
    ;;
esac

merged_by=$(gh api "repos/${REPO}/pulls/${pr_number}" --jq '.merged_by.login // "unknown"' 2>/dev/null || echo "unknown")
# Read the merge SHA from REST. If it is not ready, use ci-fixup-and-behind.md's
# bounded cloud readback procedure; do not start another sleep loop here.
merge_sha=$(gh api "repos/${REPO}/pulls/${pr_number}" --jq '.merge_commit_sha // empty') || exit 1
if [[ -z "$merge_sha" ]]; then
  echo 'MERGE_SHA_PENDING: use ci-fixup-and-behind.md for bounded readback.' >&2
  exit 1
fi
echo "merge-pr: #$pr_number merged by $merged_by at ${merge_sha:-<no merge sha yet>}" >&2
```

## Waiting on the queue

For anything about the Mergify queue beyond this step, use the `mergify-merge-queue` skill if it is installed. That covers where a PR stands (`mergify queue show <PR> --json`), why it was dequeued, and whether the queue is paused. Use the `mergify-config` skill to read or check the queue config.

- After a successful `catalyst events status` probe, the queue branch returns `QUEUE_WAIT_REQUIRED`. Resume [blocker-loop.md](blocker-loop.md)'s `catalyst events wait-for` lifecycle watch from `EVENT_CURSOR`. Once REST confirms merge, rerun this step on the `merged` route for readback and cleanup. Only an absent CLI or failed probe enters the bounded REST fallback. Recheck the queue's pause on every wake.
- The queue's merge is the terminal signal: `merged_by` is the queue bot (`mergify[bot]`; `gh pr view` shows it as `app/mergify`), with `merged` true and a `merge_commit_sha`.
- A PR the queue has taken carries the exact label `queued`. Match it delimited (`,queued,`), since `dequeued` also contains it.
- A PR that is eligible but not yet queued meets every queue condition and has no `queued` label.
- When the wait ends without a merge, say why if you can tell: `mergify queue show <PR>` names a dequeue and its reason, and a paused queue names its pause reason. Report that rather than a bare timeout.

## Never, on a repository with a merge queue

- **The queue's label.** Apply or remove it only if the queue's own tooling does: removing it from a queued PR ejects the PR from its batch.
- **Hold labels.** Change another PR's hold only as its owner, and pause or unpause the queue only as its owner.
- **Queued PRs.** Push, force-push or rebase a PR carrying `queued` only after it leaves the queue, since a push resets its batch. When updating a stack, skip the rebase of a lower PR that is queued.
- **Queue commands.** Ask the queue to requeue, or a review bot to review again, only if the repository's own tooling does.
- **Excluded PRs.** Merge a PR the queue excludes only through the repository's hand-merge procedure, never over REST or with admin rights.
