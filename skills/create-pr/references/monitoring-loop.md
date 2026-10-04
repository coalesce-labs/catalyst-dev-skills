# Post-PR monitoring and resolution

Creating the PR starts monitoring. Address CI failures and review findings, then confirm the exact head is ready for the repository's merge route.

## Wait for CI and reviewers

Use `catalyst events status --json` to check the cloud connection. Cloud events need no local sync or log file. Capture its `head` before the first GitHub read and retain `EVENT_CURSOR` across fixes and pushes. This closes the gap between reading state and starting the next wait.

The CLI accepts one `--type`, so the lifecycle watch reads the cloud stream and selects event types locally. A ticket filter can exclude CI and base-branch events that carry no ticket. Use `--ticket` for a narrow ticket-linked merge wait, shown below, rather than restricting the lifecycle watch. Events only trigger a wake. GitHub REST confirms this PR's state and exact head.

```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner') || exit 1
CLOUD_EVENTS=false
if ! command -v catalyst >/dev/null 2>&1; then
  echo 'REST fallback: catalyst CLI absent; 300s interval, 24 reads maximum.' >&2
elif EVENT_STATUS=$(catalyst events status --json 2>/dev/null); then
  EVENT_HEAD=$(printf '%s' "$EVENT_STATUS" | jq -er '.head | select(type == "number" and . >= 0 and . == floor)') || exit 1
  EVENT_CURSOR=${EVENT_CURSOR:-$EVENT_HEAD}
  CLOUD_EVENTS=true
else
  echo 'REST fallback: catalyst events status failed; 300s interval, 24 reads maximum.' >&2
fi

# Read after capturing the cursor, so an event arriving during this read is replayed.
PR_DATA=$(gh api "repos/${REPO}/pulls/${pr_number}") || exit 1
PR_FALLBACK_READS=${PR_FALLBACK_READS:-0}
PR_WAIT_DEADLINE=${PR_WAIT_DEADLINE:-$((SECONDS + 7200))}
while [ "$SECONDS" -lt "$PR_WAIT_DEADLINE" ]; do
  PR_STATE=$(printf '%s' "$PR_DATA" | jq -er 'if .merged then "MERGED" elif .state == "closed" then "CLOSED" elif .state == "open" then "OPEN" else error("unknown PR state") end') || exit 1
  case "$PR_STATE" in
    MERGED) echo MERGED; break ;;
    CLOSED) echo CLOSED; exit 1 ;;
  esac
  EVENT=''
  if [ "$CLOUD_EVENTS" = true ]; then
    WAIT_SECONDS=$((PR_WAIT_DEADLINE - SECONDS))
    [ "$WAIT_SECONDS" -le 300 ] || WAIT_SECONDS=300
    WAIT_RC=0
    EVENT_JSON=$(catalyst events wait-for --after "$EVENT_CURSOR" --timeout "$WAIT_SECONDS") || WAIT_RC=$?
    case "$WAIT_RC" in
      0)
        NEXT_CURSOR=$(printf '%s' "$EVENT_JSON" | jq -er '.sequence | select(type == "number" and . == floor)') || exit 1
        [ "$NEXT_CURSOR" -gt "$EVENT_CURSOR" ] || exit 1
        EVENT_CURSOR=$NEXT_CURSOR
        EVENT=$(printf '%s' "$EVENT_JSON" | jq -er '.type') || exit 1
        case "$EVENT" in
          github.pr.merged|github.pr.closed|github.check-suite.completed|github.pr-review.submitted|github.pr-review-comment.created|github.pr-review-thread.resolved|github.issue-comment.created|github.pr.synchronize|github.push) ;;
          *) continue ;;
        esac ;;
      1) : ;; # Timeout: one authoritative read, then keep the same cursor.
      130) exit 130 ;;
      *)
        if catalyst events status --json >/dev/null 2>&1; then
          echo "cloud wait failed (exit $WAIT_RC); stopping." >&2; exit 1
        fi
        CLOUD_EVENTS=false
        echo 'REST fallback: catalyst events status failed after wait error; 300s interval, 24 reads maximum.' >&2
        [ "$PR_FALLBACK_READS" -lt 24 ] || { echo PENDING; exit 1; }
        PR_FALLBACK_READS=$((PR_FALLBACK_READS + 1)) ;;
    esac
  else
    [ "$PR_FALLBACK_READS" -lt 24 ] || { echo PENDING; exit 1; }
    [ "$PR_FALLBACK_READS" -eq 0 ] || sleep 300
    PR_FALLBACK_READS=$((PR_FALLBACK_READS + 1))
  fi
  # Exactly one PR read per selected event or timeout; never infer merge from an event.
  PR_DATA=$(gh api "repos/${REPO}/pulls/${pr_number}") || exit 1
  HEAD_SHA=$(printf '%s' "$PR_DATA" | jq -er '.head.sha') || exit 1
  if [ -n "$EVENT" ] && [ "$(printf '%s' "$PR_DATA" | jq -r '.merged or (.state == "closed")')" != true ]; then
    echo "OPEN head=$HEAD_SHA wake=$EVENT"
    break # Continue with CI and review resolution below, at this head.
  fi
  if [ "$CLOUD_EVENTS" = false ]; then
    CHECKS=$(gh api "repos/${REPO}/commits/${HEAD_SHA}/check-runs") || exit 1
    REVIEWS=$(gh api "repos/${REPO}/pulls/${pr_number}/reviews") || exit 1
    if printf '%s' "$CHECKS" | jq -e 'any(.check_runs[]; .status == "completed")' >/dev/null ||
       printf '%s' "$REVIEWS" | jq -e 'length > 0' >/dev/null; then
      echo "OPEN head=$HEAD_SHA; inspect checks and reviews"
      break
    fi
  fi
done
[ "$SECONDS" -lt "$PR_WAIT_DEADLINE" ] || { echo PENDING; exit 1; }
```

The watch has a two-hour ceiling and a 300-second safety timeout. On a selected event, reread this PR once, then read checks, reviews, reactions and threads for `HEAD_SHA`. Apply the CI and review readiness checks in merge-pr's `references/gh-signal-traps.md`. An unrelated event cannot prove readiness. On a timeout, recheck state without resetting the cursor or entering a sleep loop. On a wait error, fallback is allowed only after a failed status probe; otherwise stop with the error. Report `PENDING` or the actual read failure at the ceiling.

For a PR already linked to a ticket, a merge-only wait is:

```bash
catalyst events wait-for --type github.pr.merged --ticket "$ticket" --after "$EVENT_CURSOR" --timeout 300
```

Use this narrow wait only when CI and reviews are already satisfied. It returns on delivery, without waiting for a polling interval. Reread the PR to confirm merge or closure, and keep the lifecycle watch when a ticket link is absent or other blockers remain.

## Address reviews and blockers

Run the `review-comments` skill for comments and unresolved threads. Address findings, push one commit, and resolve each applicable automated thread at the current head. An approving-review requirement and an unresolved thread are separate gates.

Read `${CLAUDE_SKILL_DIR}/assets/references/merge-blocker-diagnosis.md` for diagnosis, with this cloud wait taking precedence over its polling examples. Bound fixes to three rounds. After a push, resume from `EVENT_CURSOR` rather than starting a second polling loop. Confirm exact-head checks and review evidence before marking a draft ready. A repository's queue owns its queued merge.
